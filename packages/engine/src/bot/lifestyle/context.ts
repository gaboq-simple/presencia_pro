// ─── Lifestyle Bot — Context Serialization ────────────────────────────────────
// Serializa / deserializa LifestyleBotContext hacia/desde bot_conversations.context.
// Siempre validar con Zod al leer — nunca asumir forma del JSONB.

import {
  LifestyleBotContextSchema,
  LifestyleBotStateSchema,
  type LifestyleBotContext,
  type LifestyleBotState,
} from '../../types/lifestyle.types';

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Si la última actividad de la conversación supera este umbral, el estado
 * se reinicia a GREETING para evitar conversaciones bloqueadas a medias.
 */
const CONVERSATION_RESET_HOURS = 24;

// ─── Deserializar ─────────────────────────────────────────────────────────────

/**
 * Deserializa el JSONB de bot_conversations.context usando Zod.
 * Si la validación falla, devuelve un contexto vacío ({}), lo que causa
 * que el handler reinicie la conversación desde GREETING.
 */
export function deserializeContext(raw: unknown): LifestyleBotContext {
  const parsed = LifestyleBotContextSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

/**
 * Valida y parsea el estado guardado en bot_conversations.state.
 * Si el valor no es un estado válido, devuelve 'GREETING'.
 */
export function deserializeState(raw: unknown): LifestyleBotState {
  const parsed = LifestyleBotStateSchema.safeParse(raw);
  if (!parsed.success) return 'GREETING';
  return parsed.data;
}

// ─── Serializar ───────────────────────────────────────────────────────────────

/**
 * Serializa el contexto a objeto plano listo para Supabase JSONB.
 * Zod garantiza la forma — no es necesario JSON.stringify manual.
 */
export function serializeContext(context: LifestyleBotContext): Record<string, unknown> {
  // Zod parse limpia undefined y campos extra — safe round-trip
  const validated = LifestyleBotContextSchema.parse(context);
  return validated as Record<string, unknown>;
}

// ─── Reset check ──────────────────────────────────────────────────────────────

/**
 * Retorna true si la conversación debe reiniciarse por inactividad.
 * Umbral: CONVERSATION_RESET_HOURS horas desde last_message.
 */
export function shouldResetConversation(lastMessageAt: Date): boolean {
  const diffMs = Date.now() - lastMessageAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > CONVERSATION_RESET_HOURS;
}

// ─── Terminal state check ─────────────────────────────────────────────────────

/**
 * Estados terminales: conversación que llegó a su fin o fue escalada.
 * Si el usuario escribe después de llegar a uno de estos estados,
 * la conversación se reinicia a GREETING sin importar el tiempo de inactividad.
 */
const TERMINAL_STATES = new Set<string>([
  'ESCALATED',
  'COMPLETED',
]);

/**
 * Retorna true si el estado guardado es un estado terminal.
 * Acepta string (no LifestyleBotState) para validar antes de deserializar.
 */
export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}
