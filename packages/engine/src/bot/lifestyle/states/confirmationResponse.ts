// ─── State: CONFIRMATION_RESPONSE ─────────────────────────────────────────────
// Detecta si el mensaje entrante es respuesta a un recordatorio de cita próxima.
//
// Se llama ANTES del switch de estados en router.ts.
// Si hay cita del cliente en las próximas 3h con status 'confirmed' o 'pending':
//   - Late arrival intent → evalúa feasibilidad, actualiza cita, notifica barbero.
//   - Keyword negativo    → cancela la cita, notifica al barbero,
//                           revisa waitlist y notifica si hay entrada 'waiting'.
//   - Keyword positivo    → confirma la cita explícitamente.
//   - Mensaje no claro    → transiciona a FALLBACK (recordatorio tiene prioridad).
//
// Retorna StateHandlerResult si el mensaje fue manejado, null si debe caer al router normal.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { tenantDb }                 from '../../../tenantDb';
import { sendWhatsAppMeta }         from '../../../notifications/whatsapp';
import { notifyWaitlist }           from '../scheduling';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import { getCatalog }               from '../catalog';
import { buildBusinessContext }     from '../businessContext';
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

  const { data: customerData } = await tenantDb(supabase, business.id)
    .table('customers')
    .select('id')
    .eq('phone', msg.customerPhone)
    .maybeSingle();

  if (!customerData) return null;

  const customerId = (customerData as { id: string }).id;

  // ── Buscar cita próxima en las 3h ─────────────────────────────────────────

  const now  = new Date();
  const in3h = new Date(now.getTime() + 3 * 60 * 60_000);

  const { data: apptData, error: apptQueryError } = await tenantDb(supabase, business.id)
    .table('appointments')
    .select(`
      id,
      starts_at,
      staff:staff_id(id, name, whatsapp_id),
      service:service_id(name),
      customer:customer_id(id, name)
    `)
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

  // ── Fast path 1: late arrival intent ─────────────────────────────────────
  // Detectar antes que el clasificador de cancelar/confirmar para evitar
  // falsos positivos ("voy 10 min tarde" no es ni cancel ni confirm).

  const lateIntent = extractLateArrivalIntent(msg.body);

  if (lateIntent.detected) {
    const delayMinutes = lateIntent.minutes;

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'check_late_arrival_feasibility',
      {
        p_appointment_id: appt.id,
        p_delay_minutes:  delayMinutes,
      },
    );

    if (rpcError || !rpcData) {
      console.error(JSON.stringify({
        ts:             new Date().toISOString(),
        service:        'bot',
        event:          'late_arrival_rpc_failed',
        business_id:    business.id,
        appointment_id: appt.id,
        error:          rpcError?.message ?? 'no data',
      }));
      // Degradación silenciosa — cae al router normal
      return null;
    }

    const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
      feasible:                boolean;
      reason:                  string;
      adjusted_start:          string | null;
      adjusted_end:            string | null;
      next_appointment_start:  string | null;
    } | undefined;

    if (!result) return null;

    if (!result.feasible) {
      const isOverlap = result.reason.includes('traslape');
      const responseText = isOverlap
        ? `Un retraso de ${delayMinutes} minutos se traslaparía con la siguiente cita de ${staffName}. ¿Quieres que te busque otro horario?`
        : `${result.reason}. ¿Quieres reagendar tu cita para otro horario?`;

      return {
        newState:     'CONFIRMED',
        newContext:   { ...context },
        responseText,
      };
    }

    // Factible — la cita YA fue ajustada por el RPC check_late_arrival_feasibility
    // (2c-ii): cuando es factible, aplica adjusted_starts_at/delay/ack DENTRO de la
    // misma txn con actor_type='bot'. No hay .update() externo (caía en 'unknown').

    // Notificar al barbero — best-effort
    try {
      if (appt.staff?.whatsapp_id) {
        const whatsappToken = process.env['WHATSAPP_ACCESS_TOKEN'] ?? '';
        const clientName    = appt.customer?.name ?? msg.customerPhone;
        const adjStart      = new Date(result.adjusted_start!);
        const newTimeStr    = formatTimeHumanFromDate(adjStart, business.timezone);

        await sendWhatsAppMeta(
          {
            to:   appt.staff.whatsapp_id,
            body: `⏰ ${clientName} avisó que llegará ~${delayMinutes} min tarde. Nueva hora estimada: ${newTimeStr}`,
          },
          {
            accessToken:   process.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
            phoneNumberId: business.whatsappPhoneNumberId,
          },
        );
      }
    } catch {
      // best-effort — no bloquear el flujo
    }

    const adjStart      = new Date(result.adjusted_start!);
    const adjEnd        = new Date(result.adjusted_end!);
    const newTimeStr    = formatTimeHumanFromDate(adjStart, business.timezone);
    const newEndStr     = formatTimeHumanFromDate(adjEnd,   business.timezone);
    const serviceName   = appt.service?.name ?? 'tu servicio';

    return {
      newState:     'CONFIRMED',
      newContext:   { ...context },
      responseText:
        `Sin problema! Te esperamos a las ${newTimeStr} con ${staffName}. ` +
        `Tu ${serviceName} sigue siendo el mismo, terminaríamos aprox a las ${newEndStr}. ¡Nos vemos!`,
    };
  }

  // ── Fast path 2: evaluar keywords estrictos ───────────────────────────────

  let isNegative = hasKeyword(msg.body, NEGATIVE_PHRASES, NEGATIVE_WORDS);
  let isPositive = !isNegative && hasKeyword(msg.body, POSITIVE_PHRASES, POSITIVE_WORDS);

  // ── Slow path: clasificador si keywords no fueron concluyentes ───────────
  // Maneja respuestas cortas como "si", "no", "dale", "mejor no".
  // Si el clasificador no tiene alta confianza → return null al router normal.

  if (!isNegative && !isPositive) {
    const catalog         = await getCatalog(business.id, supabase);
    const businessContext = buildBusinessContext(business, catalog, {
      appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '',
    });
    const recentHistory   = (context.messages ?? []).slice(-2);

    const classification = await deps.classifier.classifyIntent({
      userMessage:      msg.body,
      availableOptions: ['sí, confirmar', 'no, cancelar'],
      flowQuestion:     '¿Confirmas o cancelas tu cita?',
      businessContext,
      recentHistory,
      anthropicKey:     deps.anthropicKey,
    });

    // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
    logClassifierOutput({
      supabase,
      businessId:    business.id,
      customerPhone: msg.customerPhone,
      state:         'CONFIRMED',
      metadata:      buildSingleClassifierMetadata(classification, msg.body),
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
    // Cancelar cita — vía RPC (2c-ii): set_config('app.actor_type','bot',true) +
    // UPDATE atómicos → el audit atribuye 'bot' en vez de 'unknown'. Resultado
    // ignorado, idéntico al .update() anterior.
    await supabase.rpc('bot_set_appointment_status', {
      p_appointment_id: appt.id,
      p_status:         'cancelled',
    });

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

      const { data: wlEntry } = await tenantDb(supabase, business.id)
        .table('waitlist')
        .select('id')
        .eq('requested_date', apptDate)
        .eq('status', 'waiting')
        .order('created_at')
        .limit(1)
        .maybeSingle();

      if (wlEntry) {
        await notifyWaitlist(
          (wlEntry as { id: string }).id,
          supabase,
          business.id,
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
      responseText: 'Entendido, cancelamos tu cita. Cuando quieras reagendar aquí estamos.',
    };
  }

  // ── CONFIRMACIÓN EXPLÍCITA ────────────────────────────────────────────────

  if (isPositive) {
    // Re-confirmar — vía RPC (2c-ii): actor_type='bot' (GUC transaction-local).
    await supabase.rpc('bot_set_appointment_status', {
      p_appointment_id: appt.id,
      p_status:         'confirmed',
    });

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

// ─── Late arrival intent extraction ───────────────────────────────────────────
// Detecta frases en español mexicano que indican que el cliente llega tarde.
// Extrae el número de minutos si está presente; si no, usa 15 como default.
// Rango válido de minutos: 1–120 (fuera de rango → no detectado).

type LateArrivalIntent =
  | { detected: true;  minutes: number }
  | { detected: false };

function extractLateArrivalIntent(text: string): LateArrivalIntent {
  const lower = text.toLowerCase().trim();

  // Patrones con número explícito de minutos — orden de especificidad descendente
  const MINUTE_PATTERNS: RegExp[] = [
    /voy\s+a\s+llegar\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)?\s*tarde/,
    /voy\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)?\s*(?:tarde|de\s+retraso)/,
    /llego\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)?\s*tarde/,
    /llego\s+en\s+(\d+)\s*(?:min(?:utos?)?)/,
    /me\s+retraso\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)/,
    /voy\s+retrasad[ao]\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)/,
    /(\d+)\s*(?:min(?:utos?)?)?\s*(?:de\s+)?tarde/,
    /tarde\s+(?:como\s+)?(\d+)\s*(?:min(?:utos?)?)/,
  ];

  for (const pattern of MINUTE_PATTERNS) {
    const match = lower.match(pattern);
    if (match?.[1]) {
      const minutes = parseInt(match[1], 10);
      if (minutes >= 1 && minutes <= 120) {
        return { detected: true, minutes };
      }
    }
  }

  // Patrones genéricos sin número — default 15 min
  const GENERIC_PATTERNS: RegExp[] = [
    /voy\s+(?:un\s+poco\s+)?tarde/,
    /llego\s+(?:un\s+poco\s+)?tarde/,
    /voy\s+a\s+llegar\s+(?:un\s+poco\s+)?tarde/,
    /me\s+(?:voy\s+a\s+)?retrasar/,
    /voy\s+retrasad[ao]/,
  ];

  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(lower)) {
      return { detected: true, minutes: 15 };
    }
  }

  return { detected: false };
}

