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
  WhatsAppSendResult,
  EmailMessage,
  ResendCredentials,
  EmailSendResult,
  NotificationDeps,
} from './types';

// WhatsApp client
export { sendWhatsApp } from './whatsapp';

// Email client
export { sendEmail, wrapHtml } from './email';

// Reminders
export {
  scheduleReminder,
  buildWhatsAppBody,
  buildEmailContent,
  buildWhatsAppMessage,
  buildEmailMessage,
} from './reminders';
