// ─── State: CONFIRMING_APPOINTMENT ───────────────────────────────────────────
// El cliente eligió un slot de los presentados. La presentación es NATURAL
// (no se numeran las opciones), por lo que el parseo también debe ser natural.
//
// Regla maestra de ruteo (routeSlotSelection):
//   1. Fecha presente (parseDate ≠ null o frase de cambio de día) → es una
//      redirección a OTRO día → re-route a QUALIFYING_DATETIME. Las frases de
//      turno ("de la tarde") se eliminan antes de parseDate para que "5 de la
//      tarde" NO se lea como la fecha "mañana".
//   2. No-preferencia ("cualquiera", "el que sea") SIN calificador de turno →
//      auto-asignar el primer pendingSlot.
//   3. Selección natural (matchNaturalSlot): hora exacta ("5 de la tarde",
//      "el de las 5", "5pm", "5:15"), ordinal ("la primera", "el último"),
//      o difusa ("el más temprano", "cualquiera de la tarde").
//        - hora que matchea un slot (±5 min) → seleccionar.
//        - hora válida pero NO ofrecida → ofrecer el más cercano SIN salir del
//          estado (decisión b: no entrar al rollover de día buggy).
//   4. Índice numérico (1/2/3, uno/dos/tres) como fallback de baja prioridad
//      (decisión e): solo si no hubo match de hora.
//
// Parser de hora LOCAL y deliberadamente "tirable": NO reusa los parsers de
// greeting.ts / qualifyingDatetime.ts (se deduplicarán en otro sprint).
//
// Retry logic (BUG 2 fix):
//   Si el input no se reconoce, NO va inmediatamente a FALLBACK.
//   Incrementa clarification_attempts y pide clarificación (máx MAX_CLARIFY_ATTEMPTS).

import type { LifestyleBotContext, LifestylePendingSlot } from '../../../types/lifestyle.types';
import { getCatalog, getStaffForService } from '../catalog';
import {
  formatTimeHumanFromDate,
  formatTimeHuman,
  buildBookingNameQuestion,
  detectsServiceCorrection,
  clearBookingSelection,
} from '../utils';
import { utcToLocalMinutes, noonUTCDate } from '../tzUtils';
import { getAvailableSlots, SchedulingQueryError } from '../scheduling';
import { parseDate } from './qualifyingDatetime';
import {
  normalize,
  cleanMessage,
  isAffirmation,
  isNegation,
  extractRawTime,
  resolveTargetMinutes,
} from '../interpreter';
import type { LifestyleIncomingMessage, SlotCandidate, StateHandlerDeps, StateHandlerResult } from '../types';

// Mensaje al usuario cuando los queries de disponibilidad fallan (reusa el
// patrón de presentingSlots.ts).
const SCHEDULING_ERROR_MESSAGE =
  'No pude verificar la disponibilidad en este momento. ' +
  'Intenta de nuevo en unos minutos o escribenos directamente.';

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

// Frases que indican cambio de día que parseDate NO sabe expresar como fecha
// concreta. Junto con parseDate forman el detector de "redirección de fecha".
// NO incluye "a las" / "por la tarde" — eso ahora es selección de slot.
const DATE_CHANGE_KEYWORDS = [
  'otro dia', 'otro día', 'otra fecha', 'esta semana', 'la semana',
  'proxima semana', 'próxima semana', 'siguiente semana',
];

// Frase de turno: se elimina antes de parseDate para que "de la mañana"
// (turno) no se confunda con "mañana" (día siguiente).
const SHIFT_PHRASE_RE = /\b(de|por|en)\s+la\s+(tarde|mañana|manana|noche)\b/g;

// Calificadores que, presentes junto a "cualquiera", indican que NO es pura
// no-preferencia sino una preferencia de turno/extremo (decisión d).
const SHIFT_OR_EXTREME_RE =
  /(\b(de|por|en)\s+la\s+(tarde|mañana|manana|noche)\b|\bm[aá]s\s+(temprano|tarde)\b|\btemprano\b)/;

// Tolerancia (min) para considerar que una hora pedida "matchea" un slot.
// Reusa el patrón de presentingSlots.ts (±5 min).
const EXACT_TOL = 5;

// Banda superior de ambigüedad del dígito pelado (S5-BOT-07). Si un dígito es
// índice válido [1..N] pero su lectura-hora cae a >EXACT_TOL y ≤NEAR_TOL de un
// slot ofrecido, es ambiguo (¿el índice o la hora cercana?) → preguntamos la
// hora en vez de asumir. 60 min es un punto de partida conservador; constante
// nombrada para ajustarla con datos de smoke sin tocar la lógica.
const NEAR_TOL = 60;

// Número máximo de intentos de clarificación antes de ir a FALLBACK.
// Exportado para que el test de relación de caps (S5-BOT-12) lo importe real.
export const MAX_CLARIFY_ATTEMPTS = 2;

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
      newContext: { ...context, ...clearBookingSelection() },
      responseText: 'Sin problema. Cual servicio te interesa?',
    };
  }

  const pendingSlots = context.pendingSlots ?? [];
  if (pendingSlots.length === 0) {
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext:   { ...context, nearestOfferSlot: null },
      responseText: 'Para que dia quieres tu cita?',
    };
  }

  const attempts = context.clarification_attempts ?? 0;

  // ── Desambiguación del dígito pelado ambiguo (S5-BOT-07) ──────────────────
  // El turno anterior preguntamos "¿te refieres a la X?". Resolvemos ANTES de la
  // aceptación de nearestOfferSlot y del router. Exclusión mutua con S5-BOT-03:
  // pendingDigitDisambig y nearestOfferSlot nunca están activas a la vez (el
  // handler ask_hour limpia nearestOfferSlot al setear ésta).

  if (context.pendingDigitDisambig) {
    const { requestedMinutes, indexChoice } = context.pendingDigitDisambig;
    const cleared = { ...context, pendingDigitDisambig: null };

    // "sí" → era la HORA: reusar el requery de día real (S5-BOT-02) vía
    // offer_nearest con la hora guardada, sin duplicar la lógica.
    if (isAffirmation(msg.body)) {
      return handleOfferNearest(requestedMinutes, pendingSlots[0]!, cleared, attempts, business, supabase);
    }
    // "no" → era el ÍNDICE (default conservador). buildConfirmationResult avanza
    // y RESETEA rejection_attempts; nunca lo incrementa (NO cruzar contadores).
    if (isNegation(msg.body)) {
      const chosen = pendingSlots.find((s) => s.index === indexChoice) ?? pendingSlots[indexChoice - 1];
      if (chosen) {
        return buildConfirmationResult(cleared, chosen, business, supabase, msg.customerName);
      }
    }
    // Otra cosa ("no, a las 3", "la primera", "3pm") → limpiar la bandera y caer
    // al ruteo normal; el matcher / parseOrdinal consume la corrección.
    context = cleared;
  }

  // ── Aceptación del slot cercano ofrecido en el turno anterior (decisión b) ─

  if (context.nearestOfferSlot && isAffirmation(msg.body)) {
    const offered = pendingSlots.find((s) => s.startsAt === context.nearestOfferSlot);
    if (offered) {
      // El cliente ACEPTA explícitamente el slot ofrecido. Alinear
      // requestedStaffId al barbero aceptado para que el cierre defensivo no
      // vuelva a dispararse (evita loop cuando se ofreció a otro barbero).
      const accepted = { ...context, requestedStaffId: offered.staffId };
      return buildConfirmationResult(accepted, offered, business, supabase, msg.customerName);
    }
  }

  // ── P1: afirmación tras presentación con UN solo slot (S5-BOT-12) ──────────
  // La presentación de slots NO setea nearestOfferSlot, así que un "Sí" tras una
  // sola opción caía al clarify genérico. Si hay exactamente un slot pendiente,
  // una afirmación lo acepta. Con múltiples slots NO se auto-selecciona: se
  // re-presenta concreto más abajo (post-router) para que el cliente elija.
  if (!context.nearestOfferSlot && pendingSlots.length === 1 && isAffirmation(msg.body)) {
    return buildConfirmationResult(context, pendingSlots[0]!, business, supabase, msg.customerName);
  }

  // ── Ruteo determinista de la selección ────────────────────────────────────

  const route = routeSlotSelection(msg.body, pendingSlots, msg.timestamp, business.timezone);

  // ── Selección de barbero en prosa (S5-BOT-10, BUG 1) ──────────────────────
  // "Con Carlos" / "Carlos porfa" no tienen rama en routeSlotSelection → caen a
  // clarify y el barbero se pierde. Anotar requestedStaffId para que el cierre
  // defensivo valide; si el mensaje NO trae hora/índice (route 'none'),
  // re-presentar los slots de ESE barbero (presentBy='staff').
  const roster = context.serviceId
    ? await getStaffForService(business.id, context.serviceId, supabase)
    : [];
  const barberSel = detectBarberSelection(msg.body, roster, pendingSlots, context.presentBy);
  if (barberSel) {
    context = { ...context, requestedStaffId: barberSel.staffId };
    if (route.action === 'none') {
      return {
        newState:   'SHOWING_SLOTS',
        newContext: {
          ...context,
          staffId:                barberSel.staffId,
          autoAssign:             false,
          presentBy:              'staff',
          pendingSlots:           undefined,
          nearestOfferSlot:       null,
          clarification_attempts: 0,
        },
        responseText: '',
      };
    }
  }

  switch (route.action) {
    case 'no_preference': {
      // "Cualquiera" abandona la preferencia de barbero: limpiar requestedStaffId
      // para que el cierre defensivo no se dispare con el primer slot.
      const noPref = { ...context, requestedStaffId: undefined, autoAssign: true };
      return buildConfirmationResult(noPref, pendingSlots[0]!, business, supabase, msg.customerName);
    }

    case 'select':
      return buildConfirmationResult(context, route.slot, business, supabase, msg.customerName);

    case 'ask_who': {
      // S5-BOT-04 (A1): el cliente pregunta CON QUIÉN. Re-presentar los slots
      // pendientes mencionando el barbero de cada uno, sin auto-confirmar. La
      // respuesta híbrida fina ("te atendería Andrés; si prefieres, Carlos…")
      // y su follow-up son A2 — aquí solo dejamos de ocultar el nombre.
      const tz       = business.timezone;
      const byBarber = pendingSlots
        .map((s) => `${s.staffName} a las ${formatTimeHumanFromDate(new Date(s.startsAt), tz)}`)
        .join(', ');
      return {
        newState:   'CONFIRMING_APPOINTMENT',
        newContext: { ...context, clarification_attempts: 0, nearestOfferSlot: null },
        responseText: `Tengo ${byBarber}. Con quien prefieres?`,
      };
    }

    case 'ask_hour': {
      // S5-BOT-07: el dígito es índice válido pero su lectura-hora cae cerca (no
      // exacta) de un slot → ambiguo. Preguntar la hora (solo horas, sin "opción").
      // CRÍTICO: nearestOfferSlot:null garantiza la exclusión mutua con el gate
      // de aceptación de S5-BOT-03. NO se toca rejection_attempts.
      const hh        = String(Math.floor(route.requestedMinutes / 60)).padStart(2, '0');
      const mm        = String(route.requestedMinutes % 60).padStart(2, '0');
      const hourLabel = formatTimeHuman(`${hh}:${mm}`);
      return {
        newState:   'CONFIRMING_APPOINTMENT',
        newContext: {
          ...context,
          pendingDigitDisambig:   { requestedMinutes: route.requestedMinutes, indexChoice: route.indexChoice },
          nearestOfferSlot:       null,
          clarification_attempts: 0,
        },
        responseText: `¿Te refieres a la ${hourLabel}?`,
      };
    }

    case 'offer_nearest':
      return handleOfferNearest(route.requestedMinutes, route.slot, context, attempts, business, supabase);

    case 'date_redirect':
      // Re-enrutar a QUALIFYING_DATETIME para que procese el mismo mensaje.
      // El router encadena QUALIFYING_DATETIME → SHOWING_SLOTS sin round-trip.
      return {
        newState: 'QUALIFYING_DATETIME',
        newContext: {
          ...context,
          requestedDate:          undefined,
          requestedTime:          undefined,
          requestedShift:         undefined,
          pendingSlots:           undefined,
          nearestOfferSlot:       null,
          clarification_attempts: 0,
          rejection_attempts:     0,
        },
        responseText: '',
      };

    case 'index':
      if (route.choice >= 1 && route.choice <= pendingSlots.length) {
        const chosen = pendingSlots.find((s) => s.index === route.choice);
        if (chosen) {
          return buildConfirmationResult(context, chosen, business, supabase, msg.customerName);
        }
      }
      break; // fuera de rango → cae a la lógica de clarificación

    case 'none':
      break;
  }

  // ── Negación DOWNSTREAM del router (regla maestra) ────────────────────────
  // SOLO se evalúa aquí, cuando el router no encontró selección/corrección.
  // "no, a las 6" / "no, mejor las 7" YA pasaron por matchNaturalSlot (que
  // extrajo la hora y avanzó), así que nunca llegan a este punto. Solo el "no"
  // SIN señal de selección entra a la progresión escalonada de rechazo.

  if (isNegation(msg.body)) {
    return buildRejectionResult(context, pendingSlots, business);
  }

  // ── Meta-frustración (S5-BOT-10, DECISIÓN C) ──────────────────────────────
  // "Ya te dije" / "eso pregunté": el cliente siente que se ignora su respuesta.
  // En vez de repetir la pregunta genérica, RE-PRESENTAR los horarios concretos
  // pendientes para que elija sin reformular.
  if (detectMetaFrustration(msg.body)) {
    const tz    = business.timezone;
    const times = pendingSlots.map((s) => formatTimeHumanFromDate(new Date(s.startsAt), tz));
    const offer = times.length === 1
      ? `a las ${times[0]}`
      : `a las ${times.slice(0, -1).join(', a las ')} o a las ${times[times.length - 1]}`;
    return {
      newState:   'CONFIRMING_APPOINTMENT',
      newContext: { ...context, clarification_attempts: attempts + 1, nearestOfferSlot: null },
      responseText: `Perdona la confusion. Tengo ${offer}. Cual prefieres?`,
    };
  }

  // ── P1: afirmación ambigua con múltiples slots (S5-BOT-12) ────────────────
  // "Sí" / "va" / "dale" sin señal de selección y con varias opciones: el cliente
  // quiere agendar pero no dijo cuál. Re-presentar las horas concretas (sin
  // auto-seleccionar) en vez del clarify genérico.
  if (isAffirmation(msg.body) && pendingSlots.length > 1) {
    const tz    = business.timezone;
    const times = pendingSlots.map((s) => formatTimeHumanFromDate(new Date(s.startsAt), tz));
    const offer = `a las ${times.slice(0, -1).join(', a las ')} o a las ${times[times.length - 1]}`;
    return {
      newState:   'CONFIRMING_APPOINTMENT',
      newContext: { ...context, clarification_attempts: attempts + 1, nearestOfferSlot: null },
      responseText: `Claro. Tengo ${offer}. ¿Cuál te late?`,
    };
  }

  // ── Input no reconocido: retry antes de FALLBACK (BUG 2) ──────────────────

  if (attempts >= MAX_CLARIFY_ATTEMPTS) {
    return {
      newState:   'FALLBACK',
      newContext: {
        ...context,
        fallbackAttempts:       (context.fallbackAttempts ?? 0) + 1,
        clarification_attempts: 0,
        nearestOfferSlot:       null,
      },
      responseText: business.fallbackMessage,
    };
  }

  return {
    newState:   'CONFIRMING_APPOINTMENT',
    newContext: {
      ...context,
      clarification_attempts: attempts + 1,
      nearestOfferSlot:       null,
    },
    responseText:
      'Disculpa, no te segui bien. Solo dime a que hora te gustaria, ' +
      'por ejemplo "a las 5" o "la mas temprano". Si cualquiera te sirve, ' +
      'dime "cualquiera" y te asigno la primera.',
  };
}

// ─── Oferta del slot más cercano (decisión b / requery S5-BOT-02) ────────────
// Re-consulta la disponibilidad REAL del día (mismo día de los slots mostrados,
// NO salto de fecha) ordenada por cercanía a la hora pedida y ofrece el más
// cercano SIN auto-confirmar (anti Bug-B). Extraída para que S5-BOT-07 ("sí"
// tras ask_hour) reuse exactamente este camino sin duplicar la lógica.
async function handleOfferNearest(
  requestedMinutes: number,
  fallbackSlot:     LifestylePendingSlot,
  context:          LifestyleBotContext,
  attempts:         number,
  business:         StateHandlerDeps['business'],
  supabase:         StateHandlerDeps['supabase'],
): Promise<StateHandlerResult> {
  const tz       = business.timezone;
  const hh       = String(Math.floor(requestedMinutes / 60)).padStart(2, '0');
  const mm       = String(requestedMinutes % 60).padStart(2, '0');
  const reqLabel = formatTimeHuman(`${hh}:${mm}`);

  let realSlots: SlotCandidate[] | null = null;
  if (context.serviceId && context.requestedDate) {
    try {
      const catalog = await getCatalog(business.id, supabase);
      const service = catalog.find((s) => s.id === context.serviceId);
      if (service) {
        const staffToQuery = await getStaffForService(business.id, service.id, supabase);
        realSlots = await getAvailableSlots({
          businessId:          business.id,
          serviceId:           service.id,
          durationMinutes:     service.duration_minutes,
          requestedDate:       noonUTCDate(context.requestedDate),
          shift:               null,
          // S5-BOT-10: honrar el barbero PEDIDO por encima de autoAssign para no
          // ofrecer (y luego cerrar) con un barbero distinto al solicitado.
          preferredStaffId:    context.requestedStaffId ?? (context.autoAssign ? null : (context.staffId ?? null)),
          isWalkIn:            false,
          walkInBufferMinutes: business.walkInBufferMinutes,
          staffToQuery,
          supabase,
          tz,
          requestedTime:       `${hh}:${mm}`,
        });
      }
    } catch (err) {
      if (err instanceof SchedulingQueryError) {
        if (attempts >= 1) {
          return {
            newState:     'FALLBACK',
            newContext:   { ...context, clarification_attempts: 0, nearestOfferSlot: null },
            responseText: business.fallbackMessage,
          };
        }
        return {
          newState:     'CONFIRMING_APPOINTMENT',
          newContext:   { ...context, clarification_attempts: attempts + 1, nearestOfferSlot: null },
          responseText: SCHEDULING_ERROR_MESSAGE,
        };
      }
      throw err;
    }
  }

  // Disponibilidad real recuperada → REEMPLAZAR pendingSlots (≤3, ya ordenados
  // por cercanía). El primero es el más cercano a la hora pedida.
  if (realSlots && realSlots.length > 0) {
    const newPending: LifestylePendingSlot[] = realSlots.map((s, i) => ({
      index:     i + 1,
      staffId:   s.staffId,
      staffName: s.staffName,
      startsAt:  s.startsAt.toISOString(),
      endsAt:    s.endsAt.toISOString(),
    }));
    const offered     = newPending[0]!;
    const offeredMin   = utcToLocalMinutes(new Date(offered.startsAt), tz);
    const isExact      = Math.abs(offeredMin - requestedMinutes) <= EXACT_TOL;
    const offeredTime  = formatTimeHumanFromDate(new Date(offered.startsAt), tz);
    // Mostrar el barbero si el cliente lo pidió (requestedStaffId) o si NO es
    // auto-assign; ocultarlo solo en auto-assign sin barbero pedido.
    const staffPart    = (context.requestedStaffId || !context.autoAssign) ? ` con ${offered.staffName}` : '';

    // CRÍTICO (anti Bug-B): aunque la hora pedida exista exacta, NO
    // auto-confirmar. Presentar y esperar el "sí" explícito del cliente.
    // El slot ofrecido queda en pendingSlots[0] = nearestOfferSlot, donde
    // la rama de aceptación (isAffirmation) lo recoge.
    const responseText = isExact
      ? `Si, tengo disponible a las ${offeredTime}${staffPart}. Te la agendo?`
      : `A las ${reqLabel} no tengo disponible${staffPart}. ` +
        `Lo mas cercano es a las ${offeredTime}. Te sirve?`;

    return {
      newState:   'CONFIRMING_APPOINTMENT',
      newContext: {
        ...context,
        pendingSlots:           newPending,
        nearestOfferSlot:       offered.startsAt,
        clarification_attempts: 0,
        rejection_attempts:     0,
      },
      responseText,
    };
  }

  // Sin disponibilidad real recuperable → ofrecer el más cercano de los ya
  // mostrados (comportamiento previo, conserva el slot en pendingSlots).
  const nearestTime = formatTimeHumanFromDate(new Date(fallbackSlot.startsAt), tz);
  const staffPart   = (context.requestedStaffId || !context.autoAssign) ? ` con ${fallbackSlot.staffName}` : '';
  return {
    newState:   'CONFIRMING_APPOINTMENT',
    newContext: { ...context, nearestOfferSlot: fallbackSlot.startsAt, clarification_attempts: 0, rejection_attempts: 0 },
    responseText:
      `A las ${reqLabel} no tengo disponible${staffPart}. ` +
      `Lo mas cercano es a las ${nearestTime}. Te sirve?`,
  };
}

// ─── Progresión escalonada de rechazo ─────────────────────────────────────────
// Contador rejection_attempts (consecutivo, separado de clarification_attempts).
// CADA paso RECONOCE el "no" antes de redirigir; nunca suena a "elige opción N".
//   0 (1er no) → A: reconocer + re-ofrecer alternativas concretas del día.
//   1 (2do no) → B: reconocer + preguntar abierto sobre la hora.
//   2 (3er no) → C: reconocer + cambiar de eje (otro día / algo en particular).
//   3 (4to no) → handoff a humano (ESCALATED) — mecanismo de escalado existente.

function buildRejectionResult(
  context:      LifestyleBotContext,
  pendingSlots: LifestylePendingSlot[],
  business:     StateHandlerDeps['business'],
): StateHandlerResult {
  const rejections = context.rejection_attempts ?? 0;
  const tz         = business.timezone;

  // Cuarto "no" → handoff a humano (estado terminal ESCALATED).
  if (rejections >= 3) {
    return {
      newState:   'ESCALATED',
      newContext: {
        ...context,
        rejection_attempts:     0,
        clarification_attempts: 0,
        nearestOfferSlot:       null,
        fallbackAttempts:       2,
      },
      responseText:
        'Dejame conectarte con el equipo para que te ayuden a encontrar lo que buscas. ' +
        'Gracias por tu paciencia.',
    };
  }

  let responseText: string;
  if (rejections === 0) {
    // A: reconocer + re-ofrecer alternativas concretas del día (si las hay).
    const alts = pendingSlots
      .filter((s) => s.startsAt !== context.nearestOfferSlot)
      .slice(0, 2)
      .map((s) => formatTimeHumanFromDate(new Date(s.startsAt), tz));
    responseText = alts.length > 0
      ? `Sin problema. Tambien tengo a las ${alts.join(' o a las ')}. Cual te acomoda?`
      : 'Sin problema. Que hora te vendria mejor?';
  } else if (rejections === 1) {
    // B: reconocer + preguntar abierto sobre la hora.
    responseText = 'Entiendo. Que hora te vendria mejor?';
  } else {
    // C: reconocer + cambiar de eje (no repetir lo de la hora).
    responseText = 'Va. Prefieres quizas otro dia, o buscas algo en particular?';
  }

  return {
    newState:   'CONFIRMING_APPOINTMENT',
    newContext: {
      ...context,
      rejection_attempts:     rejections + 1,
      clarification_attempts: 0,
      nearestOfferSlot:       null,
    },
    responseText,
  };
}

// ─── Ruteo puro de selección ──────────────────────────────────────────────────
// Determinista y sin dependencias de DB/red: testeable inyectando slots, now y tz.

export type SelectionRoute =
  | { action: 'no_preference' }
  | { action: 'select';        slot: LifestylePendingSlot }
  | { action: 'offer_nearest'; requestedMinutes: number; slot: LifestylePendingSlot }
  | { action: 'date_redirect' }
  | { action: 'ask_who' }
  | { action: 'ask_hour';      requestedMinutes: number; indexChoice: number }
  | { action: 'index';         choice: number }
  | { action: 'none' };

// S5-BOT-04: token de "quién / qué barbero / <nombre>" para el guard ask_who.
// Detecta si el cliente pregunta CON QUIÉN, no solo a qué hora. El "?" solo NO
// basta (eso lo verifica el caller). Trabaja sobre texto normalizado (ASCII).
function hasStaffToken(normalizedBody: string, slots: LifestylePendingSlot[]): boolean {
  if (/\bquien(?:es)?\b|\bque\s+barber[oa]s?\b|\bbarber[oa]s?\b/.test(normalizedBody)) return true;
  // Nombre concreto de alguno de los barberos ofrecidos.
  return slots.some((s) => {
    const name = normalize(s.staffName);
    return name.length > 2 && new RegExp(`\\b${name}\\b`).test(normalizedBody);
  });
}

export function routeSlotSelection(
  body:  string,
  slots: LifestylePendingSlot[],
  now:   Date,
  tz:    string,
): SelectionRoute {
  const lower = body.trim().toLowerCase();

  // 1. Redirección de fecha (regla maestra): fecha concreta o frase de cambio
  //    de día. Se eliminan las frases de turno para que "de la mañana" (turno)
  //    no dispare parseDate("mañana") (día siguiente). "mañana a las 5" SÍ
  //    conserva "mañana" (no es frase de turno) → redirige correctamente.
  const dateProbe       = lower.replace(SHIFT_PHRASE_RE, ' ');
  const hasConcreteDate = parseDate(dateProbe, now, tz) !== null;
  const hasDateChange   = DATE_CHANGE_KEYWORDS.some((k) => lower.includes(k));
  if (hasConcreteDate || hasDateChange) {
    return { action: 'date_redirect' };
  }

  // 2. No-preferencia pura (sin calificador de turno/extremo → decisión d).
  if (NO_PREFERENCE_KEYWORDS.some((k) => lower.includes(k)) && !SHIFT_OR_EXTREME_RE.test(lower)) {
    return { action: 'no_preference' };
  }

  // 2.5 Guard de interrogación por barbero (S5-BOT-04): ¿/? + token de barbero
  //     ("¿a las 12 con quién?", "¿qué barbero?") → ask_who, NO selección. Exige
  //     el token de barbero: "¿a las 6?" (duda sin barbero) NO dispara (cae al
  //     matcher). Va ANTES de matchNaturalSlot para ganarle la "?"-selección.
  //     Frontera: NO toca matchNaturalSlot/extractRawTime; solo antepone el guard.
  if (/[¿?]/.test(body) && hasStaffToken(normalize(body), slots)) {
    return { action: 'ask_who' };
  }

  // 3. Selección natural: hora / ordinal / difusa.
  const match = matchNaturalSlot(lower, slots, tz);
  if (match.kind === 'exact')   return { action: 'select', slot: match.slot };
  if (match.kind === 'nearest') return { action: 'offer_nearest', requestedMinutes: match.requestedMinutes, slot: match.slot };

  // 4. Dígito pelado ("12") — precedencia hora-ofrecida > índice > cercana
  //    (S5-BOT-06). La presentación es prosa SIN numerar (presentingSlots.ts:430),
  //    así que un dígito desnudo es la HORA que el cliente vio, no un índice: la
  //    "decisión e" (dígito = índice) quedó obsoleta tras S5-BOT-01. Frontera dura:
  //    NO se tocan extractRawTime/matchNaturalSlot/resolveTargetMinutes/parseChoice;
  //    aquí solo ALIMENTAMOS el dígito a resolveTargetMinutes (lectura) y ruteamos.
  //    Solo dígitos en rango horario (1..23); 0 / ≥24 caen a parseChoice → clarify.
  const bareDigit = /^\d{1,2}$/.test(lower) ? parseInt(lower, 10) : null;
  if (bareDigit !== null && bareDigit >= 1 && bareDigit <= 23 && slots.length > 0) {
    const sorted   = [...slots].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    const slotMins = sorted.map((s) => utcToLocalMinutes(new Date(s.startsAt), tz));
    const target   = resolveTargetMinutes({ hour: bareDigit, minute: 0, explicitPeriod: null }, slotMins);

    let bestIdx = 0;
    let bestD   = Infinity;
    slotMins.forEach((m, i) => {
      const d = Math.abs(m - target);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });

    // (a) hora ofrecida: el dígito calza un slot presentado (±5 min) → seleccionar.
    if (bestD <= EXACT_TOL) return { action: 'select', slot: sorted[bestIdx]! };
    // (a.5) AMBIGUO (S5-BOT-07): el dígito ES índice válido [1..N] PERO su
    //   lectura-hora cae cerca (no exacta) de un slot ofrecido
    //   (EXACT_TOL < bestD ≤ NEAR_TOL) → no asumir índice; preguntar la hora.
    //   La banda exige AMBAS condiciones (índice válido Y bestD en banda); fuera
    //   de ella el comportamiento de S5-BOT-06 queda intacto.
    if (bareDigit <= slots.length && bestD <= NEAR_TOL) {
      return { action: 'ask_hour', requestedMinutes: target, indexChoice: bareDigit };
    }
    // (b) índice válido SIN calce de hora (bestD > NEAR_TOL): decisión e para 1..N.
    if (bareDigit <= slots.length) return { action: 'index', choice: bareDigit };
    // (c) hora válida NO ofrecida → ofrecer la más cercana (reusa el requery S5-BOT-02).
    return { action: 'offer_nearest', requestedMinutes: target, slot: sorted[bestIdx]! };
  }

  // 5. Índice numérico como fallback (decisión e): palabras ("uno"/"dos") y
  //    dígitos fuera del rango horario (0, ≥24) que parseChoice mapea → índice.
  const choice = parseChoice(body);
  if (choice !== null) return { action: 'index', choice };

  return { action: 'none' };
}

// ─── Detector de selección de barbero en CONFIRMING (S5-BOT-10, BUG 1) ────────
// Puro y testeable (sin DB/red/LLM). El cliente puede nombrar un barbero DURANTE
// la confirmación ("Con Carlos", "Carlos porfa"). routeSlotSelection no tiene una
// rama para esto → cae a clarify y el staffId se pierde. Este detector reconoce
// la INTENCIÓN de barbero para anotar requestedStaffId y re-presentar slots.
//
// DECISIÓN B (frontera anti-homonimia):
//   Regla 1 ("con <nombre>"): preposición EXPLÍCITA → se resuelve contra el
//     roster completo (el cliente puede pedir un barbero aún no presentado).
//   Regla 2 (nombre pelado "Carlos"): SOLO si el bot acaba de presentar slots
//     POR barbero (presentBy='staff'), y solo contra los barberos OFRECIDOS.
//     Así "Mayo"/"Junio"/"Ángel" no se malinterpretan como barbero fuera de ese
//     contexto.

type RosterEntry = { id: string; name: string };

function resolveRosterName(token: string, roster: RosterEntry[]): RosterEntry | null {
  const t = normalize(token).replace(/[¿?¡!.,;:]/g, '').trim();
  if (t.length < 3) return null;
  // Exacto
  const exact = roster.find((r) => normalize(r.name) === t);
  if (exact) return exact;
  // Contención en ambos sentidos ("carlos porfa" ⊇ "carlos"; "carl" ⊆ "carlos")
  const contained = roster.find((r) => {
    const n = normalize(r.name);
    return t.includes(n) || n.includes(t);
  });
  if (contained) return contained;
  // Primera palabra del nombre del barbero como palabra dentro del token
  const firstName = roster.find((r) => {
    const first = normalize(r.name.split(' ')[0] ?? '');
    return first.length > 2 && new RegExp(`\\b${first}\\b`).test(t);
  });
  return firstName ?? null;
}

export function detectBarberSelection(
  body:         string,
  roster:       RosterEntry[],
  offeredSlots: LifestylePendingSlot[],
  presentBy?:   'time' | 'staff',
): { staffId: string; staffName: string } | null {
  const n = normalize(body);

  // Regla 1: "con <nombre>" contra el roster completo.
  const conMatch = /\bcon\s+(.+)$/.exec(n);
  if (conMatch) {
    const r = resolveRosterName(conMatch[1]!, roster);
    if (r) return { staffId: r.id, staffName: r.name };
  }

  // Regla 2: nombre pelado SOLO con presentBy='staff', contra los ofrecidos.
  if (presentBy === 'staff') {
    const offeredRoster: RosterEntry[] = offeredSlots.map((s) => ({ id: s.staffId, name: s.staffName }));
    const r = resolveRosterName(body, offeredRoster);
    if (r) return { staffId: r.id, staffName: r.name };
  }

  return null;
}

// ─── Detector de meta-frustración (S5-BOT-10, DECISIÓN C) ─────────────────────
// El cliente señala que ya respondió ("ya te dije", "eso pregunté"). En vez de
// repetir la pregunta genérica de clarificación, re-presentamos los horarios
// concretos pendientes. Anclado por espacios (no substring crudo).
const META_KEYWORDS = [
  'ya te dije', 'ya lo dije', 'ya respondi', 'eso pregunte', 'eso te pregunte',
  'eso dije', 'desde el inicio', 'desde el principio', 'ya te respondi',
];

function detectMetaFrustration(body: string): boolean {
  const n = ` ${cleanMessage(body)} `;
  return META_KEYWORDS.some((k) => n.includes(` ${k} `));
}

// ─── Detector de corrección en el cierre (S5-BOT-08) ──────────────────────────
// Puro y testeable (sin DB/red/LLM). En AWAITING_BOOKING_NAME el cliente puede
// CORREGIR el resumen final (hora/día/barbero) o CANCELAR en vez de dar un nombre.
// Default NOMBRE: solo clasifica como corrección ante un marcador inequívoco; todo
// lo demás cae intacto a la captura de nombre (looksLikeName) → cero regresión.
// LEE extractRawTime/parseDate como señales — NO los modifica. La conmutación de
// barbero queda DIFERIDA a A2: aquí 'barber' solo se DETECTA para no mis-guardar
// "con Carlos" como nombre corrupto.

export type SummaryCorrection = { kind: 'hour' | 'date' | 'barber' | 'cancel' | 'none' };

// Cancelar: keywords ancladas (match completo o por espacios, NO substring).
const CANCEL_KEYWORDS = ['ya no', 'dejalo', 'olvidalo', 'cancela', 'cancelala', 'cancelalo'];

// Negación / verbo de corrección que acompaña a un token de calendario para
// distinguir "el lunes no" / "mejor el lunes" (corrección) de un nombre que
// coincida con un día ("Lunes") o el cliente "mañana".
const DATE_CORRECTION_MARKER_RE =
  /\bno\b|\bmejor\b|\bcambi[ao]\b|\bcambiar\b|\bprefiero\b|\ben\s+vez\b|\bque\s+sea\b/;

export function detectsSummaryCorrection(
  body:  string,
  slots: LifestylePendingSlot[],
  now:   Date,
  tz:    string,
): SummaryCorrection {
  const lower = body.trim().toLowerCase();
  const clean = cleanMessage(body);

  // 1. Cancelar (ancladas): match de mensaje completo o por espacios.
  const padded = ` ${clean} `;
  if (CANCEL_KEYWORDS.some((k) => clean === k || padded.includes(` ${k} `))) {
    return { kind: 'cancel' };
  }

  // 2. Hora: exige marcador ("a las"/":MM"/pm/am/"de la tarde"). Un nombre nunca
  //    los lleva. Reusa extractRawTime (lectura).
  if (extractRawTime(lower) !== null) return { kind: 'hour' };

  // 3. Día: fecha concreta o frase de cambio de día. Un token de calendario SOLO
  //    ("lunes", "mañana") NO dispara sin negación/verbo de corrección (protege
  //    al cliente llamado "Abril"/"Lunes"). Reusa parseDate (lectura).
  const dateProbe     = lower.replace(SHIFT_PHRASE_RE, ' ');
  const hasDateChange = DATE_CHANGE_KEYWORDS.some((k) => lower.includes(k));
  const hasConcrete   = parseDate(dateProbe, now, tz) !== null;
  if (hasDateChange) return { kind: 'date' };
  if (hasConcrete && DATE_CORRECTION_MARKER_RE.test(lower)) return { kind: 'date' };

  // 4. Barbero (S5-BOT-08b, contención): "con <token>" — "con" como PALABRA
  //    COMPLETA seguida de al menos un token. Cubre tanto "con <barbero ofrecido>"
  //    como "con <barbero NO ofrecido>" ("Con Carlos" en una cita de Andrés) y
  //    "con el otro" → se DETECTA como intento de cambio de barbero para NO
  //    mis-guardarlo como nombre corrupto ("Con"). La conmutación real es A2.
  //    Frontera dura: "con" SOLO como palabra completa seguida de espacio+token,
  //    NUNCA como prefijo → "Concepción"/"Conrado"/"Constanza" siguen siendo
  //    nombres válidos (no llevan "con" + espacio); "Carlos" pelado tampoco dispara.
  const norm = normalize(body);
  if (/\bcon\s+\S+/.test(norm)) return { kind: 'barber' };

  return { kind: 'none' };
}

type NaturalMatch =
  | { kind: 'exact';   slot: LifestylePendingSlot }
  | { kind: 'nearest'; requestedMinutes: number; slot: LifestylePendingSlot }
  | { kind: 'none' };

function matchNaturalSlot(
  lower: string,
  slots: LifestylePendingSlot[],
  tz:    string,
): NaturalMatch {
  if (slots.length === 0) return { kind: 'none' };

  const sorted   = [...slots].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const slotMins = sorted.map((s) => utcToLocalMinutes(new Date(s.startsAt), tz));

  // A) Hora explícita ("5 de la tarde", "a las 5", "5pm", "5:15", "el de las 5").
  const raw = extractRawTime(lower);
  if (raw) {
    const target = resolveTargetMinutes(raw, slotMins);
    let bestIdx = 0;
    let bestD   = Infinity;
    slotMins.forEach((m, i) => {
      const d = Math.abs(m - target);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });
    if (bestD <= EXACT_TOL) return { kind: 'exact', slot: sorted[bestIdx]! };
    return { kind: 'nearest', requestedMinutes: target, slot: sorted[bestIdx]! };
  }

  // B) Ordinales ("la primera", "el segundo", "el último").
  const ord = parseOrdinal(lower, sorted.length);
  if (ord !== null) return { kind: 'exact', slot: sorted[ord]! };

  // C) Difusa ("el más temprano", "el más tarde", "de la tarde").
  const fuzzy = parseFuzzy(lower, sorted, slotMins);
  if (fuzzy) return { kind: 'exact', slot: fuzzy };

  return { kind: 'none' };
}

/** "la primera"→0, "segunda"→1, "tercera"→2, "el último"→n-1. 0-based. */
function parseOrdinal(lower: string, n: number): number | null {
  // Sin \b: el boundary de JS no funciona antes de la "ú" acentuada de "último".
  if (/ultim|últim/.test(lower)) return n - 1;
  if (/primer/.test(lower))      return 0;
  if (/segund/.test(lower))      return n >= 2 ? 1 : null;
  if (/tercer/.test(lower))      return n >= 3 ? 2 : null;
  return null;
}

/** Selección difusa: extremos ("más temprano/tarde") y turnos ("de la tarde"). */
function parseFuzzy(
  lower:    string,
  sorted:   LifestylePendingSlot[],
  slotMins: number[],
): LifestylePendingSlot | null {
  const extremeLate  = /\bm[aá]s\s+tarde\b/.test(lower);
  const extremeEarly = /\bm[aá]s\s+temprano\b/.test(lower) || /\btemprano\b/.test(lower) || /\blo\s+antes\b/.test(lower);
  const afternoon    = /(de|por|en)\s+la\s+tarde\b/.test(lower);
  const morning      = /(de|por|en)\s+la\s+(mañana|manana)\b/.test(lower);
  const night        = /(de|por|en)\s+la\s+noche\b/.test(lower);

  // Filtrar por turno si se pidió.
  let idxs = sorted.map((_, i) => i);
  if (afternoon)    idxs = idxs.filter((i) => slotMins[i]! >= 12 * 60);
  else if (morning) idxs = idxs.filter((i) => slotMins[i]! < 12 * 60);
  else if (night)   idxs = idxs.filter((i) => slotMins[i]! >= 18 * 60);

  if (afternoon || morning || night) {
    if (idxs.length === 0) return null; // turno pedido sin slots → cae a clarify
  }

  if (extremeLate)  return sorted[idxs[idxs.length - 1]!]!;
  if (extremeEarly) return sorted[idxs[0]!]!;
  if (afternoon || morning || night) return sorted[idxs[0]!]!; // "de la tarde" → primero del turno

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildConfirmationResult(
  context:      LifestyleBotContext,
  chosen:       LifestylePendingSlot,
  business:     StateHandlerDeps['business'],
  supabase:     StateHandlerDeps['supabase'],
  customerName: string | null,
): Promise<StateHandlerResult> {
  const businessId = business.id;
  const tz         = business.timezone;

  // ── Cierre defensivo (S5-BOT-10, DECISIÓN A) ──────────────────────────────
  // Si el cliente pidió un barbero concreto (requestedStaffId) y el slot que se
  // va a cerrar es de OTRO barbero, NUNCA agendar en silencio: el matcher por
  // hora pudo haber elegido el slot de otro. Se ofrece mantener al barbero
  // pedido en otro horario si hay disponibilidad real; si no, se ofrece al
  // barbero del slot de forma EXPLÍCITA y se espera el "sí".
  if (context.requestedStaffId && chosen.staffId !== context.requestedStaffId) {
    return buildBarberMismatchResult(context, chosen, business, supabase);
  }

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
    rejection_attempts:     0,
    last_side_question:     null,
    nearestOfferSlot:       null,
    pendingBookingName,
  };

  return {
    newState:     'AWAITING_BOOKING_NAME',
    newContext,
    responseText: `Perfecto, aqui los detalles:\n\n${summary}\n\n${nameQuestion}`,
  };
}

// ─── Cierre defensivo: barbero pedido ≠ barbero del slot (S5-BOT-10) ───────────
// Se invoca SOLO desde buildConfirmationResult cuando requestedStaffId ≠ chosen.
// Refinamiento 3: si el barbero pedido TIENE disponibilidad real ese día, se le
// ofrece mantenerlo en otro horario; solo si no hay, se ofrece al barbero del
// slot de forma explícita (nearestOfferSlot) y se espera la aceptación.
async function buildBarberMismatchResult(
  context:  LifestyleBotContext,
  chosen:   LifestylePendingSlot,
  business: StateHandlerDeps['business'],
  supabase: StateHandlerDeps['supabase'],
): Promise<StateHandlerResult> {
  const tz         = business.timezone;
  const roster     = context.serviceId
    ? await getStaffForService(business.id, context.serviceId, supabase)
    : [];
  const requested  = roster.find((r) => r.id === context.requestedStaffId);
  const reqName    = requested?.name ?? 'ese barbero';
  const chosenTime = formatTimeHumanFromDate(new Date(chosen.startsAt), tz);

  // Intentar mantener al barbero pedido en otro horario del mismo día.
  let requestedSlots: SlotCandidate[] = [];
  if (context.serviceId && context.requestedDate && requested) {
    try {
      const catalog = await getCatalog(business.id, supabase);
      const service = catalog.find((s) => s.id === context.serviceId);
      if (service) {
        requestedSlots = await getAvailableSlots({
          businessId:          business.id,
          serviceId:           service.id,
          durationMinutes:     service.duration_minutes,
          requestedDate:       noonUTCDate(context.requestedDate),
          shift:               null,
          preferredStaffId:    requested.id,
          isWalkIn:            false,
          walkInBufferMinutes: business.walkInBufferMinutes,
          staffToQuery:        [requested],
          supabase,
          tz,
        });
      }
    } catch (err) {
      if (!(err instanceof SchedulingQueryError)) throw err;
      // Error de query → caer a la oferta del barbero del slot.
    }
  }

  if (requestedSlots.length > 0) {
    const newPending: LifestylePendingSlot[] = requestedSlots.slice(0, 3).map((s, i) => ({
      index:     i + 1,
      staffId:   s.staffId,
      staffName: s.staffName,
      startsAt:  s.startsAt.toISOString(),
      endsAt:    s.endsAt.toISOString(),
    }));
    const times = newPending.map((s) => formatTimeHumanFromDate(new Date(s.startsAt), tz));
    const offer = times.length === 1
      ? `a las ${times[0]}`
      : `a las ${times.slice(0, -1).join(', a las ')} o a las ${times[times.length - 1]}`;
    return {
      newState:   'CONFIRMING_APPOINTMENT',
      newContext: {
        ...context,
        pendingSlots:           newPending,
        presentBy:              'staff',
        nearestOfferSlot:       null,
        clarification_attempts: 0,
        rejection_attempts:     0,
      },
      responseText: `Con ${reqName} no tengo a esa hora, pero si lo tengo ${offer}. Te acomoda alguna?`,
    };
  }

  // Sin disponibilidad del barbero pedido → ofrecer al del slot, esperando "sí".
  return {
    newState:   'CONFIRMING_APPOINTMENT',
    newContext: {
      ...context,
      nearestOfferSlot:       chosen.startsAt,
      clarification_attempts: 0,
      rejection_attempts:     0,
    },
    responseText:
      `No tengo a ${reqName} disponible ese dia. ${chosen.staffName} si esta a las ${chosenTime}. ` +
      `Te la agendo con ${chosen.staffName}?`,
  };
}

function parseChoice(input: string): number | null {
  const trimmed = input.trim();
  const num     = parseInt(trimmed, 10);
  if (!isNaN(num) && /^\d+$/.test(trimmed)) return num;

  const wordsMap: Record<string, number> = { uno: 1, dos: 2, tres: 3, one: 1, two: 2, three: 3 };
  return wordsMap[trimmed.toLowerCase()] ?? null;
}
