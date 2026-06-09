// ─── State: AWAITING_CONFIRMATION ─────────────────────────────────────────────
// El cliente responde SÍ o NO a la cita resumida.
//
// Fast path (keywords directos):
//   SÍ → CONFIRMED.
//   NO → reinicia flujo desde QUALIFYING_SERVICE.
//
// Slow path (clasificador):
//   Texto ambiguo → classifyIntent() con Haiku.
//   CONFIRM_YES con confianza ≥ 0.85 → CONFIRMED.
//   CONFIRM_NO  con confianza ≥ 0.85 → QUALIFYING_SERVICE.
//   SIDE_QUESTION → responde y retoma con conector.
//   Ambiguo → incrementa confirmationRetries. Tras 2 intentos: FALLBACK.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { classifyIntent } from '../classifier';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import { buildSideQuestionResponse } from '../clarification';
import { getCatalog } from '../catalog';
import { buildBusinessContext } from '../businessContext';
import { answerSideQuestionDeterministic } from '../sideQuestion';
import { logBotError } from '../utils/logger';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const MAX_RETRIES = 2;

const YES_KEYWORDS = [
  'sí', 'si', 'yes', 'claro', 'ok', 'dale', 'listo', 'va', 'confirmo',
  'confirmar', 'perfecto', 'de acuerdo', 'acepto', 'anótame', 'anotame',
  'agendar', 'agenda', 'quiero', 'adelante', 'por favor',
];

const NO_KEYWORDS = [
  'no', 'nope', 'cancelar', 'cancel', 'no quiero', 'no gracias',
  'otro día', 'otro dia', 'cambiar', 'mejor no', 'negativo',
];

const FLOW_QUESTION = 'Confirmamos la cita? Solo dime "si" o "no".';
const CONFIRM_THRESHOLD = 0.85;

/**
 * Verifica si el texto comienza con un keyword de confirmación.
 * Acepta cualquier caracter no-alfanumérico después del keyword (coma, ?, !, espacio).
 */
function startsWithYesKeyword(lower: string): boolean {
  return YES_KEYWORDS.some((kw) => {
    if (!lower.startsWith(kw)) return false;
    if (lower.length === kw.length) return true;
    const nextChar = lower[kw.length]!;
    return !/[a-záéíóúüñ]/i.test(nextChar);
  });
}

function endsWithYesKeyword(lower: string): boolean {
  return YES_KEYWORDS.some((kw) => {
    if (!lower.endsWith(kw)) return false;
    if (lower.length === kw.length) return true;
    const prevChar = lower[lower.length - kw.length - 1]!;
    return !/[a-záéíóúüñ]/i.test(prevChar);
  });
}

function containsQuestion(lower: string): boolean {
  return lower.includes('?') ||
    /\b(cuanto|cuánto|cuántos|cuantos|precio|costo|cuesta|vale|dura|duracion|duración|incluye|qué incluye|que incluye)\b/.test(lower);
}

export async function handleAwaitingConfirmation(
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  const lower   = msg.body.trim().toLowerCase();
  const retries = context.confirmationRetries ?? 0;

  // ── Fast path: SÍ exacto ─────────────────────────────────────────────────

  const isYes = YES_KEYWORDS.some((kw) => lower === kw) ||
    startsWithYesKeyword(lower) ||
    endsWithYesKeyword(lower);

  if (isYes) {
    // Si además hay una pregunta, confirmar y responder la pregunta
    if (containsQuestion(lower) && context.serviceId) {
      const sideAnswer = await buildSideAnswerFromService(context.serviceId, deps);
      if (sideAnswer) {
        return buildConfirmYesWithSideAnswer(context, sideAnswer);
      }
    }
    return buildConfirmYesResult(context);
  }

  // ── Fast path: NO ────────────────────────────────────────────────────────

  if (NO_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw))) {
    return buildConfirmNoResult(context);
  }

  // ── Slow path: clasificador ───────────────────────────────────────────────

  const catalog         = await getCatalog(deps.business.id, deps.supabase);
  const businessContext = buildBusinessContext(deps.business, catalog, {
    appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '',
  });
  const recentHistory   = (context.messages ?? []).slice(-2);

  const classification = await classifyIntent({
    userMessage:      msg.body,
    availableOptions: ['sí, confirmar', 'no, cancelar'],
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
    state:         'AWAITING_CONFIRMATION',
    metadata:      buildSingleClassifierMetadata(classification, msg.body),
  });

  // ── CONFIRM_YES via clasificador (prioridad sobre side question) ──────────

  if (
    classification.intent === 'CONFIRM_YES' &&
    classification.confidence >= CONFIRM_THRESHOLD
  ) {
    // Si hay pregunta en el mensaje, responderla después de confirmar
    if (containsQuestion(lower) && context.serviceId) {
      const sideAnswer = await buildSideAnswerFromService(context.serviceId, deps);
      if (sideAnswer) {
        return buildConfirmYesWithSideAnswer(context, sideAnswer);
      }
    }
    return buildConfirmYesResult(context);
  }

  // ── CONFIRM_NO via clasificador ──────────────────────────────────────────

  if (
    classification.intent === 'CONFIRM_NO' &&
    classification.confidence >= CONFIRM_THRESHOLD
  ) {
    return buildConfirmNoResult(context);
  }

  // ── SIDE QUESTION (sin confirmación) ──────────────────────────────────────
  // GAP 2 (S4-BOT-07): si no hay respuesta del clasificador (side_question_answer
  // null), derivar deterministamente en vez de caer al fallback ambiguo.

  if (
    classification.intent === 'SIDE_QUESTION' &&
    classification.confidence >= CONFIRM_THRESHOLD
  ) {
    const answer = classification.side_question_answer
      ?? answerSideQuestionDeterministic(
        classification.value ?? msg.body,
        deps.business,
        catalog,
        { appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '' },
      );
    const responseText = buildSideQuestionResponse(answer, FLOW_QUESTION);
    return {
      newState:     'AWAITING_CONFIRMATION',
      newContext:   {
        ...context,
        last_side_question: classification.value ?? null,
      },
      responseText,
    };
  }

  // ── Ambiguo: incrementar retries ─────────────────────────────────────────

  if (retries >= MAX_RETRIES - 1) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context, confirmationRetries: retries + 1 },
      responseText: deps.business.fallbackMessage,
    };
  }

  return {
    newState:     'AWAITING_CONFIRMATION',
    newContext:   { ...context, confirmationRetries: retries + 1 },
    responseText: 'Solo dime "si" para confirmar o "no" para cancelar.',
  };
}

// ─── Helpers de side answer ───────────────────────────────────────────────────

async function buildSideAnswerFromService(
  serviceId: string,
  deps:       StateHandlerDeps,
): Promise<string | null> {
  try {
    const catalog = await getCatalog(deps.business.id, deps.supabase);
    const service = catalog.find((s) => s.id === serviceId);
    if (!service) return null;

    const priceStr = service.price > 0
      ? `$${service.price.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${service.currency}`
      : 'sin costo adicional';

    return `El costo es ${priceStr} y la duracion es de ${service.duration_minutes} min.`;
  } catch (err) {
    logBotError({ context: 'awaitingConfirmation.buildSideAnswerFromService', error: err, businessId: deps.business.id });
    return null;
  }
}

// ─── Builders de resultado ────────────────────────────────────────────────────

function buildConfirmYesResult(context: LifestyleBotContext): StateHandlerResult {
  return {
    newState:     'CONFIRMED',
    newContext:   {
      ...context,
      confirmationRetries:    0,
      clarification_attempts: 0,
      last_side_question:     null,
    },
    responseText: '',
  };
}

function buildConfirmYesWithSideAnswer(
  context:    LifestyleBotContext,
  sideAnswer: string,
): StateHandlerResult {
  return {
    newState: 'CONFIRMED',
    newContext: {
      ...context,
      confirmationRetries:    0,
      clarification_attempts: 0,
      last_side_question:     null,
    },
    // El router concatena este responseText después del mensaje de confirmación
    // generado por handleConfirmed (BUG 3 fix en router.ts).
    responseText: sideAnswer,
  };
}

function buildConfirmNoResult(context: LifestyleBotContext): StateHandlerResult {
  const resetContext: LifestyleBotContext = {
    customerId:             context.customerId,
    messages:               context.messages,
    confirmationRetries:    0,
    fallbackAttempts:       0,
    clarification_attempts: 0,
    last_side_question:     null,
  };
  return {
    newState:     'QUALIFYING_SERVICE',
    newContext:   resetContext,
    responseText: 'Sin problema. Que servicio te interesa?',
  };
}
