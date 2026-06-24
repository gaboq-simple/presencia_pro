// ─── Disponibilidad honesta — árbol de presentación (determinista, NO LLM) ────
// Decide QUÉ mostrar a partir de la FORMA completa (DayAvailability) y la pista
// del cliente (franja/hora). Puro y testeable: sin DB, sin red, sin LLM.
//
// Árbol (ante "¿qué horarios hay?", barbero+día definidos):
//   1. ¿Pista (hora/franja)? → filtrar a eso → paso 3.
//   2. ¿Slots en AMBAS franjas? No → listar esa franja (paso 3). Sí → preguntar
//      binario "¿mañana o más tarde?".
//   3. Subconjunto de UNA franja: pocos (≤LIST_ALL_MAX) → listar todos; muchos →
//      muestra representativa (REPRESENTATIVE_COUNT espaciados) + "o prefieres otra".
//
// Regla maestra: nunca >~3-4 horas de golpe; NUNCA afirmar/preguntar una franja sin
// slots; preguntar franja SOLO cuando reparte una lista larga entre ambas.

import type { DayAvailability } from '../scheduling';
import { AFTERNOON_CUTOFF } from '../scheduling';
import { resolveTargetMinutes } from '../interpreter';
import { utcToLocalMinutes } from '../tzUtils';
import type { SlotCandidate } from '../types';

// Umbrales (tunables en smoke sin tocar la lógica).
// LIST_ALL_MAX acotado a 3: en modo list se arman pendingSlots con index 1..N, y
// LifestylePendingSlotSchema.index es .max(3) — un 4º slot rompería el safeParse del
// contexto. Invariante blindado en tests/honestAvailability.test.ts.
export const LIST_ALL_MAX        = 3;  // pocos (≤3) → listar todos
export const REPRESENTATIVE_COUNT = 3; // muchos → N espaciados

export type FranjaHint = {
  requestedShift?: 'morning' | 'afternoon' | null;
  requestedTime?: string | null; // "HH:MM"
};

export type PresentationDecision =
  | { mode: 'list';           show: SlotCandidate[] }  // listar todos (plantilla determinista — NO LLM)
  | { mode: 'representative'; show: SlotCandidate[] }  // muestra + "o prefieres otra hora" (plantilla determinista)
  | { mode: 'ask-franja' };                            // pregunta binaria (plantilla determinista)

/**
 * Elige REPRESENTATIVE_COUNT slots ESPACIADOS de `pool` (primero, medio, último…),
 * determinista. Si pool.length <= count, devuelve pool tal cual.
 */
export function pickRepresentative(pool: SlotCandidate[], count = REPRESENTATIVE_COUNT): SlotCandidate[] {
  if (pool.length <= count) return [...pool];
  const out: SlotCandidate[] = [];
  const last = pool.length - 1;
  for (let i = 0; i < count; i++) {
    // i=0 → 0 (primero); i=count-1 → last (último); intermedios espaciados.
    const idx = Math.round((i * last) / (count - 1));
    out.push(pool[idx]!);
  }
  return out;
}

// Paso 3: subconjunto de UNA franja ya elegida (no vacía).
function step3(pool: SlotCandidate[]): PresentationDecision {
  if (pool.length <= LIST_ALL_MAX) return { mode: 'list', show: pool };
  return { mode: 'representative', show: pickRepresentative(pool) };
}

/**
 * Árbol de decisión. `tz` se usa solo para ubicar/ordenar por la hora pedida.
 * PRECONDICIÓN: shape.all.length > 0 (presentingSlots maneja "sin disponibilidad"
 * antes — alt-días/waitlist — así que el árbol nunca recibe agenda vacía).
 */
export function decidePresentation(
  shape: DayAvailability,
  hint:  FranjaHint,
  tz:    string,
): PresentationDecision {
  // 1a. Pista de HORA: filtrar a la franja de esa hora y ordenar por cercanía.
  if (hint.requestedTime) {
    const [rh, rm] = hint.requestedTime.split(':').map(Number);
    const targetMin = (rh ?? 0) * 60 + (rm ?? 0);
    const bucket = targetMin >= AFTERNOON_CUTOFF ? shape.afternoon : shape.morning;
    // Si la franja de la hora pedida está vacía, no afirmar nada sobre ella → usar todo.
    const pool = bucket.length > 0 ? bucket : shape.all;
    const byNear = [...pool].sort((a, b) =>
      Math.abs(utcToLocalMinutes(a.startsAt, tz) - targetMin) -
      Math.abs(utcToLocalMinutes(b.startsAt, tz) - targetMin),
    );
    return step3(byNear);
  }

  // 1b. Pista de FRANJA: filtrar a esa franja (si tiene slots; si no, todo).
  if (hint.requestedShift) {
    const bucket = hint.requestedShift === 'afternoon' ? shape.afternoon : shape.morning;
    return step3(bucket.length > 0 ? bucket : shape.all);
  }

  // 2. Sin pista: ¿ambas franjas tienen slots? → preguntar binario; si solo una, listarla.
  if (shape.morning.length > 0 && shape.afternoon.length > 0) {
    return { mode: 'ask-franja' };
  }
  const onlyFranja = shape.morning.length > 0 ? shape.morning : shape.afternoon;
  return step3(onlyFranja);
}

// ─── Parser LOCAL de la respuesta a la pregunta binaria de franja ─────────────
// CRÍTICO (trampa C1): un "mañana" pelado lo interpreta parseDate como DÍA SIGUIENTE.
// Aquí NO: el estado sabe que acaba de preguntar la franja, así que "mañana" = franja
// MAÑANA y se SUPRIME toda lectura de fecha en ese turno. Por eso vive local (state
// policy), no en el intérprete neutro. "tarde"/"noche" → afternoon (chequeado primero,
// para que "más tarde" gane).
export function parseFranjaReply(body: string): 'morning' | 'afternoon' | null {
  const n = body
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\btarde\b|\bnoche\b|mas tarde|\bpm\b/.test(n)) return 'afternoon';
  if (/\bmanana\b|\btemprano\b|\bam\b|\btempran/.test(n)) return 'morning';
  return null;
}

// ─── Plantillas deterministas (2-3 variantes; redacción CONTRACTUAL) ──────────
// El "o prefieres otra hora" NO puede omitirse (garantía anti-ocultar-opciones), por
// eso es plantilla y no Haiku. Variantes para no sonar monótono; selección determinista
// vía `variant` (lo elige el caller con un seed estable).

const FRANJA_QUESTIONS = [
  '¿Lo prefieres en la mañana o más tarde?',
  '¿Te acomoda mejor en la mañana o por la tarde?',
  '¿Buscas algo temprano, o más bien por la tarde?',
];

export function buildFranjaQuestion(variant = 0): string {
  return FRANJA_QUESTIONS[((variant % FRANJA_QUESTIONS.length) + FRANJA_QUESTIONS.length) % FRANJA_QUESTIONS.length]!;
}

// ─── FIX 2: resolución de hora aparcada contra la AGENDA real ──────────────────
// Pura y testeable. La hora ambigua (1–11 en punto, defer-agenda) se desambigua
// AM/PM por el slot REAL más cercano de `all` (TODA la agenda del día, NO la muestra
// sesgada de 3): "a las 8" + agenda hasta 21:00 → 20:00, no 8am. Reusa
// `resolveTargetMinutes` SIN tocarla — solo se le alimentan los minutos de `all`.
// `all` vacío → 'ask' (último recurso: el caller pregunta mañana/noche, nunca asume AM).
export function resolveParkedHour(
  parked: { hour: number; minute: number },
  all:    SlotCandidate[],
  tz:     string,
): { kind: 'resolved'; hhmm: string; minutes: number } | { kind: 'ask' } {
  if (all.length === 0) return { kind: 'ask' };
  const allMins   = all.map((s) => utcToLocalMinutes(s.startsAt, tz));
  const targetMin = resolveTargetMinutes(
    { hour: parked.hour, minute: parked.minute, explicitPeriod: null },
    allMins,
  );
  const hh = String(Math.floor(targetMin / 60)).padStart(2, '0');
  const mm = String(targetMin % 60).padStart(2, '0');
  return { kind: 'resolved', hhmm: `${hh}:${mm}`, minutes: targetMin };
}

// Último recurso (FIX 2): sin agenda para desambiguar el AM/PM de la hora aparcada
// (el barbero no trabaja ese día). NUNCA asumir AM — preguntar. "noche" (no "tarde")
// porque el caso típico es la hora PM ("a las 8" → 20:00 = "8 de la noche").
export function buildLastResortPeriodQuestion(): string {
  return 'Esa hora la prefieres de la mañana o de la noche?';
}

// `times` ya vienen formateadas (ej. "10:00", "2:00 pm"). El caller las arma con tz.
const REPRESENTATIVE_TEMPLATES = [
  (ts: string[]) => `Ese día tengo varios horarios — por ejemplo a las ${joinTimes(ts)}. ¿Te late alguno o prefieres otra hora?`,
  (ts: string[]) => `Hay bastante espacio ese día. Algunas opciones: a las ${joinTimes(ts)}. ¿Cuál te acomoda, o prefieres otra hora?`,
  (ts: string[]) => `Tengo varios huecos. Te paso tres: a las ${joinTimes(ts)}. Si prefieres otra hora, dime cuál.`,
];

export function buildRepresentativeMessage(times: string[], variant = 0): string {
  const idx = ((variant % REPRESENTATIVE_TEMPLATES.length) + REPRESENTATIVE_TEMPLATES.length) % REPRESENTATIVE_TEMPLATES.length;
  return REPRESENTATIVE_TEMPLATES[idx]!(times);
}

// Modo LIST: muestra TODOS los slots de la franja (son pocos). Cierra con
// "¿cuál prefieres?" — NO "o prefieres otra hora": no oculta nada DENTRO de la
// franja mostrada. `otherFranja` (si la OTRA franja tiene slots sin mostrar) agrega
// una coda honesta para no esconder que existe. `times` ya vienen formateadas.
const LIST_TEMPLATES = [
  (ts: string[], coda: string) => `Para ese día tengo a las ${joinTimes(ts)}${coda}. ¿Cuál prefieres?`,
  (ts: string[], coda: string) => `Tengo estos horarios: a las ${joinTimes(ts)}${coda}. ¿Cuál te queda mejor?`,
  (ts: string[], coda: string) => `Puedo a las ${joinTimes(ts)}${coda}. ¿Con cuál te acomodo?`,
];

export function buildListMessage(
  times: string[],
  variant = 0,
  otherFranja: 'morning' | 'afternoon' | null = null,
): string {
  const coda = otherFranja === 'morning' ? ', o también por la mañana'
             : otherFranja === 'afternoon' ? ', o también por la tarde'
             : '';
  const idx = ((variant % LIST_TEMPLATES.length) + LIST_TEMPLATES.length) % LIST_TEMPLATES.length;
  return LIST_TEMPLATES[idx]!(times, coda);
}

function joinTimes(ts: string[]): string {
  if (ts.length <= 1) return ts[0] ?? '';
  return ts.slice(0, -1).join(', ') + ` o ${ts[ts.length - 1]}`;
}
