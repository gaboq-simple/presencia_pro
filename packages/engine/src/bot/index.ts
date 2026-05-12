// ─── Bot Module — Public Interface ───────────────────────────────────────────
// Solo exporta lo que el resto del sistema necesita ver.
// Lo que no está aquí no existe para módulos externos.

export { handleIncomingMessage } from './handler';
export type { HandleIncomingMessageOptions } from './handler';
export { updateConversation, getConversation } from './state';
export { verifyWebhookSignature } from './verifyWebhookSignature';

export type {
  AppointmentRequest,
  BotAction,
  BotResponse,
  ConversationState,
  IncomingMessage,
  TimeSlot,
} from './types';

// ─── Lifestyle bot ────────────────────────────────────────────────────────────

export { handleLifestyleMessage } from './lifestyle/handler';
export { invalidateBusinessCache } from './lifestyle/catalog';
export type {
  HandleLifestyleMessageOptions,
  LifestyleBotResponse,
  LifestyleIncomingMessage,
  LifestyleBusinessConfig,
} from './lifestyle/handler';
