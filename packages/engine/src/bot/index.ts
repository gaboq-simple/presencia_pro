// ─── Bot Module — Public Interface ───────────────────────────────────────────
// Solo exporta lo que el resto del sistema necesita ver.
// Lo que no está aquí no existe para módulos externos.

export { handleIncomingMessage } from './handler';
export { updateConversation, getConversation } from './state';

export type {
  AppointmentRequest,
  BotAction,
  BotResponse,
  ConversationState,
  IncomingMessage,
  TimeSlot,
} from './types';
