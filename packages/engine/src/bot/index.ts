// ─── Bot Module — Public Interface ───────────────────────────────────────────
// Solo exporta lo que el resto del sistema necesita ver.
// Lo que no está aquí no existe para módulos externos.

export { handleIncomingMessage } from './handler.js';
export { updateConversation, getConversation } from './state.js';

export type {
  AppointmentRequest,
  BotAction,
  BotResponse,
  ConversationState,
  IncomingMessage,
  TimeSlot,
} from './types.js';
