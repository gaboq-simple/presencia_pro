// ─── Bot Handler — Main Orchestrator ─────────────────────────────────────────
// Recibe IncomingMessage + ClientConfig, devuelve BotResponse.
// El engine nunca contiene datos de cliente — recibe config como parámetro.

import Anthropic from '@anthropic-ai/sdk';
import type { ClientConfig } from '../types/index';
import { isWithinOfficeHours, detectCancellationIntent } from './flow';
import { buildSystemPrompt } from './prompt';
import { createConversation, getConversation, updateConversation } from './state';
import type {
  BotAction,
  BotResponse,
  ConversationContext,
  ConversationMessage,
  ConversationState,
  IncomingMessage,
} from './types';

// ─── Claude client ────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
  return new Anthropic({ apiKey });
}

// ─── Message history helpers ──────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 20;

function getHistory(context: ConversationContext): ConversationMessage[] {
  return [...(context.messages ?? [])];
}

function appendToHistory(
  context: ConversationContext,
  role: 'user' | 'assistant',
  content: string,
): ConversationMessage[] {
  const updated = [...(context.messages ?? []), { role, content }];
  // Keep last N messages to avoid token overflow
  return updated.slice(-MAX_HISTORY_MESSAGES);
}

// ─── Action detection ─────────────────────────────────────────────────────────
// Claude responde en texto plano. Detectamos intención de acción por
// marcadores estructurados en el texto de respuesta.
// Formato esperado: [ACTION:TYPE:{"key":"value"}] al final del mensaje.

const ACTION_PATTERN = /\[ACTION:([A-Z_]+):(\{[\s\S]*?\})\]$/;

function parseAction(text: string): { message: string; action: BotAction | undefined } {
  const match = ACTION_PATTERN.exec(text);
  if (!match) return { message: text.trim(), action: undefined };

  const cleanMessage = text.replace(ACTION_PATTERN, '').trim();
  const actionType = match[1] as BotAction['type'];
  let actionData: Record<string, unknown>;

  try {
    actionData = JSON.parse(match[2] ?? '{}') as Record<string, unknown>;
  } catch {
    return { message: cleanMessage, action: undefined };
  }

  switch (actionType) {
    case 'CREATE_APPOINTMENT':
      return {
        message: cleanMessage,
        action: { type: 'CREATE_APPOINTMENT', data: actionData as never },
      };
    case 'SEND_INTAKE_LINK':
      return {
        message: cleanMessage,
        action: { type: 'SEND_INTAKE_LINK', appointmentId: actionData['appointmentId'] as string },
      };
    case 'ESCALATE_TO_HUMAN':
      return {
        message: cleanMessage,
        action: { type: 'ESCALATE_TO_HUMAN', reason: actionData['reason'] as string },
      };
    case 'SEND_LOCATION':
      return {
        message: cleanMessage,
        action: { type: 'SEND_LOCATION', specialistId: actionData['specialistId'] as string },
      };
    default:
      return { message: cleanMessage, action: undefined };
  }
}

// ─── Context updates from action ──────────────────────────────────────────────

function contextUpdatesFromAction(
  action: BotAction | undefined,
): Partial<ConversationContext> {
  if (!action) return {};

  switch (action.type) {
    case 'CREATE_APPOINTMENT':
      return { serviceId: action.data.serviceId, serviceMode: action.data.serviceMode };
    case 'SEND_INTAKE_LINK':
      return { appointmentId: action.appointmentId };
    case 'ESCALATE_TO_HUMAN':
      return {};
    case 'SEND_LOCATION':
      return {};
    case 'CONFIRM_APPOINTMENT':
      return {};
    case 'CANCEL_APPOINTMENT':
      return {};
  }
}

// ─── Confirmation response intercept ─────────────────────────────────────────
// Cuando la conversación está en AWAITING_CONFIRMATION, el bot no llama a Claude.
// Detecta SÍ/NO de forma determinista y devuelve la acción correspondiente.

const YES_PATTERN = /^(s[ií]|1|confirmo?|confirmar|yes|ok|dale|va|claro|perfecto|listo)$/i;
const NO_PATTERN = /^(no?|2|cancelar|cancel)$/i;

/**
 * Maneja la respuesta del paciente cuando el bot espera confirmación de cita.
 * No llama a Claude — lógica determinista de SÍ/NO.
 * Las acciones CONFIRM_APPOINTMENT y CANCEL_APPOINTMENT son ejecutadas por el webhook.
 */
async function handleConfirmationResponse(
  message: IncomingMessage,
  conversation: ConversationState,
  _config: ClientConfig,
): Promise<BotResponse> {
  const trimmed = message.body.trim();
  const appointmentId = conversation.context.appointmentId;

  // Guard: si falta appointmentId escalamos — no debería ocurrir en condiciones normales
  if (!appointmentId) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, { state: 'ESCALATED' });
      } catch { /* non-fatal */ }
    }
    return {
      message: 'Tuve un problema con tu cita. Te conecto con alguien que puede ayudarte.',
      action: { type: 'ESCALATE_TO_HUMAN', reason: 'AWAITING_CONFIRMATION sin appointmentId' },
    };
  }

  // ── Respuesta afirmativa ───────────────────────────────────────────────────
  if (YES_PATTERN.test(trimmed)) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          state: 'SENDING_INTAKE',
          context: { confirmationRetries: 0 },
        });
      } catch { /* non-fatal */ }
    }
    return {
      message:
        '¡Perfecto! Tu cita está confirmada. 🎉\n\n' +
        'Ahora te envío el formulario de pre-consulta para que lo completes antes de tu cita.',
      action: { type: 'CONFIRM_APPOINTMENT', appointmentId },
    };
  }

  // ── Respuesta negativa ────────────────────────────────────────────────────
  if (NO_PATTERN.test(trimmed)) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          state: 'COMPLETED',
          context: { confirmationRetries: 0 },
        });
      } catch { /* non-fatal */ }
    }
    return {
      message:
        'Entendido, cancelamos la cita. Si quieres agendar en otro momento, con gusto te ayudo.',
      action: { type: 'CANCEL_APPOINTMENT', appointmentId, reason: 'patient_rejected' },
    };
  }

  // ── Respuesta ambigua ─────────────────────────────────────────────────────
  const retries = conversation.context.confirmationRetries ?? 0;

  if (retries < 1) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          context: { confirmationRetries: retries + 1 },
        });
      } catch { /* non-fatal */ }
    }
    return {
      message: 'Para confirmar tu cita responde *Sí* o *No*.\n¿Confirmas tu cita?',
    };
  }

  // Segunda vez sin respuesta válida — escalamos a humano
  if (conversation.id) {
    try {
      await updateConversation(conversation.id, { state: 'ESCALATED' });
    } catch { /* non-fatal */ }
  }
  return {
    message:
      'No pude entender tu respuesta. Te conecto con alguien que puede ayudarte directamente.',
    action: {
      type: 'ESCALATE_TO_HUMAN',
      reason: 'no_confirmation_response_after_retries',
    },
  };
}

// ─── Cancel confirmation response intercept ───────────────────────────────────
// Cuando el bot detectó intención de cancelar y preguntó para confirmar,
// se intercede aquí antes de llamar a Claude con lógica determinista SÍ/NO.

/**
 * Maneja la respuesta del paciente cuando el bot esperaba confirmación de cancelación.
 * Si confirma → devuelve acción CANCEL_APPOINTMENT.
 * Si niega → reanuda flujo normal sin cancelar.
 */
async function handleCancelConfirmationResponse(
  message: IncomingMessage,
  conversation: ConversationState,
): Promise<BotResponse> {
  const trimmed = message.body.trim();
  const appointmentId = conversation.context.pendingCancelAppointmentId;

  // Guard: sin appointmentId no podemos continuar — reanudar flujo normal
  if (!appointmentId) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, { state: 'GREETING' });
      } catch { /* non-fatal */ }
    }
    return { message: 'Entendido, seguimos con el flujo normal. En qué te puedo ayudar?' };
  }

  // ── Respuesta afirmativa — cancelar ────────────────────────────────────────
  if (YES_PATTERN.test(trimmed)) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          state: 'COMPLETED',
          context: { pendingCancelAppointmentId: undefined },
        });
      } catch { /* non-fatal */ }
    }
    return {
      message: 'Listo, tu cita ha sido cancelada. Si quieres agendar en otro momento, con gusto te ayudamos. 🌸',
      action: { type: 'CANCEL_APPOINTMENT', appointmentId, reason: 'patient_intent_via_bot' },
    };
  }

  // ── Respuesta negativa — mantener cita ────────────────────────────────────
  if (NO_PATTERN.test(trimmed)) {
    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          state: 'COMPLETED',
          context: { pendingCancelAppointmentId: undefined },
        });
      } catch { /* non-fatal */ }
    }
    return {
      message: 'Perfecto, tu cita sigue confirmada. ¡Te esperamos! 🌸',
    };
  }

  // ── Respuesta ambigua ─────────────────────────────────────────────────────
  return {
    message: 'Para confirmar la cancelación responde *Sí*, o *No* si prefieres mantener tu cita.',
  };
}

// ─── Away response ────────────────────────────────────────────────────────────

function buildAwayResponse(config: ClientConfig): BotResponse {
  return { message: config.bot.awayMessage };
}

// ─── Empty / non-text message ─────────────────────────────────────────────────

function isEmptyOrEmojiOnly(text: string): boolean {
  // Strip emojis and whitespace — if nothing remains, treat as empty
  const stripped = text.replace(/\p{Emoji}/gu, '').trim();
  return stripped.length === 0;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// ─── Options ──────────────────────────────────────────────────────────────────

export type HandleIncomingMessageOptions = {
  /**
   * Cita próxima del paciente (< 24h desde ahora).
   * Si se proporciona y el paciente expresa intención de cancelar,
   * el bot pregunta por confirmación antes de proceder.
   * Lo resuelve el webhook — el engine no hace queries a DB.
   */
  readonly upcomingAppointment?: { readonly id: string; readonly startsAt: Date };
};

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Procesa un mensaje entrante de WhatsApp y devuelve la respuesta del bot.
 *
 * @param message - Mensaje entrante del paciente
 * @param config  - Configuración del cliente (cargada por el webhook, nunca hardcodeada aquí)
 * @param opts    - Opciones opcionales: cita próxima para detección de intención de cancelación
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
  config: ClientConfig,
  opts: HandleIncomingMessageOptions = {},
): Promise<BotResponse> {
  // Guard: fuera de horario — responder inmediatamente sin llamar a Claude
  if (!isWithinOfficeHours(config, message.timestamp)) {
    return buildAwayResponse(config);
  }

  // Guard: mensaje vacío o solo emojis — responder con saludo inicial
  if (isEmptyOrEmojiOnly(message.body)) {
    return { message: config.bot.greeting };
  }

  // ── Load or create conversation state ──────────────────────────────────────
  let conversation: ConversationState;

  try {
    const existing = await getConversation(message.clientId, message.from);
    conversation = existing ?? (await createConversation(message.clientId, message.from));
  } catch {
    // Guard: Supabase read failed — create fresh conversation, never block the patient
    conversation = {
      id: '',
      clientId: message.clientId,
      patientPhone: message.from,
      state: 'GREETING',
      context: {},
      lastMessage: message.timestamp,
    };
  }

  // ── Interceptar AWAITING_CONFIRMATION antes de llamar a Claude ────────────
  if (conversation.state === 'AWAITING_CONFIRMATION') {
    return handleConfirmationResponse(message, conversation, config);
  }

  // ── Interceptar AWAITING_CANCEL_CONFIRMATION antes de llamar a Claude ─────
  if (conversation.state === 'AWAITING_CANCEL_CONFIRMATION') {
    return handleCancelConfirmationResponse(message, conversation);
  }

  // ── Detectar intención de cancelación (solo si hay cita próxima < 24h) ────
  const { upcomingAppointment } = opts;
  if (upcomingAppointment && detectCancellationIntent(message.body)) {
    const fecha = new Intl.DateTimeFormat('es-MX', {
      timeZone: config.client.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(upcomingAppointment.startsAt);

    if (conversation.id) {
      try {
        await updateConversation(conversation.id, {
          state: 'AWAITING_CANCEL_CONFIRMATION',
          context: { pendingCancelAppointmentId: upcomingAppointment.id },
        });
      } catch { /* non-fatal */ }
    }

    return {
      message:
        `Entendido. Para confirmar: ¿quieres que cancelemos tu cita del *${fecha}*?\n\n` +
        `Responde *Sí* para cancelar o *No* si prefieres mantenerla.`,
    };
  }

  // ── Build Claude messages ──────────────────────────────────────────────────
  const history = getHistory(conversation.context);
  const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    { role: 'user', content: message.body },
  ];

  // ── Call Claude API ────────────────────────────────────────────────────────
  let rawReply: string;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: buildSystemPrompt(config),
      messages: claudeMessages,
    });

    const firstBlock = response.content[0];
    rawReply = firstBlock?.type === 'text' ? firstBlock.text : config.bot.fallbackMessage;
  } catch {
    // Guard: Claude API failed — never expose technical errors to the patient
    return { message: config.bot.fallbackMessage };
  }

  // ── Parse action from reply ────────────────────────────────────────────────
  const { message: replyText, action } = parseAction(rawReply);

  // ── Persist updated conversation state ────────────────────────────────────
  if (conversation.id) {
    const updatedMessages = appendToHistory(
      { ...conversation.context, messages: history },
      'user',
      message.body,
    );
    const withAssistant = appendToHistory(
      { messages: updatedMessages },
      'assistant',
      replyText,
    );

    const contextUpdates: Partial<ConversationContext> = {
      ...contextUpdatesFromAction(action),
      messages: withAssistant,
    };

    const nextState = action?.type === 'ESCALATE_TO_HUMAN' ? 'ESCALATED' : conversation.state;

    try {
      await updateConversation(conversation.id, {
        state: nextState,
        context: contextUpdates,
      });
    } catch {
      // Guard: persistence failure is non-fatal — the patient still gets their response
    }
  }

  return { message: replyText, action };
}
