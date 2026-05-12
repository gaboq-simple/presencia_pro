// ─── State: CONFIRMING_APPOINTMENT ───────────────────────────────────────────
// El cliente eligió una opción (1/2/3) de los slots presentados, o responde
// "cualquiera" / "el que sea" para auto-asignar.
//
// Fast path — no-preference:
//   Detecta antes que parseChoice si el cliente expresa que no tiene preferencia.
//   → Elige automáticamente el primer pendingSlot, va a AWAITING_CONFIRMATION.
//
// Fast path — opción numérica:
//   parseChoice() acepta 1/2/3 y palabras escritas (uno/dos/tres).
//   → Muestra resumen y va a AWAITING_CONFIRMATION.
//
// Retry logic (BUG 2 fix):
//   Si el input no se reconoce, NO va inmediatamente a FALLBACK.
//   Incrementa clarification_attempts y pide clarificación (máx MAX_CLARIFY_ATTEMPTS).
//   Solo después de agotar los intentos transiciona a FALLBACK.

import type { LifestyleBotContext, LifestylePendingSlot } from '../../../types/lifestyle.types';
import { getCatalog } from '../catalog';
import { formatTimeHumanFromDate, buildBookingNameQuestion, detectsServiceCorrection } from '../utils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const DAYS_ES   = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Keywords que expresan "no tengo preferencia de barbero / slot"
const NO_PREFERENCE_KEYWORDS = [
  'cualquiera', 'cualquier', 'el que sea', 'quien sea', 'no importa',
  'no me importa', 'da igual', 'me da igual', 'no tengo preferencia',
  'no tengo tema', 'el que este', 'el que este disponible',
];

// Keywords que indican que el cliente quiere una fecha/hora diferente.
// Detectados antes del retry para re-enrutar a QUALIFYING_DATETIME en vez
// de tratar el mensaje como input inválido.
const DATETIME_REDIRECT_KEYWORDS = [
  'mañana', 'manana', 'hoy', 'pasado mañana', 'pasado manana',
  'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes',
  'sabado', 'sábado', 'domingo',
  'a las', 'para las', 'por la mañana', 'por la tarde', 'por la noche',
  'esta semana', 'la semana', 'proxima semana', 'próxima semana',
  'siguiente semana', 'otro dia', 'otro día',
];

function detectsDatetimeRequest(lower: string): boolean {
  return DATETIME_REDIRECT_KEYWORDS.some((kw) => lower.includes(kw));
}

// Número máximo de intentos de clarificación antes de ir a FALLBACK
const MAX_CLARIFY_ATTEMPTS = 2;

export async function handleConfirmingAppointment(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase } = deps;

  // ── Corrección de servicio mid-flow ──────────────────────────────────────

  if (detectsServiceCorrection(msg.body.trim().toLowerCase())) {
    return {
      newState: 'QUALIFYING_SERVICE',
      newContext: {
        ...context,
        serviceId:                    undefined,
        staffId:                      undefined,
        requestedDate:                undefined,
        requestedTime:                undefined,
        requestedShift:               undefined,
        pendingSlots:                 undefined,
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
      },
      responseText: 'Sin problema. Cual servicio te interesa?',
    };
  }

  const pendingSlots = context.pendingSlots ?? [];
  if (pendingSlots.length === 0) {
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext:   { ...context },
      responseText: 'Para que dia quieres tu cita?',
    };
  }

  const lower    = msg.body.trim().toLowerCase();
  const attempts = context.clarification_attempts ?? 0;

  // ── Fast path: no-preference → auto-asignar el primer slot ───────────────

  if (NO_PREFERENCE_KEYWORDS.some((kw) => lower.includes(kw))) {
    const chosen = pendingSlots[0]!;
    return buildConfirmationResult(context, chosen, business.id, business.timezone, supabase, msg.customerName);
  }

  // ── Fast path: el cliente pide una fecha/hora diferente ───────────────────
  // Re-enrutar a QUALIFYING_DATETIME para que procese el mismo mensaje.
  // El router encadena QUALIFYING_DATETIME → SHOWING_SLOTS sin round-trip.

  if (detectsDatetimeRequest(lower)) {
    return {
      newState: 'QUALIFYING_DATETIME',
      newContext: {
        ...context,
        requestedDate:          undefined,
        requestedTime:          undefined,
        requestedShift:         undefined,
        pendingSlots:           undefined,
        clarification_attempts: 0,
      },
      responseText: '',
    };
  }

  // ── Fast path: elección numérica ──────────────────────────────────────────

  const choice = parseChoice(msg.body);

  if (choice !== null && choice >= 1 && choice <= pendingSlots.length) {
    const chosen = pendingSlots.find((s) => s.index === choice);
    if (chosen) {
      return buildConfirmationResult(context, chosen, business.id, business.timezone, supabase, msg.customerName);
    }
  }

  // ── Input no reconocido: retry antes de FALLBACK (BUG 2) ──────────────────

  if (attempts >= MAX_CLARIFY_ATTEMPTS) {
    return {
      newState:   'FALLBACK',
      newContext: {
        ...context,
        fallbackAttempts:       (context.fallbackAttempts ?? 0) + 1,
        clarification_attempts: 0,
      },
      responseText: business.fallbackMessage,
    };
  }

  const optionsList = pendingSlots.map((s) => s.index).join(', ');
  return {
    newState:   'CONFIRMING_APPOINTMENT',
    newContext: {
      ...context,
      clarification_attempts: attempts + 1,
    },
    responseText:
      `Perdona, no te entendi bien. Elige una opcion: ${optionsList}. ` +
      `O si no tienes preferencia de horario, dime "cualquiera".`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildConfirmationResult(
  context:      LifestyleBotContext,
  chosen:       LifestylePendingSlot,
  businessId:   string,
  tz:           string,
  supabase:     StateHandlerDeps['supabase'],
  customerName: string | null,
): Promise<StateHandlerResult> {
  const catalog = await getCatalog(businessId, supabase);
  const service = catalog.find((s) => s.id === context.serviceId);
  const svcName = service?.name ?? 'el servicio';

  const startsAt    = new Date(chosen.startsAt);
  const localDs     = startsAt.toLocaleDateString('en-CA', { timeZone: tz });
  const dayName     = DAYS_ES[new Date(localDs + 'T12:00:00Z').getDay()]!;
  const dayNum      = parseInt(localDs.split('-')[2]!, 10);
  const monthName   = MONTHS_ES[parseInt(localDs.split('-')[1]!, 10) - 1]!;
  const timeStr     = formatTimeHumanFromDate(startsAt, tz);

  const summary =
    `Servicio: ${svcName}\n` +
    `Barbero: ${chosen.staffName}\n` +
    `Fecha: ${dayName} ${dayNum} de ${monthName}\n` +
    `Hora: ${timeStr}`;

  const { nameQuestion, pendingBookingName } = buildBookingNameQuestion(customerName);

  const newContext: LifestyleBotContext = {
    ...context,
    staffId:                chosen.staffId,
    selectedSlot:           chosen.startsAt,
    clarification_attempts: 0,
    last_side_question:     null,
    pendingBookingName,
  };

  return {
    newState:     'AWAITING_BOOKING_NAME',
    newContext,
    responseText: `Perfecto, aqui los detalles:\n\n${summary}\n\n${nameQuestion}`,
  };
}

function parseChoice(input: string): number | null {
  const trimmed = input.trim();
  const num     = parseInt(trimmed, 10);
  if (!isNaN(num)) return num;

  const wordsMap: Record<string, number> = { uno: 1, dos: 2, tres: 3, one: 1, two: 2, three: 3 };
  return wordsMap[trimmed.toLowerCase()] ?? null;
}
