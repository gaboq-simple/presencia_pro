// ─── State: QUALIFYING_DATETIME ───────────────────────────────────────────────
// Parsea la preferencia de fecha y turno del cliente.
//
// Fast path (determinista):
//   walk-in: "ahorita", "ahora", "ya" → isWalkIn = true, SHOWING_SLOTS.
//   fecha reconocida → requestedDate + shift, SHOWING_SLOTS.
//
// Slow path (clasificador):
//   Input ambiguo que el parser no reconoció → classifyIntent() con Haiku.
//   DATE_PREFERENCE → extrae fecha del value del clasificador.
//   SIDE_QUESTION   → responde y retoma con conector.
//   CLARIFY/REPEAT  → pide aclaración.
//
// Si no se reconoce la fecha en ningún path: permanece en QUALIFYING_DATETIME.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import {
  handleClassification,
  buildSideQuestionResponse,
} from '../clarification';
import { detectsServiceCorrection } from '../utils';
import { isAvailabilityQuestion } from '../availabilityIntent';
import { NO_PREFERENCE_KEYWORDS } from '../interpreter';
import { utcToLocalDateStr, getTodayStr, noonUTCDate } from '../tzUtils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';
import { ESCALATION_TO_TEAM_MESSAGE, SERVICE_QUESTION_RESET, DATE_QUESTION_MESSAGE } from '../copy';

// ─── Keywords walk-in ─────────────────────────────────────────────────────────

const WALK_IN_KEYWORDS = [
  'ahorita', 'ahora', 'ya', 'hoy mismo', 'lo antes posible',
  'cuándo tienen', 'cuando tienen', 'que tengan', 'inmediatamente',
  'ahorita mismo', 'en este momento', 'lo mas pronto', 'lo más pronto',
  'cuanto antes',
];

// ─── Keywords de turno ────────────────────────────────────────────────────────

const MORNING_KEYWORDS   = ['mañana por la', 'por la mañana', 'en la mañana', 'matutino', 'matutina', 'am'];
const AFTERNOON_KEYWORDS = ['tarde', 'por la tarde', 'en la tarde', 'vespertino', 'vespertina', 'pm'];

// ─── Días de la semana ────────────────────────────────────────────────────────

const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
};

const FLOW_QUESTION = DATE_QUESTION_MESSAGE;

// Intentos totales de clarificación antes de escalar a FALLBACK.
// Exportado para el test de relación de caps (S5-BOT-12).
export const MAX_TOTAL_ATTEMPTS = 5;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleQualifyingDatetime(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  // ── @deprecated (FIX 2): resolución de `pendingPeriodTime` — COMPAT en vuelo ──
  // El modelo nuevo ya NO pregunta el período de entrada (difiere a la agenda vía
  // pendingAgendaTime), así que `pendingPeriodTime` ya no se ESCRIBE. Este bloque se
  // conserva solo para CERRAR conversaciones que quedaron con `pendingPeriodTime`
  // seteado al desplegar (resuelve su reply "de la tarde" → 17:00 y limpia el campo).
  // DEUDA: borrar este bloque + el campo del schema en una limpieza futura (semanas
  // post-deploy, sin conversaciones en vuelo).
  if (context.pendingPeriodTime) {
    const period = detectPeriodFromReply(msg.body);
    if (period) {
      const { hour, minute } = context.pendingPeriodTime;
      const resolvedHour = period === 'afternoon' && hour < 12 ? hour + 12 : hour;
      const newContext: LifestyleBotContext = {
        ...context,
        requestedTime:          fmtTime(resolvedHour, minute),
        requestedShift:         period,
        pendingPeriodTime:      undefined,
        clarification_attempts: 0,
        last_side_question:     null,
      };
      if (newContext.requestedDate) {
        return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
      }
      return {
        newState:     'QUALIFYING_DATETIME',
        newContext,
        responseText: buildDayOnlyQuestion(),
      };
    }
    // Sin período en este turno → soltar la hora aparcada y seguir el flujo normal.
    context = { ...context, pendingPeriodTime: undefined };
  }

  // ── Fast path: fecha y hora ya resueltas desde greeting ─────────────────
  // El router encadena QUALIFYING_DATETIME → SHOWING_SLOTS al ver responseText ''

  if (context.requestedDate) {
    return {
      newState:     'SHOWING_SLOTS',
      newContext:   { ...context, clarification_attempts: 0, last_side_question: null },
      responseText: '',
    };
  }

  const lower = msg.body.trim().toLowerCase();

  // ── Corrección de servicio mid-flow ──────────────────────────────────────

  if (detectsServiceCorrection(lower)) {
    return {
      newState: 'QUALIFYING_SERVICE',
      newContext: {
        ...context,
        serviceId:                    undefined,
        staffId:                      undefined,
        requestedDate:                undefined,
        requestedTime:                undefined,
        requestedShift:               undefined,
        pendingAgendaTime:            undefined,
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
      },
      responseText: SERVICE_QUESTION_RESET,
    };
  }

  // ── Fast path: detección walk-in ─────────────────────────────────────────

  if (WALK_IN_KEYWORDS.some((kw) => lower.includes(kw))) {
    const today = getTodayStr(deps.business.timezone);
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               true,
      requestedDate:          today,
      requestedShift:         null,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return {
      newState:     'SHOWING_SLOTS',
      newContext,
      responseText: '',
    };
  }

  // ── Fast path: turno + fecha determinista ────────────────────────────────

  let shift: 'morning' | 'afternoon' | null = null;
  if (AFTERNOON_KEYWORDS.some((kw) => lower.includes(kw))) shift = 'afternoon';
  else if (MORNING_KEYWORDS.some((kw) => lower.includes(kw))) shift = 'morning';

  // R2 C1: el date se LEE del intérprete (computado 1×/turno en dispatch) en vez
  // de re-parsear crudo. Valor idéntico (interpret() llama al mismo parseDate; el
  // único delta es un .trim() irrelevante para .includes()/regex). El fallback a
  // parseDate cubre call-sites sin interpretation (deps armadas a mano).
  const parsedDate = deps.interpretation?.date
    ?? parseDate(lower, msg.timestamp, deps.business.timezone);

  // R2 C2.1 / FIX 2: la hora se LEE del intérprete y se resuelve con la POLÍTICA
  // ÚNICA (resolveInterpretedTime + applyTimeRes, compartida con greeting). Período
  // explícito → "HH:MM"; hora 1–11 en punto sin marcador → 'defer-agenda' (se
  // resuelve contra la agenda real en SHOWING_SLOTS, NO se pregunta de entrada).
  const interpretedTime = deps.interpretation?.time ?? null;
  const timePatch = applyTimeRes(interpretedTime ? resolveInterpretedTime(interpretedTime) : null);

  // Hora ambigua → APARCAR cruda (conservando la fecha si vino) y diferir a la agenda.
  // El shift NO se deriva aquí (no sabemos AM/PM aún): se deriva al resolver.
  if (timePatch && 'pendingAgendaTime' in timePatch) {
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      ...(parsedDate ? { requestedDate: parsedDate } : {}),
      pendingAgendaTime:      timePatch.pendingAgendaTime,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    // Con fecha → SHOWING_SLOTS resuelve contra agenda; sin fecha → preguntar el día.
    if (parsedDate) {
      return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
    }
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext,
      responseText: buildDayOnlyQuestion(),
    };
  }

  // Hora resuelta (período explícito | minutos | 12 | 0 | 13–23): con fecha → avanzar
  // a slots; SIN fecha → guardar la hora y preguntar SOLO el día (no se pierde).
  if (timePatch && 'requestedTime' in timePatch) {
    const resolvedShift: 'morning' | 'afternoon' =
      parseInt(timePatch.requestedTime.split(':')[0]!, 10) >= 13 ? 'afternoon' : 'morning';
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      ...(parsedDate ? { requestedDate: parsedDate } : {}),
      requestedShift:         resolvedShift,
      requestedTime:          timePatch.requestedTime,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    if (parsedDate) {
      return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
    }
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext,
      responseText: buildDayOnlyQuestion(),
    };
  }

  // Sin hora pero con fecha → avanzar a slots con el shift de keywords (igual que antes).
  if (parsedDate) {
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      requestedDate:          parsedDate,
      requestedShift:         shift,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return {
      newState:     'SHOWING_SLOTS',
      newContext,
      responseText: '',
    };
  }

  // ── No-preferencia de FECHA (Hallazgo 4) ──────────────────────────────────
  // "cualquier día" / "el que sea" / "da igual" SIN fecha concreta: el cliente YA
  // respondió "¿qué día?" — no tiene preferencia. Gemelo de R4.2 (no-preferencia de
  // barbero) en el eje FECHA. El eje lo fija el ESTADO: aquí el barbero ya se resolvió
  // (staffId o autoAssign), así que noPreference = FECHA, no barbero. Determinista, va
  // ANTES del clasificador (evita Haiku). Consume interpretation.noPreference (CRUDO,
  // 1×/turno); fallback al keyword-match local para call-sites sin interpretation
  // (tests) — estrangulamiento R4.1. La fecha concreta (arriba) GANA: "cualquier día…
  // el martes" respeta el martes.
  //
  // Opción A: resolver al PRIMER día con cupo. Seteamos HOY y delegamos a SHOWING_SLOTS
  // (chequea hoy primero, cae a findSlotsInNextDays si está vacío) — NO findSlotsInNextDays
  // directo, que arranca en hoy+1 y saltearía un hoy con cupo.
  const noPreference = deps.interpretation
    ? deps.interpretation.noPreference
    : NO_PREFERENCE_KEYWORDS.some((kw) => lower.includes(kw));
  if (noPreference) {
    const today          = getTodayStr(deps.business.timezone);
    const hasStaffChoice = context.staffId || context.autoAssign;
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      requestedDate:          today,
      requestedShift:         shift,
      ...(hasStaffChoice ? {} : { autoAssign: true }),
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return {
      newState:     'SHOWING_SLOTS',
      newContext,
      responseText: '',
    };
  }

  // ── FASE B: pregunta de disponibilidad sin fecha concreta ────────────────
  // "¿a qué hora tienes?" / "¿qué disponibilidad hay?" sin un día explícito:
  // partir de HOY y mostrar slots reales. SHOWING_SLOTS ofrecerá las fechas
  // más cercanas si hoy no hay. No re-preguntar el día.
  if (isAvailabilityQuestion(lower)) {
    const today          = getTodayStr(deps.business.timezone);
    const hasStaffChoice = context.staffId || context.autoAssign;
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      requestedDate:          today,
      requestedShift:         shift,
      ...(hasStaffChoice ? {} : { autoAssign: true }),
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return {
      newState:     'SHOWING_SLOTS',
      newContext,
      responseText: '',
    };
  }

  // ── Slow path: clasificador ───────────────────────────────────────────────

  const datetimeOptions = [
    'hoy', 'mañana', 'pasado mañana',
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
    'por la mañana', 'por la tarde',
  ];

  const businessContext = `Negocio: ${deps.business.name}`;
  const recentHistory   = (context.messages ?? []).slice(-2);
  const attempts        = context.clarification_attempts ?? 0;

  const classification = await deps.classifier.classifyIntent({
    userMessage:      msg.body,
    availableOptions: datetimeOptions,
    flowQuestion:     FLOW_QUESTION,
    businessContext,
    recentHistory,
    anthropicKey:     deps.anthropicKey,
  });

  // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
  logClassifierOutput({
    supabase:      deps.supabase,
    businessId:    deps.business.id,
    customerPhone: msg.customerPhone,
    state:         'QUALIFYING_DATETIME',
    metadata:      buildSingleClassifierMetadata(classification, msg.body),
  });

  const clarResult = handleClassification({
    classification,
    currentState:          'QUALIFYING_DATETIME',
    context,
    availableOptions:      datetimeOptions,
    clarificationAttempts: attempts,
  });

  // ── ADVANCE con DATE_PREFERENCE ───────────────────────────────────────────

  if (clarResult.action === 'ADVANCE' && classification.intent === 'DATE_PREFERENCE') {
    const extractedValue = classification.value ?? '';
    const extractedLower = extractedValue.toLowerCase();

    // Intentar parsear la fecha del value del clasificador
    const classifierDate = parseDate(extractedLower, msg.timestamp, deps.business.timezone);

    // Parsear turno del value
    let classifierShift: 'morning' | 'afternoon' | null = null;
    if (AFTERNOON_KEYWORDS.some((kw) => extractedLower.includes(kw))) classifierShift = 'afternoon';
    else if (MORNING_KEYWORDS.some((kw) => extractedLower.includes(kw))) classifierShift = 'morning';

    if (classifierDate) {
      const newContext: LifestyleBotContext = {
        ...clarResult.updatedContext,
        isWalkIn:       false,
        requestedDate:  classifierDate,
        requestedShift: classifierShift ?? shift,
      };
      return {
        newState:     'SHOWING_SLOTS',
        newContext,
        responseText: '',
      };
    }

    // Si el clasificador dijo ADVANCE pero la fecha no se pudo parsear, caer a CLARIFY
  }

  // ── SIDE QUESTION ─────────────────────────────────────────────────────────

  if (classification.intent === 'SIDE_QUESTION' && clarResult.prefixMessage) {
    const responseText = buildSideQuestionResponse(clarResult.prefixMessage, FLOW_QUESTION);
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext:   clarResult.updatedContext,
      responseText,
    };
  }

  // ── CLARIFY o REPEAT_OPTIONS ──────────────────────────────────────────────
  // Si se superó MAX_TOTAL_ATTEMPTS → escalar a FALLBACK con agente humano.

  if ((clarResult.updatedContext.clarification_attempts ?? 0) >= MAX_TOTAL_ATTEMPTS) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context, clarification_attempts: 0 },
      responseText: ESCALATION_TO_TEAM_MESSAGE,
    };
  }

  return {
    newState:     'QUALIFYING_DATETIME',
    newContext:   clarResult.updatedContext,
    responseText:
      'No entendí bien qué día prefieres. ¿Puedes decirme algo como "este viernes", "el martes" o una fecha como "23 de abril"?',
  };
}

// ─── Resolución de hora (R2 C2.1) ─────────────────────────────────────────────
// POLÍTICA ÚNICA de hora del FSM (R2 C2/P3b): tanto QUALIFYING_DATETIME como
// GREETING resuelven la hora cruda del intérprete con ESTA función. No hay un
// segundo parser de hora con política propia (antes greeting.parseTime adivinaba
// 1–6→PM, divergiendo de aquí). Un solo parser (extractRawTime en interpreter.ts)
// + una sola política de resolución (esta).

export type TimeResolution =
  | { kind: 'resolved';     hhmm: string }
  | { kind: 'defer-agenda'; hour: number; minute: number };

/**
 * Resuelve la hora cruda del intérprete a "HH:MM" (24h) o la DIFIERE a la agenda.
 * - period explícito (am/pm) → se respeta.
 * - period null + hora 1–11 EN PUNTO → 'defer-agenda': ambigua (8 = 8am ó 8pm), se
 *   resuelve contra la AGENDA real más adelante (handleHonestAvailability), NO se
 *   adivina ni se pregunta de entrada.
 * - period null + (minutos > 0 | hora 0 | hora 12 | hora ≥ 13) → literal 24h.
 *
 * Por qué `m === 0` es la línea: una hora EN PUNTO sin período es genuinamente
 * ambigua (8 = 8am ó 8pm); con minutos asumimos lectura de reloj 24h literal ("8:30"
 * no es ambiguo). Mediodía (12), medianoche (0) y 13–23 son inequívocos.
 *
 * (FIX 2) Unifica 1–6 y 7–11 bajo el MISMO modelo: ambas difieren a la agenda. Antes
 * 7–11 se horneaba a AM (bug "a las 8" → 8am) y 1–6 preguntaba el período.
 */
export function resolveInterpretedTime(
  time: { hour: number; minute: number; period: 'am' | 'pm' | null },
): TimeResolution {
  let h = time.hour;
  const m = time.minute;
  if (time.period === 'pm') { if (h < 12) h += 12; return { kind: 'resolved', hhmm: fmtTime(h, m) }; }
  if (time.period === 'am') { if (h === 12) h = 0;  return { kind: 'resolved', hhmm: fmtTime(h, m) }; }
  if (m === 0 && h >= 1 && h <= 11) return { kind: 'defer-agenda', hour: h, minute: m };
  return { kind: 'resolved', hhmm: fmtTime(h, m) };
}

/**
 * POLÍTICA ÚNICA de consumo de la hora (FIX 2): traduce una TimeResolution al patch
 * de contexto correspondiente. greeting y qualifyingDatetime la llaman IDÉNTICO para
 * que "a las 8" dé el mismo resultado por ambas entradas (si divergieran, volvería el
 * bug de "greeting adivina distinto"). 'resolved' → requestedTime; 'defer-agenda' →
 * pendingAgendaTime (sin requestedTime ni shift: el shift se deriva al resolver).
 */
export type TimeResolutionPatch =
  | { requestedTime: string }
  | { pendingAgendaTime: { hour: number; minute: number } }
  | null;

export function applyTimeRes(timeRes: TimeResolution | null): TimeResolutionPatch {
  if (!timeRes) return null;
  if (timeRes.kind === 'resolved') return { requestedTime: timeRes.hhmm };
  return { pendingAgendaTime: { hour: timeRes.hour, minute: timeRes.minute } };
}

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Detecta el período del turno-respuesta a "¿mañana o tarde?". Normaliza (sin
// diacríticos) para aceptar "de la mañana"/"en la tarde"/"tarde"/am/pm.
function detectPeriodFromReply(body: string): 'morning' | 'afternoon' | null {
  const norm = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/tarde|noche|\bpm\b/.test(norm))         return 'afternoon';
  if (/manana|matutin|\bam\b/.test(norm))      return 'morning';
  return null;
}

function buildDayOnlyQuestion(): string {
  return 'Perfecto. ¿Para qué día te gustaría? Puedes decirme el día de la semana o una fecha (ej. "este viernes").';
}

// ─── Parseo de fecha ──────────────────────────────────────────────────────────

/**
 * Parsea expresiones de fecha en español.
 * Retorna string YYYY-MM-DD (en timezone del negocio) o null si no se reconoce.
 *
 * @param now  UTC Date de referencia (ej: msg.timestamp del servidor)
 * @param tz   IANA timezone del negocio — todas las fechas se calculan en este TZ
 */
export function parseDate(lower: string, now: Date, tz: string): string | null {
  // Construir una fecha "virtual" con los componentes del día local correcto.
  // Al usar noonUTCDate del día local, .getDate()/.getDay()/.getFullYear() etc.
  // sobre este objeto devuelven los valores correctos en el timezone del negocio.
  const localDateStr = utcToLocalDateStr(now, tz);
  const nowLocal     = noonUTCDate(localDateStr);

  if (lower.includes('hoy')) return dateToStr(nowLocal);

  // "pasado mañana" debe verificarse ANTES de "mañana": \bmañana\b matchea ambos.
  if (lower.includes('pasado mañana') || lower.includes('pasado manana')) {
    const d = new Date(nowLocal);
    d.setUTCDate(d.getUTCDate() + 2);
    return dateToStr(d);
  }

  // "mañana" como fecha — aplica también a "mañana por la tarde" y "mañana por la mañana".
  // El shift (morning/afternoon) se detecta por separado vía MORNING_KEYWORDS / AFTERNOON_KEYWORDS.
  if (/\bmañana\b/.test(lower)) {
    const tomorrow = new Date(nowLocal);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return dateToStr(tomorrow);
  }

  for (const [dayName, dayNum] of Object.entries(DAY_MAP)) {
    if (lower.includes(dayName)) {
      const isNext = lower.includes('próximo') || lower.includes('proximo') || lower.includes('siguiente');
      const d = nextWeekday(nowLocal, dayNum, isNext);
      return dateToStr(d);
    }
  }

  const monthMap: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };

  const monthNameMatch = lower.match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/,
  );
  if (monthNameMatch) {
    const day   = parseInt(monthNameMatch[1]!, 10);
    const month = monthMap[monthNameMatch[2]!] ?? -1;
    if (month >= 0 && day >= 1 && day <= 31) {
      const year = nowLocal.getUTCFullYear();
      const d    = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (d < nowLocal) d.setUTCFullYear(year + 1);
      return dateToStr(d);
    }
  }

  const slashMatch = lower.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (slashMatch) {
    const day   = parseInt(slashMatch[1]!, 10);
    const month = parseInt(slashMatch[2]!, 10) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = nowLocal.getUTCFullYear();
      const d    = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (d < nowLocal) d.setUTCFullYear(year + 1);
      return dateToStr(d);
    }
  }

  return null;
}

function nextWeekday(from: Date, targetDay: number, isNext: boolean): Date {
  const d    = new Date(from);
  const diff = (targetDay - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + (diff === 0 || isNext ? diff + 7 : diff));
  return d;
}

function dateToStr(d: Date): string {
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

