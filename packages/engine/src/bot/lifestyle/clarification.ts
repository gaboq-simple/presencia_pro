// ─── Lifestyle Bot — Clarification Logic ─────────────────────────────────────
// Aplica las reglas de confianza sobre IntentClassification y decide
// si el flujo debe avanzar, pedir clarificación, o repetir opciones.
//
// Reglas:
//   confidence ≥ 0.85 → ADVANCE
//   confidence 0.60-0.84 → CLARIFY (pregunta específica)
//   confidence < 0.60 → REPEAT_OPTIONS (lista numerada)
//   clarificationAttempts ≥ 2 → fuerza REPEAT_OPTIONS sin importar confianza
//   SideQuestionIntent con confidence ≥ 0.85 → CLARIFY (retoma flujo)
//     action = 'CLARIFY', prefixMessage = respuesta, mensaje = prefix + conector + pregunta
//
// Sin efectos secundarios — función pura.

import type { IntentClassification } from './classifier';
import type { LifestyleBotContext, LifestyleBotState } from '../../types/lifestyle.types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ClarificationAction = 'ADVANCE' | 'CLARIFY' | 'REPEAT_OPTIONS' | 'TECH_ISSUE' | 'DATE_HINT' | 'DECLINED';

export type ClarificationResult = {
  /** Acción a tomar en el state handler. */
  readonly action:         ClarificationAction;
  /** Contexto actualizado (clarification_attempts incrementado o reseteado). */
  readonly updatedContext: LifestyleBotContext;
  /**
   * Mensaje de respuesta a una side question, para anteponer al mensaje del flujo.
   * Solo se llena cuando intent === SIDE_QUESTION con alta confianza.
   * Null en todos los demás casos.
   */
  readonly prefixMessage:  string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const ADVANCE_THRESHOLD  = 0.85;
const CLARIFY_THRESHOLD  = 0.60;
const MAX_CLARIFICATIONS = 2;

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Decide la acción a tomar basada en la clasificación y el estado actual.
 *
 * @param params.classification Resultado del clasificador de intenciones.
 * @param params.currentState   Estado del bot en el que se recibió el mensaje.
 * @param params.context        Contexto actual del bot (se lee clarification_attempts).
 * @param params.availableOptions Opciones disponibles en el estado actual.
 * @param params.clarificationAttempts Intentos de clarificación acumulados en este estado.
 */
export function handleClassification(params: {
  classification:        IntentClassification;
  currentState:          LifestyleBotState;
  context:               LifestyleBotContext;
  availableOptions:      string[];
  clarificationAttempts: number;
}): ClarificationResult {
  const {
    classification,
    context,
    availableOptions,
    clarificationAttempts,
  } = params;

  const { intent, confidence, side_question_answer } = classification;

  // ── Fallo TÉCNICO del clasificador (AUD-07b) ──────────────────────────────
  // Timeout/API caída/JSON ilegible — NO es incomprensión del cliente. No se
  // gastan clarification_attempts (un outage de Anthropic no debe empujar la
  // conversación a la escalación por "no entender") y el caller responde
  // TECHNICAL_HICCUP_MESSAGE en vez de fingir "no te entendí".

  if (classification.failure_reason) {
    return {
      action:         'TECH_ISSUE',
      updatedContext: { ...context },
      prefixMessage:  null,
    };
  }

  // ── Side question con confianza suficiente ────────────────────────────────
  // El estado NO cambia — solo respondemos la pregunta y retomamos el flujo.

  if (intent === 'SIDE_QUESTION' && confidence >= ADVANCE_THRESHOLD) {
    const prefix = side_question_answer ?? null;
    const updatedContext: LifestyleBotContext = {
      ...context,
      last_side_question: classification.value ?? null,
      // clarification_attempts NO se incrementa por una side question
    };
    return {
      action:         'CLARIFY',
      updatedContext,
      prefixMessage:  prefix,
    };
  }

  // ── Consumo del TIPO de intent (deuda #1 — punto #3 de S4-BOT-09) ─────────
  // Antes solo se miraba confidence y el tipo se tiraba: DATE_PREFERENCE 0.95
  // ("para el viernes") en QUALIFYING_SERVICE caía en ADVANCE →
  // findMatchingServices("viernes") = [] → REPEAT_OPTIONS y la fecha se
  // DESCARTABA (el cliente la repetía después — "te dije el viernes");
  // CONFIRM_NO 0.95 ("no, mejor nada gracias") caía al menú en bucle.

  // Fecha dicha en un paso que no la pedía → el estado la PERSISTE y sigue con
  // su pregunta. Umbral bajo (CLARIFY): el estado valida con parseDate
  // determinista antes de usarla. QUALIFYING_DATETIME queda fuera: ahí la
  // fecha ES la respuesta y su parseo determinista ya corre antes.
  if (
    intent === 'DATE_PREFERENCE' &&
    confidence >= CLARIFY_THRESHOLD &&
    params.currentState !== 'QUALIFYING_DATETIME'
  ) {
    return {
      action:         'DATE_HINT',
      updatedContext: { ...context },   // attempts intactos — dar una fecha es avance, no confusión
      prefixMessage:  null,
    };
  }

  // Negación de alta confianza al elegir servicio → el cliente declina el
  // flujo, no "no entendió el menú". Salida cálida en vez de bucle.
  if (
    intent === 'CONFIRM_NO' &&
    confidence >= ADVANCE_THRESHOLD &&
    params.currentState === 'QUALIFYING_SERVICE'
  ) {
    return {
      action:         'DECLINED',
      updatedContext: { ...context },
      prefixMessage:  null,
    };
  }

  // ── Forzar REPEAT_OPTIONS si ya se intentó clarificar demasiado ──────────
  // El contador sigue incrementando (no se congela en MAX_CLARIFICATIONS) para
  // que los state handlers puedan detectar MAX_TOTAL_ATTEMPTS y escalar.

  if (clarificationAttempts >= MAX_CLARIFICATIONS) {
    return {
      action:         'REPEAT_OPTIONS',
      updatedContext: {
        ...context,
        clarification_attempts: clarificationAttempts + 1,
      },
      prefixMessage:  null,
    };
  }

  // ── Umbral alto → ADVANCE ─────────────────────────────────────────────────

  if (confidence >= ADVANCE_THRESHOLD) {
    return {
      action:         'ADVANCE',
      updatedContext: {
        ...context,
        clarification_attempts: 0,   // reset al avanzar
        last_side_question:     null,
      },
      prefixMessage: null,
    };
  }

  // ── Umbral medio → CLARIFY ────────────────────────────────────────────────

  if (confidence >= CLARIFY_THRESHOLD) {
    return {
      action:         'CLARIFY',
      updatedContext: {
        ...context,
        clarification_attempts: clarificationAttempts + 1,
      },
      prefixMessage: null,
    };
  }

  // ── Umbral bajo → REPEAT_OPTIONS ─────────────────────────────────────────

  return {
    action:         'REPEAT_OPTIONS',
    updatedContext: {
      ...context,
      clarification_attempts: clarificationAttempts + 1,
    },
    prefixMessage: null,
  };
}

// ─── Helpers públicos ─────────────────────────────────────────────────────────

/**
 * Genera un mensaje de aclaración específica cuando confidence es media.
 * Usa las opciones disponibles para hacer la pregunta más concreta.
 */
export function buildClarifyMessage(
  userInput:        string,
  availableOptions: string[],
  flowQuestion:     string,
): string {
  if (availableOptions.length === 0) {
    return `No entendí bien. ${flowQuestion}`;
  }

  // Intentar encontrar la opción más cercana para confirmar
  const lower = userInput.toLowerCase();
  const closest = availableOptions.find(
    (opt) => opt.toLowerCase().includes(lower) || lower.includes(opt.toLowerCase()),
  );

  if (closest) {
    return `Te refieres a "${closest}"?`;
  }

  return `No entendí bien cuál elegiste. ${flowQuestion}`;
}

/**
 * Genera el mensaje de opciones numeradas para REPEAT_OPTIONS.
 */
export function buildRepeatOptionsMessage(
  availableOptions: string[],
  flowQuestion:     string,
): string {
  if (availableOptions.length === 0) {
    return flowQuestion;
  }

  const numbered = availableOptions
    .map((opt, i) => `${i + 1}. ${opt}`)
    .join('\n');

  return `${flowQuestion}\n\n${numbered}`;
}

/**
 * Combina el prefixMessage (respuesta side question) con la pregunta del flujo.
 * Sin conectores de relleno ("Dicho eso —", "Por cierto —"): la respuesta es
 * dato + pregunta natural de retorno. Se unen con salto de línea para que un
 * link al final del dato quede en su propia línea (nunca pegado a la pregunta).
 */
export function buildSideQuestionResponse(
  prefixMessage: string,
  flowQuestion:  string,
): string {
  return `${prefixMessage}\n${flowQuestion}`;
}
