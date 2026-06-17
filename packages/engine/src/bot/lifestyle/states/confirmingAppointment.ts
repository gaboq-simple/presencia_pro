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
} from '../utils';
import { utcToLocalMinutes, noonUTCDate } from '../tzUtils';
import { getAvailableSlots, SchedulingQueryError } from '../scheduling';
import { parseDate } from './qualifyingDatetime';
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

// Normaliza para matchear: minúsculas + NFD + strip de diacríticos (mismo
// patrón que sideQuestion.ts). Trabajamos con listas ASCII puras para evitar
// el bug de acento ("sí" no matcheaba con \b) y NO usamos \b (su boundary
// falla antes de caracteres acentuados / es la fuente del bug).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Limpia para comparar mensaje completo: normaliza, quita puntuación y colapsa
// espacios. Permite el match exacto de tokens cortos.
function cleanMessage(body: string): string {
  return normalize(body).replace(/[¿?¡!.,;:]/g, '').replace(/\s+/g, ' ').trim();
}

// Afirmaciones para aceptar el slot cercano ofrecido (decisión b, follow-up).
// Tokens cortos/ambiguos → SOLO match de mensaje completo (evita aceptar
// "¿va a estar?" por contener "va"). Para "si" además evita tragarse
// "si, a las 6" (eso es una corrección, la consume el router downstream).
const AFFIRM_FULL = ['si', 'va', 'ok', 'okay', 'sale', 'vale'];
// Afirmaciones largas/distintivas → anclaje por espacios (no substring crudo).
const AFFIRM_ANCHORED = [
  'simon', 'dale', 'claro', 'perfecto', 'correcto', 'afirmativo',
  'de acuerdo', 'me sirve', 'orale',
];

function isAffirmation(body: string): boolean {
  const n = cleanMessage(body);
  if (AFFIRM_FULL.includes(n)) return true;
  const padded = ` ${n} `;
  return AFFIRM_ANCHORED.some((k) => padded.includes(` ${k} `));
}

// Negaciones claras. Cortas/ambiguas → match de mensaje completo. La distintiva
// "negativo" → anclaje por espacios. Las negaciones IMPLÍCITAS ("que amable",
// "a la vuelta", "luego", "asi esta bien gracias") NO se fuerzan aquí: caen al
// clarify natural. Esta detección corre SOLO downstream del router (cuando
// devuelve 'none'); las correcciones tipo "no, a las 6" ya las consumió el
// matcher natural antes de llegar aquí.
const NEGATION_FULL = ['no', 'nel', 'ahorita no', 'no gracias'];
const NEGATION_ANCHORED = ['negativo'];

function isNegation(body: string): boolean {
  const n = cleanMessage(body);
  if (NEGATION_FULL.includes(n)) return true;
  const padded = ` ${n} `;
  return NEGATION_ANCHORED.some((k) => padded.includes(` ${k} `));
}

// Tolerancia (min) para considerar que una hora pedida "matchea" un slot.
// Reusa el patrón de presentingSlots.ts (±5 min).
const EXACT_TOL = 5;

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
        nearestOfferSlot:             null,
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
        rejection_attempts:           0,
      },
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

  // ── Aceptación del slot cercano ofrecido en el turno anterior (decisión b) ─

  if (context.nearestOfferSlot && isAffirmation(msg.body)) {
    const offered = pendingSlots.find((s) => s.startsAt === context.nearestOfferSlot);
    if (offered) {
      return buildConfirmationResult(context, offered, business.id, business.timezone, supabase, msg.customerName);
    }
  }

  // ── Ruteo determinista de la selección ────────────────────────────────────

  const route = routeSlotSelection(msg.body, pendingSlots, msg.timestamp, business.timezone);

  switch (route.action) {
    case 'no_preference':
      return buildConfirmationResult(context, pendingSlots[0]!, business.id, business.timezone, supabase, msg.customerName);

    case 'select':
      return buildConfirmationResult(context, route.slot, business.id, business.timezone, supabase, msg.customerName);

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

    case 'offer_nearest': {
      const tz       = business.timezone;
      const hh       = String(Math.floor(route.requestedMinutes / 60)).padStart(2, '0');
      const mm       = String(route.requestedMinutes % 60).padStart(2, '0');
      const reqLabel = formatTimeHuman(`${hh}:${mm}`);

      // Re-consultar la disponibilidad REAL del día (mismo día de los slots ya
      // mostrados — NO es salto de fecha). El matcher base solo ve los ≤3
      // pendingSlots presentados; la hora pedida puede existir en el día aunque
      // no estuviera entre ellos. getAvailableSlots reordena bidireccionalmente
      // por cercanía a la hora pedida y devuelve ≤3.
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
              preferredStaffId:    context.autoAssign ? null : (context.staffId ?? null),
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

      // Disponibilidad real recuperada → REEMPLAZAR pendingSlots (≤3, ya
      // ordenados por cercanía). El primero es el más cercano a la hora pedida.
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
        const isExact      = Math.abs(offeredMin - route.requestedMinutes) <= EXACT_TOL;
        const offeredTime  = formatTimeHumanFromDate(new Date(offered.startsAt), tz);
        const staffPart    = context.autoAssign ? '' : ` con ${offered.staffName}`;

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
      const nearestTime = formatTimeHumanFromDate(new Date(route.slot.startsAt), tz);
      const staffPart   = context.autoAssign ? '' : ` con ${route.slot.staffName}`;
      return {
        newState:   'CONFIRMING_APPOINTMENT',
        newContext: { ...context, nearestOfferSlot: route.slot.startsAt, clarification_attempts: 0, rejection_attempts: 0 },
        responseText:
          `A las ${reqLabel} no tengo disponible${staffPart}. ` +
          `Lo mas cercano es a las ${nearestTime}. Te sirve?`,
      };
    }

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
          return buildConfirmationResult(context, chosen, business.id, business.timezone, supabase, msg.customerName);
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
    // (b) índice válido SIN calce de hora: conserva la decisión e para 1..N.
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

type RawTime = { hour: number; minute: number; explicitPeriod: 'am' | 'pm' | null };

/**
 * Parser de hora LOCAL (este sprint). Solo devuelve hora cuando hay un MARCADOR
 * de hora ("a las"/"las"/":MM"/pm/am/"de la tarde"). Un dígito desnudo ("5")
 * NO es hora → se trata como índice (decisión e).
 */
function extractRawTime(lower: string): RawTime | null {
  const pm = /\b(pm|p\.?\s?m\.?)\b/.test(lower) || /(de|por|en)\s+la\s+(tarde|noche)/.test(lower);
  const am = /\b(am|a\.?\s?m\.?)\b/.test(lower) || /(de|por|en)\s+la\s+(mañana|manana)/.test(lower);

  let hour:    number | null = null;
  let minute = 0;

  // 1. "HH:MM"
  let m = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    hour   = parseInt(m[1]!, 10);
    minute = parseInt(m[2]!, 10);
  } else {
    // 2. "5pm" / "5 pm" / "5am"
    m = lower.match(/\b(\d{1,2})\s*(?:pm|p\.?\s?m\.?|am|a\.?\s?m\.?)\b/);
    if (m) {
      hour = parseInt(m[1]!, 10);
    } else {
      // 3. "a las 5" / "a la 1" / "las 5" / "el de las 5"
      m = lower.match(/\b(?:a\s+)?las?\s+(\d{1,2})\b/);
      if (m) {
        hour = parseInt(m[1]!, 10);
      } else if (pm || am) {
        // 4. número suelto con marcador de turno ("5 de la tarde")
        m = lower.match(/\b(\d{1,2})\b/);
        if (m) hour = parseInt(m[1]!, 10);
      }
    }
  }

  if (hour === null) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute, explicitPeriod: pm ? 'pm' : am ? 'am' : null };
}

/**
 * Desambigua AM/PM contra los slots reales (decisión f): si "5" es ambiguo,
 * elige la interpretación (5 AM / 5 PM) cuyo slot más cercano esté más cerca.
 * NO usa heurística fija "1-6 → PM".
 */
function resolveTargetMinutes(raw: RawTime, slotMins: number[]): number {
  let h = raw.hour;
  let candidates: number[];

  if (raw.explicitPeriod === 'pm') {
    if (h < 12) h += 12;
    candidates = [h];
  } else if (raw.explicitPeriod === 'am') {
    if (h === 12) h = 0;
    candidates = [h];
  } else if (h === 0 || h >= 13 || h === 12) {
    candidates = [h];
  } else {
    candidates = [h, h + 12]; // 1..11 → ambiguo
  }

  let best  = candidates[0]!;
  let bestD = Infinity;
  for (const c of candidates) {
    const t = c * 60 + raw.minute;
    let d = Infinity;
    for (const sm of slotMins) d = Math.min(d, Math.abs(sm - t));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best * 60 + raw.minute;
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

function parseChoice(input: string): number | null {
  const trimmed = input.trim();
  const num     = parseInt(trimmed, 10);
  if (!isNaN(num) && /^\d+$/.test(trimmed)) return num;

  const wordsMap: Record<string, number> = { uno: 1, dos: 2, tres: 3, one: 1, two: 2, three: 3 };
  return wordsMap[trimmed.toLowerCase()] ?? null;
}
