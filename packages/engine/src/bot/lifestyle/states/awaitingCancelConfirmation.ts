// ─── State: AWAITING_CANCEL_CONFIRMATION ──────────────────────────────────────
// Cancelar/reagendar una cita EXISTENTE desde GREETING (AUD-02, TODO MEDIO-9).
//
// El caso de uso #2 de un bot de citas: "quiero cancelar mi cita del viernes"
// escrito AL DÍA SIGUIENTE de agendar, cuando la conversación ya se reseteó a
// GREETING. Antes de AUD-02 no había ruta: el mensaje caía al flujo de reserva
// y el fast-path de servicio único respondía "Perfecto, Corte de cabello…" —
// el bot intentaba VENDER una cita a quien quería cancelarla.
//
// Flujo:
//   GREETING + intent cancelar/mover (router) → startCancelFlow()
//     → busca la próxima cita confirmada futura del cliente
//     → pregunta confirmación ("Quieres cancelarla?") SIN tocar la BD
//     → AWAITING_CANCEL_CONFIRMATION
//   AWAITING_CANCEL_CONFIRMATION + "sí" → cancela vía RPC (audit atribuye 'bot')
//     → cancelación: despedida cálida → GREETING
//     → modificación: pre-llena serviceId/staffId de la cita cancelada y pasa a
//       QUALIFYING_DATETIME (NO re-pregunta el servicio que ya conoce)
//   + "no" → la cita queda intacta → GREETING
//   + otra cosa → 1 reintento de clarify; al 2º, default seguro: NO cancelar.
//
// Principio: NUNCA tocar la BD sin un sí explícito (a diferencia del camino
// legacy de CONFIRMED, que cancela al primer keyword — eso lo cura AUD-04).

import { tenantDb } from '../../../tenantDb';
import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { isCancellationIntent } from '../cancelIntent';
import { formatTimeHumanFromDate } from '../utils';
import { utcToLocalDateStr, weekdayFromDateStr } from '../tzUtils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

// Duplicado #4 en el bot (confirmed/confirmingAppointment/presentingSlots) —
// unificar en AUD-06 (guía de estilo + constantes compartidas).
const DAYS_ES   = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const MAX_CANCEL_CLARIFY = 2;

const NO_ACTIVE_APPOINTMENT_MSG =
  'No encontre una cita proxima a tu nombre. Si quieres agendar una, con gusto te ayudo.';

type FutureAppointment = {
  id:        string;
  startsAt:  Date;
  serviceId: string | null;
  staffId:   string | null;
  staffName: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanDayLabel(startsAt: Date, tz: string): string {
  const dateStr = utcToLocalDateStr(startsAt, tz);          // YYYY-MM-DD local
  const dayName = DAYS_ES[weekdayFromDateStr(dateStr)]!;
  const dayNum  = parseInt(dateStr.split('-')[2]!, 10);
  const month   = MONTHS_ES[parseInt(dateStr.split('-')[1]!, 10) - 1]!;
  return `${dayName} ${dayNum} de ${month}`;
}

function describeAppointment(appt: FutureAppointment, tz: string): string {
  return `el ${humanDayLabel(appt.startsAt, tz)} a las ${formatTimeHumanFromDate(appt.startsAt, tz)} con ${appt.staffName}`;
}

/** Próxima cita confirmada futura del cliente, o null. Solo SELECT — nunca escribe. */
async function findNextFutureAppointment(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<{ customerId: string; appt: FutureAppointment } | null> {
  const { business, supabase } = deps;

  let customerId = context.customerId;
  if (!customerId) {
    const { data: customerData } = await tenantDb(supabase, business.id)
      .table('customers')
      .select('id')
      .eq('phone', msg.customerPhone)
      .maybeSingle();
    customerId = (customerData as { id: string } | null)?.id;
  }
  if (!customerId) return null;

  const { data: apptData } = await tenantDb(supabase, business.id)
    .table('appointments')
    .select('id, starts_at, service_id, staff_id, staff:staff_id(name)')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
    .gt('starts_at', msg.timestamp.toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!apptData) return null;

  const raw = apptData as unknown as {
    id: string; starts_at: string; service_id: string | null; staff_id: string | null;
    staff: Array<{ name: string }> | { name: string } | null;
  };
  const staffRaw  = raw.staff;
  const staffName = (Array.isArray(staffRaw) ? staffRaw[0]?.name : staffRaw?.name) ?? 'tu barbero';

  return {
    customerId,
    appt: {
      id:        raw.id,
      startsAt:  new Date(raw.starts_at),
      serviceId: raw.service_id,
      staffId:   raw.staff_id,
      staffName,
    },
  };
}

// ─── Arranque del flujo (lo invoca el router desde GREETING) ──────────────────

/**
 * Busca la cita y PREGUNTA antes de actuar. No escribe nada en la BD.
 * Si el cliente no tiene cita futura: mensaje honesto y se queda en GREETING
 * (no arranca el flujo de reserva — quien pidió cancelar no pidió agendar).
 */
export async function startCancelFlow(
  kind:    'cancellation' | 'modification',
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  try {
    const found = await findNextFutureAppointment(msg, context, deps);
    if (!found) {
      return {
        newState:     'GREETING',
        newContext:   { ...(context.customerId ? { customerId: context.customerId } : {}) },
        responseText: NO_ACTIVE_APPOINTMENT_MSG,
      };
    }

    const { customerId, appt } = found;
    const desc     = describeAppointment(appt, deps.business.timezone);
    const question = kind === 'modification'
      ? `Tienes una cita ${desc}. Quieres moverla a otro dia u hora?`
      : `Tienes una cita ${desc}. Quieres cancelarla?`;

    return {
      newState:   'AWAITING_CANCEL_CONFIRMATION',
      newContext: {
        customerId,
        pendingCancelAppointmentId: appt.id,
        pendingCancelType:          kind,
      },
      responseText: question,
    };
  } catch {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: deps.business.fallbackMessage,
    };
  }
}

// ─── Handler del estado ───────────────────────────────────────────────────────

export async function handleAwaitingCancelConfirmation(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase } = deps;
  const apptId = context.pendingCancelAppointmentId;
  const kind   = context.pendingCancelType ?? 'cancellation';

  // Sin cita pendiente en contexto (estado alcanzado por un camino raro) —
  // no hay nada que cancelar: volver a reposo sin inventar.
  if (!apptId) {
    return {
      newState:     'GREETING',
      newContext:   { ...(context.customerId ? { customerId: context.customerId } : {}) },
      responseText: NO_ACTIVE_APPOINTMENT_MSG,
    };
  }

  const affirmation = deps.interpretation?.affirmation ?? null;
  // "si, cancelala" / "cancela" como respuesta también cuentan como sí:
  // el cliente está repitiendo la intención que originó la pregunta.
  const saysYes = affirmation === true || (affirmation === null && isCancellationIntent(msg.body));
  const saysNo  = affirmation === false;

  // ── NO → la cita queda intacta ──────────────────────────────────────────────
  if (saysNo) {
    return {
      newState:     'GREETING',
      newContext:   { customerId: context.customerId },
      responseText: 'De acuerdo, tu cita queda como esta. Si necesitas otra cosa, aqui estoy.',
    };
  }

  // ── Ambiguo → clarify con default seguro (nunca cancelar sin sí) ───────────
  if (!saysYes) {
    const attempts = (context.clarification_attempts ?? 0) + 1;
    if (attempts >= MAX_CANCEL_CLARIFY) {
      return {
        newState:     'GREETING',
        newContext:   { customerId: context.customerId },
        responseText: 'Tu cita queda como esta. Si mas adelante quieres cancelarla o moverla, escribeme "cancelar mi cita".',
      };
    }
    const verb = kind === 'modification' ? 'mover' : 'cancelar';
    return {
      newState:     'AWAITING_CANCEL_CONFIRMATION',
      newContext:   { ...context, clarification_attempts: attempts },
      responseText: `Solo para confirmar: quieres ${verb} tu cita? Respondeme si o no.`,
    };
  }

  // ── SÍ → re-verificar la cita y cancelar vía RPC ───────────────────────────
  try {
    const { data: apptData } = await tenantDb(supabase, business.id)
      .table('appointments')
      .select('id, starts_at, service_id, staff_id, status, staff:staff_id(name)')
      .eq('id', apptId)
      .maybeSingle();

    const raw = apptData as unknown as {
      id: string; starts_at: string; service_id: string | null; staff_id: string | null;
      status: string; staff: Array<{ name: string }> | { name: string } | null;
    } | null;

    // La cita pudo cambiar entre la pregunta y el sí (staff la canceló/completó).
    if (!raw || raw.status !== 'confirmed') {
      return {
        newState:     'GREETING',
        newContext:   { customerId: context.customerId },
        responseText: 'Esa cita ya no aparece activa — no hay nada que cancelar. Si necesitas agendar, aqui estoy.',
      };
    }

    // RPC (2c-ii): set_config('app.actor_type','bot') + UPDATE atómicos → el
    // audit atribuye 'bot'. Mismo camino que la cancelación desde CONFIRMED.
    const { error: cancelError } = await supabase.rpc('bot_set_appointment_status', {
      p_appointment_id: raw.id,
      p_status:         'cancelled',
    });
    if (cancelError) throw cancelError;

    const startsAt  = new Date(raw.starts_at);
    const staffRaw  = raw.staff;
    const staffName = (Array.isArray(staffRaw) ? staffRaw[0]?.name : staffRaw?.name) ?? 'tu barbero';
    const timeStr   = formatTimeHumanFromDate(startsAt, business.timezone);

    if (kind === 'modification') {
      // Pre-llenar servicio y barbero de la cita movida: NO re-preguntar lo que
      // ya sabemos (hallazgo (b) de AUD-04/AUD-02). El cliente puede corregir
      // barbero/servicio más adelante en el flujo si quiere otro.
      return {
        newState:   'QUALIFYING_DATETIME',
        newContext: {
          customerId: context.customerId,
          ...(raw.service_id ? { serviceId: raw.service_id } : {}),
          ...(raw.staff_id ? { staffId: raw.staff_id } : {}),
        },
        responseText: `Listo, cancele tu cita de las ${timeStr} con ${staffName}. Para que dia te acomoda la nueva cita?`,
      };
    }

    return {
      newState:     'GREETING',
      newContext:   { customerId: context.customerId },
      responseText: `Listo, tu cita de las ${timeStr} con ${staffName} queda cancelada. Si necesitas agendar otra, aqui estoy.`,
    };
  } catch {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: deps.business.fallbackMessage,
    };
  }
}
