// ─── Notifications Module — Public API ───────────────────────────────────────

// Types
export type {
  ReminderType,
  NotificationChannel,
  ScheduledNotification,
  ReminderRequest,
  NotificationPayload,
  WhatsAppMessage,
  WhatsAppCredentials,
  MetaWhatsAppCredentials,
  WhatsAppSendResult,
  EmailMessage,
  ResendCredentials,
  EmailSendResult,
  NotificationDeps,
} from './types';

// WhatsApp client
export { sendWhatsApp, sendWhatsAppMeta } from './whatsapp';

// Messaging abstraction (Twilio / Meta swap via MESSAGING_PROVIDER env var)
export type { MessagingProvider } from './messaging';
export { sendMessage } from './messaging';

// Email client
export { sendEmail, wrapHtml } from './email';

// Reminders
export {
  scheduleReminder,
  shouldScheduleReviewRequest,
  getEffectiveReactivationDays,
  buildWhatsAppBody,
  buildEmailContent,
  buildWhatsAppMessage,
  buildEmailMessage,
} from './reminders';
