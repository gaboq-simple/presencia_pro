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
import { getCatalog } from '../catalog';
import {
  formatTimeHumanFromDate,
  formatTimeHuman,
  buildBookingNameQuestion,
  detectsServiceCorrection,
} from '../utils';
import { utcToLocalMinutes } from '../tzUtils';
import { parseDate } from './qualifyingDatetime';
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

// Afirmaciones para aceptar el slot cercano ofrecido (decisión b, follow-up).
const AFFIRM_RE =
  /(\bs[ií]\b|\bdale\b|\bva\b|\bvale\b|\bese\b|\besa\b|\bperfecto\b|\bok\b|\bokay\b|\bclaro\b|\bsale\b|\bme sirve\b|\bde acuerdo\b)/;

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

  const lower    = msg.body.trim().toLowerCase();
  const attempts = context.clarification_attempts ?? 0;

  // ── Aceptación del slot cercano ofrecido en el turno anterior (decisión b) ─

  if (context.nearestOfferSlot && AFFIRM_RE.test(lower)) {
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

    case 'offer_nearest': {
      const tz          = business.timezone;
      const hh          = String(Math.floor(route.requestedMinutes / 60)).padStart(2, '0');
      const mm          = String(route.requestedMinutes % 60).padStart(2, '0');
      const reqLabel    = formatTimeHuman(`${hh}:${mm}`);
      const nearestTime = formatTimeHumanFromDate(new Date(route.slot.startsAt), tz);
      const staffPart   = context.autoAssign ? '' : ` con ${route.slot.staffName}`;
      return {
        newState:   'CONFIRMING_APPOINTMENT',
        newContext: { ...context, nearestOfferSlot: route.slot.startsAt, clarification_attempts: 0 },
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
      'Perdona, no te entendi bien. Puedes decirme la hora que prefieres ' +
      '(por ejemplo "a las 5" o "la mas temprano"). O si no tienes preferencia, dime "cualquiera".',
  };
}

// ─── Ruteo puro de selección ──────────────────────────────────────────────────
// Determinista y sin dependencias de DB/red: testeable inyectando slots, now y tz.

export type SelectionRoute =
  | { action: 'no_preference' }
  | { action: 'select';        slot: LifestylePendingSlot }
  | { action: 'offer_nearest'; requestedMinutes: number; slot: LifestylePendingSlot }
  | { action: 'date_redirect' }
  | { action: 'index';         choice: number }
  | { action: 'none' };

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

  // 3. Selección natural: hora / ordinal / difusa.
  const match = matchNaturalSlot(lower, slots, tz);
  if (match.kind === 'exact')   return { action: 'select', slot: match.slot };
  if (match.kind === 'nearest') return { action: 'offer_nearest', requestedMinutes: match.requestedMinutes, slot: match.slot };

  // 4. Índice numérico como fallback de baja prioridad (decisión e).
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
