// ─── State: CONFIRMATION_RESPONSE ─────────────────────────────────────────────
// Detecta si el mensaje entrante es respuesta a un recordatorio de cita próxima.
//
// Se llama ANTES del switch de estados en router.ts.
// Si hay cita del cliente en las próximas 3h con status 'confirmed' o 'pending':
//   - Keyword negativo  → cancela la cita, notifica al barbero,
//                         revisa waitlist y notifica si hay entrada 'waiting'.
//   - Keyword positivo  → confirma la cita explícitamente.
//   - Mensaje no claro  → transiciona a FALLBACK (recordatorio tiene prioridad).
//
// Retorna StateHandlerResult si el mensaje fue manejado, null si debe caer al router normal.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { sendWhatsAppMeta }         from '../../../notifications/whatsapp';
import { notifyWaitlist }           from '../scheduling';
import { classifyIntent }           from '../classifier';
import { formatTimeHumanFromDate }  from '../utils';
import type {
  LifestyleIncomingMessage,
  StateHandlerDeps,
  StateHandlerResult,
} from '../types';

// ─── Keywords ─────────────────────────────────────────────────────────────────
// Frases primero (para evitar falsos positivos con palabras sueltas).
// Las palabras sueltas ambiguas ("si", "no", "voy") se delegan al clasificador.

const NEGATIVE_PHRASES = [
  'no voy', 'no puedo', 'no voy a ir', 'no puedo ir',
  'cancelar', 'cancela', 'cancelo', 'ya no puedo', 'no asistiré', 'no asistire',
];
const NEGATIVE_WORDS: string[] = []; // palabras sueltas → al clasificador

const POSITIVE_PHRASES = [
  'ahí estaré', 'ahi estare', 'confirmo', 'confirmar',
  'claro que sí', 'claro que si', 'sí voy', 'si voy', 'ya voy',
];
const POSITIVE_WORDS: string[] = []; // palabras sueltas → al clasificador

// Frases que indican intención de agendamiento o saludo — pasar al router normal.
const PASSTHROUGH_PHRASES = [
  'quiero agendar', 'necesito agendar', 'otra cita', 'nueva cita',
  'agendar otra', 'hacer una cita', 'quiero hacer',
  'hola', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches',
  'buen dia', 'buen día', 'buenas,', 'buenas.',
];

const CLASSIFIER_THRESHOLD = 0.85;

function hasKeyword(
  text:    string,
  phrases: string[],
  words:   string[],
): boolean {
  const n = text.toLowerCase().trim();
  if (phrases.some((p) => n.includes(p))) return true;
  return words.some((w) => new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(n));
}

/** Retorna true si el mensaje claramente NO es una respuesta al recordatorio. */
function isPassthrough(text: string): boolean {
  const n = text.toLowerCase().trim();
  // Saludo simple: solo la palabra "buenas" o "hola"
  if (n === 'buenas' || n === 'hola') return true;
  return PASSTHROUGH_PHRASES.some((p) => n.startsWith(p) || n.includes(p));
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type ApptJoined = {
  id: string;
  starts_at: string;
  staff: { id: string; name: string; whatsapp_id: string } | null;
  service: { name: string } | null;
  customer: { id: string; name: string } | null;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleConfirmationResponse(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult | null> {
  const { business, supabase } = deps;

  // ── Resolver customer por teléfono ────────────────────────────────────────

  const { data: customerData } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .eq('phone', msg.customerPhone)
    .maybeSingle();

  if (!customerData) return null;

  const customerId = (customerData as { id: string }).id;

  // ── Buscar cita próxima en las 3h ─────────────────────────────────────────

  const now  = new Date();
  const in3h = new Date(now.getTime() + 3 * 60 * 60_000);

  const { data: apptData, error: apptQueryError } = await supabase
    .from('appointments')
    .select(`
      id,
      starts_at,
      staff:staff_id(id, name, whatsapp_id),
      service:service_id(name),
      customer:customer_id(id, name)
    `)
    .eq('business_id', business.id)
    .eq('customer_id', customerId)
    .in('status', ['confirmed', 'pending'])
    .gte('starts_at', now.toISOString())
    .lte('starts_at', in3h.toISOString())
    .order('starts_at')
    .limit(1)
    .maybeSingle();

  if (apptQueryError) {
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'bot',
      event:       'confirmation_response_query_failed',
      business_id: business.id,
      customer_id: customerId,
      error:       apptQueryError.message,
    }));
    return null;
  }

  // Sin cita próxima → caer al router normal
  if (!apptData) return null;

  const appt      = apptData as unknown as ApptJoined;
  const startsAt  = new Date(appt.starts_at);
  const timeStr   = formatTimeHumanFromDate(startsAt, business.timezone);
  const staffName = appt.staff?.name ?? 'tu barbero';

  // ── Fast path 0: passthrough — mensaje claramente no relacionado ─────────
  // Si el mensaje contiene intención de agendamiento o saludo genérico,
  // no interceptar y dejar que el router normal lo maneje.

  if (isPassthrough(msg.body)) return null;

  // ── Fast path 1: evaluar keywords estrictos ───────────────────────────────

  let isNegative = hasKeyword(msg.body, NEGATIVE_PHRASES, NEGATIVE_WORDS);
  let isPositive = !isNegative && hasKeyword(msg.body, POSITIVE_PHRASES, POSITIVE_WORDS);

  // ── Slow path: clasificador si keywords no fueron concluyentes ────────────
  // Maneja respuestas cortas como "si", "no", "dale", "mejor no".
  // Si el clasificador no tiene alta confianza → return null al router normal.

  if (!isNegative && !isPositive) {
    const businessContext = `Negocio: ${business.name}`;
    const recentHistory   = (context.messages ?? []).slice(-2);

    const classification = await classifyIntent({
      userMessage:      msg.body,
      availableOptions: ['sí, confirmar', 'no, cancelar'],
      flowQuestion:     'Confirmas o cancelas tu cita?',
      businessContext,
      recentHistory,
      anthropicKey:     deps.anthropicKey,
    });

    if (
      classification.intent === 'CONFIRM_NO' &&
      classification.confidence >= CLASSIFIER_THRESHOLD
    ) {
      isNegative = true;
    } else if (
      classification.intent === 'CONFIRM_YES' &&
      classification.confidence >= CLASSIFIER_THRESHOLD
    ) {
      isPositive = true;
    } else {
      // Confianza insuficiente — no interceptar, dejar al router normal.
      return null;
    }
  }

  // ── CANCELACIÓN EXPLÍCITA ─────────────────────────────────────────────────

  if (isNegative) {
    // Cancelar cita
    await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id);

    const whatsappToken = process.env['WHATSAPP_ACCESS_TOKEN'] ?? '';
    if (!whatsappToken) {
      console.warn(JSON.stringify({
        ts:          new Date().toISOString(),
        service:     'bot',
        event:       'whatsapp_token_missing',
        context:     'cancellation_response',
        business_id: business.id,
      }));
    }

    // Notificar al barbero — best-effort
    try {
      if (appt.staff?.whatsapp_id) {
        const clientName = appt.customer?.name ?? msg.customerPhone;
        await sendWhatsAppMeta(
          {
            to:   appt.staff.whatsapp_id,
            body: `⚠️ ${clientName} canceló su cita de hoy a las ${timeStr}`,
          },
          {
            accessToken:   whatsappToken,
            phoneNumberId: business.whatsappPhoneNumberId,
          },
        );
      }
    } catch {
      // best-effort
    }

    // Revisar waitlist — best-effort
    try {
      const apptDate = startsAt.toISOString().split('T')[0]!;

      const { data: wlEntry } = await supabase
        .from('waitlist')
        .select('id')
        .eq('business_id', business.id)
        .eq('requested_date', apptDate)
        .eq('status', 'waiting')
        .order('created_at')
        .limit(1)
        .maybeSingle();

      if (wlEntry) {
        await notifyWaitlist(
          (wlEntry as { id: string }).id,
          supabase,
          whatsappToken,
          business.whatsappPhoneNumberId,
          startsAt,
          appt.staff?.id ?? '',
          staffName,
          business.timezone,
        );
      }
    } catch {
      // best-effort — fallo no cancela la cita ni bloquea el flujo
    }

    return {
      newState:     'COMPLETED',
      newContext:   { ...context },
      responseText: 'Entendido, cancelamos tu cita. Cuando quieras reagendar aqui estamos.',
    };
  }

  // ── CONFIRMACIÓN EXPLÍCITA ────────────────────────────────────────────────

  if (isPositive) {
    await supabase
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', appt.id);

    return {
      newState:     'CONFIRMED',
      newContext:   { ...context },
      responseText: `Perfecto! Te esperamos a las ${timeStr} con ${staffName}.`,
    };
  }

  // Llegamos aquí solo si hubo keyword match pero no cayó en ningún bloque.
  // No debería ocurrir, pero como defensa retornamos null al router.
  return null;
}

