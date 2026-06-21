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
import { classifyIntent } from '../classifier';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import {
  handleClassification,
  buildSideQuestionResponse,
} from '../clarification';
import { detectsServiceCorrection } from '../utils';
import { isAvailabilityQuestion } from '../availabilityIntent';
import { utcToLocalDateStr, getTodayStr, noonUTCDate } from '../tzUtils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

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

const FLOW_QUESTION = 'Para que dia prefieres tu cita? Puedes decirme el dia de la semana o fecha, y si prefieres manana o tarde.';

// Intentos totales de clarificación antes de escalar a FALLBACK.
// Exportado para el test de relación de caps (S5-BOT-12).
export const MAX_TOTAL_ATTEMPTS = 5;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleQualifyingDatetime(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
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
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
      },
      responseText: 'Sin problema. Cual servicio te interesa?',
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

  const parsedDate = parseDate(lower, msg.timestamp, deps.business.timezone);

  if (parsedDate) {
    const parsedTimeStr = parseTimeFromText(lower);
    let resolvedShift = shift;
    if (parsedTimeStr) {
      const hour = parseInt(parsedTimeStr.split(':')[0]!, 10);
      resolvedShift = hour >= 13 ? 'afternoon' : 'morning';
    }
    const newContext: LifestyleBotContext = {
      ...context,
      isWalkIn:               false,
      requestedDate:          parsedDate,
      requestedShift:         resolvedShift,
      ...(parsedTimeStr ? { requestedTime: parsedTimeStr } : {}),
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

  const classification = await classifyIntent({
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
      responseText: 'Parece que no estamos conectando. Dejame pasarte con alguien del equipo para ayudarte mejor.',
    };
  }

  return {
    newState:     'QUALIFYING_DATETIME',
    newContext:   clarResult.updatedContext,
    responseText:
      'No entendi bien que dia prefieres. Puedes decirme algo como "este viernes", "el martes" o una fecha como "23 de abril"?',
  };
}

// ─── Parseo de hora ───────────────────────────────────────────────────────────

/**
 * Parsea "a las N" / "a las HH:MM" del texto en español a "HH:MM".
 * Heurística: horas 1–6 sin contexto → PM.
 */
function parseTimeFromText(lower: string): string | null {
  const isMorning   = /\b(am|de la ma[ñn]ana|matutino)\b/.test(lower);
  const isAfternoon = /\b(tarde|pm|de la tarde|vespertino)\b/.test(lower);

  const match = lower.match(/a\s+las?\s+(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  let hour      = parseInt(match[1]!, 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  if (isAfternoon && hour < 12) hour += 12;
  else if (!isMorning && hour >= 1 && hour <= 6) hour += 12;

  if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

