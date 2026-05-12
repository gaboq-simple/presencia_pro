// ─── State: QUALIFYING_WAITLIST ────────────────────────────────────────────────
// Se activa cuando SHOWING_SLOTS no encuentra disponibilidad (ni con auto-assign).
// Pregunta al cliente si quiere quedar en lista de espera.
//
// Flujo:
//   Respuesta YES → INSERT en waitlist con status='waiting' → COMPLETED
//   Respuesta NO  → volver a QUALIFYING_DATETIME (elegir otro día)
//   No claro      → FALLBACK

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { getCatalog, getStaffForService } from '../catalog';
import { findSlotsInNextDays } from '../scheduling';
import { noonUTCDate, utcToLocalDateStr } from '../tzUtils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

// ─── Keywords ─────────────────────────────────────────────────────────────────

const YES_PHRASES = ['sí quiero', 'si quiero', 'claro que sí', 'claro que si'];
const YES_WORDS   = ['sí', 'si', 'claro', 'dale', 'ok', 'va'];

const NO_PHRASES  = ['no gracias', 'no, gracias'];
const NO_WORDS    = ['no'];

function hasKeyword(text: string, phrases: string[], words: string[]): boolean {
  const n = text.toLowerCase().trim();
  if (phrases.some((p) => n.includes(p))) return true;
  return words.some((w) => new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(n));
}

// ─── Mapa de turno a preferencia legible ──────────────────────────────────────

function shiftToPreference(shift: 'morning' | 'afternoon' | null | undefined): string {
  if (shift === 'morning')   return 'mañana';
  if (shift === 'afternoon') return 'tarde';
  return 'cualquiera';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleQualifyingWaitlist(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase } = deps;

  const isYes = hasKeyword(msg.body, YES_PHRASES, YES_WORDS);
  const isNo  = !isYes && hasKeyword(msg.body, NO_PHRASES, NO_WORDS);

  // ── Cliente rechaza waitlist → buscar alternativas y sugerir fecha ────────

  if (isNo) {
    let altResponseText: string;

    if (context.serviceId && context.requestedDate) {
      const catalog      = await getCatalog(business.id, supabase);
      const service      = catalog.find((s) => s.id === context.serviceId);
      const staffForSvc  = await getStaffForService(business.id, context.serviceId, supabase);

      if (service && staffForSvc.length > 0) {
        const fromDate = noonUTCDate(context.requestedDate);

        const alt = await findSlotsInNextDays(fromDate, 10, {
          businessId:          business.id,
          serviceId:           context.serviceId,
          durationMinutes:     service.duration_minutes,
          walkInBufferMinutes: business.walkInBufferMinutes,
          staffToQuery:        staffForSvc,
          supabase,
          tz:                  business.timezone,
        });

        if (alt) {
          const dateLabel = wlFormatDateLabel(alt.date, business.timezone);
          altResponseText =
            `Entendido. El siguiente día con lugar disponible es el ${dateLabel}. ` +
            `Escríbeme ese día y te busco horario.`;
        } else {
          altResponseText =
            'Entendido. Por el momento la agenda está bastante llena. ' +
            'Dime qué fecha tienes en mente y lo reviso.';
        }
      } else {
        altResponseText = 'Entendido. Quieres probar con otro día o turno?';
      }
    } else {
      altResponseText = 'Entendido. Quieres probar con otro día o turno?';
    }

    return {
      newState:     'QUALIFYING_DATETIME',
      newContext:   { ...context, requestedDate: undefined, requestedShift: undefined },
      responseText: altResponseText,
    };
  }

  // ── Mensaje no claro → FALLBACK ───────────────────────────────────────────

  if (!isYes) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context },
      responseText: deps.business.fallbackMessage,
    };
  }

  // ── Cliente acepta → registrar en lista de espera ────────────────────────

  if (!context.serviceId || !context.requestedDate) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: 'Que servicio te interesa?',
    };
  }

  // Resolver customer_id (puede venir en contexto o requiere lookup)
  let customerId = context.customerId;
  if (!customerId) {
    const { data: cData } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', business.id)
      .eq('phone', msg.customerPhone)
      .maybeSingle();

    customerId = cData ? (cData as { id: string }).id : undefined;
  }

  if (!customerId) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context },
      responseText: deps.business.fallbackMessage,
    };
  }

  // INSERT en waitlist
  const { error } = await supabase.from('waitlist').insert({
    business_id:               business.id,
    customer_id:               customerId,
    service_id:                context.serviceId,
    staff_id:                  context.staffId ?? null,
    requested_date:            context.requestedDate,
    requested_time_preference: shiftToPreference(context.requestedShift),
  });

  if (error) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context },
      responseText: deps.business.fallbackMessage,
    };
  }

  // Obtener nombre del servicio para el mensaje de confirmación
  const catalog     = await getCatalog(business.id, supabase);
  const service     = catalog.find((s) => s.id === context.serviceId);
  const serviceName = service?.name ?? 'tu servicio';
  const dateStr     = formatDate(context.requestedDate);

  return {
    newState:     'COMPLETED',
    newContext:   { ...context, customerId },
    responseText:
      `Listo! Quedas en lista de espera para ${serviceName} el ${dateStr}. ` +
      `Te avisamos si se libera un lugar 🔔`,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

const WL_DAYS   = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const WL_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${WL_DAYS[date.getDay()]} ${date.getDate()} de ${WL_MONTHS[date.getMonth()]}`;
}

function wlFormatDateLabel(d: Date, tz: string): string {
  const localDs  = utcToLocalDateStr(d, tz);
  const dayOfWeek = new Date(localDs + 'T12:00:00Z').getDay();
  const dayNum    = parseInt(localDs.split('-')[2]!, 10);
  const monthIdx  = parseInt(localDs.split('-')[1]!, 10) - 1;
  return `${WL_DAYS[dayOfWeek]} ${dayNum} de ${WL_MONTHS[monthIdx]}`;
}
