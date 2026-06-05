// ─── Lifestyle Bot — Continuidad conversacional ──────────────────────────────
// S4-BOT-05 / FIX 3. Antes, el historial acumulado en handler.ts NO llegaba a
// las llamadas generativas (greeting.ts y otras enviaban solo una instrucción
// sintetizada). Por eso el bot "olvidaba" el turno anterior y re-saludaba a
// media conversación.
//
// Este módulo es PURO (sin red, sin SDK) y concentra la lógica de continuidad:
//   - detectar si la conversación ya está en curso (hay historial),
//   - construir el arreglo de mensajes para el generador (historial + instrucción),
//   - resolver el plan del saludo de forma que, si la conversación NO es inicial,
//     el generador NO produzca un saludo de bienvenida (anti re-saludo).
//
// Alcance: CONTINUIDAD. No hace mirroring de tono ni responde preguntas nuevas
// (eso es sprint 2/3). El fallback determinista por estado se conserva.

import type { LifestyleBotState } from '../../types/lifestyle.types';

export type ConvTurn = { role: 'user' | 'assistant'; content: string };

/** Vueltas (mensajes) de historial reciente que se pasan al generador. */
export const RECENT_TURNS = 6;

/** Estado inicial del FSM — el único en el que corresponde un saludo de bienvenida. */
export const INITIAL_STATE: LifestyleBotState = 'GREETING';

/**
 * La conversación está en curso si ya hubo al menos un intercambio previo.
 * El historial lo gestiona handler.ts (pares user/assistant). En una
 * conversación nueva o reseteada por inactividad/estado terminal, está vacío.
 */
export function isConversationInProgress(history: ConvTurn[] | undefined): boolean {
  return (history?.length ?? 0) > 0;
}

/**
 * Construye el arreglo de mensajes para una llamada generativa: el historial
 * reciente (cap RECENT_TURNS) seguido de la instrucción como turno final del
 * usuario. Mantiene la alternancia user/assistant y termina en 'user'.
 */
export function buildGenerativeMessages(
  history:     ConvTurn[] | undefined,
  instruction: string,
): ConvTurn[] {
  const recent = (history ?? []).slice(-RECENT_TURNS);
  return [...recent, { role: 'user', content: instruction }];
}

// ─── Plan del saludo / continuación ───────────────────────────────────────────

export type GreetingPlan = {
  sonnetInstruction:     string;
  deterministicFallback: string;
};

/**
 * Instrucción y fallback usados cuando la conversación YA está en curso: el
 * generador debe continuar el hilo SIN saludar ni dar la bienvenida de nuevo.
 * No contienen lenguaje de saludo ("hola", "bienvenido", "gusto verte").
 */
export const CONTINUATION_INSTRUCTION =
  'La conversación con el cliente ya está en curso. NO saludes, NO te presentes y NO des la bienvenida de nuevo. '
  + 'Retoma el hilo de forma natural y pregunta brevemente en qué le puedes ayudar o qué servicio desea. '
  + 'Máximo 2 líneas. Sin signos de interrogación ni exclamación al inicio.';

export const CONTINUATION_FALLBACK = 'Claro, sigo por aquí. Que servicio te gustaria agendar?';

/**
 * Resuelve el plan del saludo genérico (caso 'none' del greeting) en función de
 * si la conversación ya está en curso.
 *
 * - Conversación nueva (sin historial): plan de BIENVENIDA, personalizado para
 *   clientes recurrentes con favoritos (comportamiento previo intacto).
 * - Conversación en curso (con historial): plan de CONTINUACIÓN, que NO saluda
 *   (anti re-saludo) — corrige el bug de la evidencia real.
 */
export function buildDefaultGreetingPlan(args: {
  isReturning:    boolean;
  customerName:   string;
  favStaffName:   string | null;
  favServiceName: string | null;
  businessName:   string;
  botName:        string;
  history:        ConvTurn[] | undefined;
}): GreetingPlan {
  if (isConversationInProgress(args.history)) {
    return {
      sonnetInstruction:     CONTINUATION_INSTRUCTION,
      deterministicFallback: CONTINUATION_FALLBACK,
    };
  }

  const { isReturning, customerName, favStaffName, favServiceName, businessName, botName } = args;

  if (isReturning && favStaffName && favServiceName) {
    return {
      sonnetInstruction:
        `El cliente se llama ${customerName} y ya ha visitado el negocio antes. `
        + `La última vez agendó ${favServiceName} con ${favStaffName}. `
        + `Salúdalo por nombre de forma cálida y pregunta si quiere agendar lo mismo `
        + `(${favServiceName} con ${favStaffName}) o prefiere algo diferente. `
        + `Máximo 2 líneas. Sin exclamaciones al inicio.`,
      deterministicFallback:
        `Hola ${customerName}, que gusto! Quieres agendar tu ${favServiceName} con ${favStaffName} como la última vez, o prefieres algo diferente?`,
    };
  }

  if (isReturning && favServiceName) {
    return {
      sonnetInstruction:
        `El cliente se llama ${customerName} y ya ha visitado el negocio antes. `
        + `La última vez agendó ${favServiceName}. `
        + `Salúdalo por nombre de forma cálida y pregunta si quiere agendar lo mismo o algo diferente. `
        + `Máximo 2 líneas. Sin exclamaciones al inicio.`,
      deterministicFallback:
        `Hola ${customerName}! La última vez fue un ${favServiceName}. Agendamos lo mismo?`,
    };
  }

  return {
    sonnetInstruction: isReturning
      ? `El cliente se llama ${customerName} y ya ha visitado el negocio antes. `
        + `Salúdalo por nombre de forma sutil y cálida, sin mencionar su historial explícitamente. `
        + `Pregunta en qué puedes ayudarle hoy. Máximo 2 líneas.`
      : `Es un cliente nuevo. Salúdalo de forma amigable en nombre de ${businessName}. `
        + `Pregunta en qué puedes ayudarle. Máximo 2 líneas.`,
    deterministicFallback: isReturning
      ? `Hola ${customerName}, que gusto verte de nuevo. En que puedo ayudarte hoy?`
      : `Hola, soy ${botName}. En que puedo ayudarte?`,
  };
}
