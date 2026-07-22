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
import { DAYS_ES, MONTHS_ES } from '../copy';
import { formatTimeHumanFromDate } from '../utils';
import { utcToLocalDateStr, weekdayFromDateStr, localTimeToUTC, noonUTCDate } from '../tzUtils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

// DAYS_ES/MONTHS_ES viven en copy.ts (AUD-06).

const MAX_CANCEL_CLARIFY = 2;

const NO_ACTIVE_APPOINTMENT_MSG =
  'No encontré una cita próxima a tu nombre. Si quieres agendar una, con gusto te ayudo.';

type FutureAppointment = {
  id:        string;
  startsAt:  Date;
  serviceId: string | null;
  staffId:   string | null;
  staffName: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextDayStr(dateStr: string): string {
  const d = noonUTCDate(dateStr);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

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

type RawAppt = {
  id: string; starts_at: string; service_id: string | null; staff_id: string | null;
  staff: Array<{ name: string }> | { name: string } | null;
};

function toFutureAppointment(raw: RawAppt): FutureAppointment {
  const staffRaw  = raw.staff;
  const staffName = (Array.isArray(staffRaw) ? staffRaw[0]?.name : staffRaw?.name) ?? 'tu barbero';
  return {
    id:        raw.id,
    startsAt:  new Date(raw.starts_at),
    serviceId: raw.service_id,
    staffId:   raw.staff_id,
    staffName,
  };
}

/**
 * Cita a cancelar/mover del cliente, o null. Solo SELECT — nunca escribe.
 *
 * AUD-04: si el cliente nombró un día ("cancelar mi cita del viernes"),
 * apunta a LA cita de ese día; sin día (o sin cita ese día), la próxima
 * futura. `hasOthers` = tiene más de una cita futura y NO nombró día —
 * el ask lo usa para invitar a desambiguar en vez de asumir en silencio.
 */
async function findCancelTarget(
  msg:       LifestyleIncomingMessage,
  context:   LifestyleBotContext,
  deps:      StateHandlerDeps,
  targetDay: string | null,
): Promise<{ customerId: string; appt: FutureAppointment; hasOthers: boolean } | null> {
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

  const baseQuery = () => tenantDb(supabase, business.id)
    .table('appointments')
    .select('id, starts_at, service_id, staff_id, staff:staff_id(name)')
    .eq('customer_id', customerId!)
    .eq('status', 'confirmed')
    .gt('starts_at', msg.timestamp.toISOString());

  if (targetDay) {
    const dayStart = localTimeToUTC(targetDay, '00:00', business.timezone);
    const dayEnd   = localTimeToUTC(nextDayStr(targetDay), '00:00', business.timezone);
    const { data } = await baseQuery()
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      // El cliente nombró el día — no hace falta invitar a desambiguar.
      return { customerId, appt: toFutureAppointment(data as unknown as RawAppt), hasOthers: false };
    }
    // Sin cita ese día → cae a la próxima futura; el ask describe la fecha
    // real, así el cliente ve la discrepancia y puede corregir.
  }

  const { data: rows } = await baseQuery()
    .order('starts_at', { ascending: true })
    .limit(2);

  const list = (rows ?? []) as unknown as RawAppt[];
  if (list.length === 0) return null;

  return {
    customerId,
    appt:      toFutureAppointment(list[0]!),
    hasOthers: list.length > 1,
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
    // AUD-04: si el mensaje trae un día ("mi cita del viernes"), apuntar a ESA
    // cita — el intérprete ya lo parseó gratis en dispatch().
    const targetDay = deps.interpretation?.date ?? null;
    const found = await findCancelTarget(msg, context, deps, targetDay);
    if (!found) {
      return {
        newState:     'GREETING',
        newContext:   { ...(context.customerId ? { customerId: context.customerId } : {}) },
        responseText: NO_ACTIVE_APPOINTMENT_MSG,
      };
    }

    const { customerId, appt, hasOthers } = found;
    const desc = describeAppointment(appt, deps.business.timezone);
    let question = kind === 'modification'
      ? `Tienes una cita ${desc}. ¿Quieres moverla a otro día u hora?`
      : `Tienes una cita ${desc}. ¿Quieres cancelarla?`;
    // Más de una cita futura y no nombró día: no asumir en silencio cuál.
    if (hasOthers) {
      question += ' Es tu próxima cita — si te refieres a otra, dime de qué día.';
    }

    return {
      newState:   'AWAITING_CANCEL_CONFIRMATION',
      newContext: {
        customerId,
        pendingCancelAppointmentId: appt.id,
        pendingCancelType:          kind,
        pendingCancelDay:           utcToLocalDateStr(appt.startsAt, deps.business.timezone),
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

  // AUD-04: "no, la del viernes" / "es la del viernes" — el cliente se refiere
  // a OTRA cita. Si el mensaje trae un día distinto al de la cita pendiente,
  // re-apuntar y volver a preguntar (nunca cancelar la equivocada).
  const msgDay = deps.interpretation?.date ?? null;
  if (msgDay && context.pendingCancelDay && msgDay !== context.pendingCancelDay) {
    return startCancelFlow(kind, msg, { customerId: context.customerId }, deps);
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
      responseText: 'De acuerdo, tu cita queda como está. Si necesitas otra cosa, aquí estoy.',
    };
  }

  // ── Ambiguo → clarify con default seguro (nunca cancelar sin sí) ───────────
  if (!saysYes) {
    const attempts = (context.clarification_attempts ?? 0) + 1;
    if (attempts >= MAX_CANCEL_CLARIFY) {
      return {
        newState:     'GREETING',
        newContext:   { customerId: context.customerId },
        responseText: 'Tu cita queda como está. Si más adelante quieres cancelarla o moverla, escríbeme "cancelar mi cita".',
      };
    }
    const verb = kind === 'modification' ? 'mover' : 'cancelar';
    return {
      newState:     'AWAITING_CANCEL_CONFIRMATION',
      newContext:   { ...context, clarification_attempts: attempts },
      responseText: `Solo para confirmar: ¿quieres ${verb} tu cita? Respóndeme sí o no.`,
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
        responseText: 'Esa cita ya no aparece activa — no hay nada que cancelar. Si necesitas agendar, aquí estoy.',
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
        responseText: `Listo, cancelé tu cita de las ${timeStr} con ${staffName}. ¿Para qué día te acomoda la nueva cita?`,
      };
    }

    return {
      newState:     'GREETING',
      newContext:   { customerId: context.customerId },
      responseText: `Listo, tu cita de las ${timeStr} con ${staffName} queda cancelada. Si necesitas agendar otra, aquí estoy.`,
    };
  } catch {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: deps.business.fallbackMessage,
    };
  }
}
