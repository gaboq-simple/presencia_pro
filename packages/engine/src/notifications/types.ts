// ─── Notifications Module — Types ────────────────────────────────────────────
// All types use readonly fields.
// The engine never reads env vars — credentials are injected by the API route.

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Reminder type ───────────────────────────────────────────────────────────

/**
 * Los 7 tipos de recordatorio que el sistema puede despachar.
 *
 * appointment_reminder     — N horas antes de la cita (de reminderSchedule[])
 * appointment_confirmation — solicitud de confirmación (confirmationRequired=true)
 * appointment_confirmed    — aviso al paciente: cita confirmada
 * appointment_cancelled    — aviso de cancelación
 * review_request           — solicitud de reseña post-consulta (delay: reviewRequestDelayHours)
 * reactivation             — mensaje de reactivación por inactividad (delay: reactivationDays)
 * post_consulta            — seguimiento inmediato post-cita (delay: startsAt + 1h)
 */
export type ReminderType =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'review_request'
  | 'reactivation'
  | 'post_consulta';

// ─── Channel ─────────────────────────────────────────────────────────────────

export type NotificationChannel = 'whatsapp' | 'email';

// ─── Persisted record ────────────────────────────────────────────────────────

/** Fila en la tabla scheduled_notifications */
export interface ScheduledNotification {
  readonly id: string;
  readonly clientId: string;
  readonly appointmentId: string | null;   // FK → appointments.id
  readonly patientPhone: string | null;
  readonly patientEmail: string | null;
  readonly type: ReminderType;
  readonly channel: NotificationChannel;
  readonly scheduledFor: Date;
  readonly sentAt: Date | null;            // null = aún no enviado
  readonly failedAt: Date | null;          // null = sin error
  readonly errorMessage: string | null;
  readonly createdAt: Date;
}

// ─── Schedule request ────────────────────────────────────────────────────────

/** Input para scheduleReminder() — inserta una fila en scheduled_notifications */
export interface ReminderRequest {
  readonly clientId: string;
  readonly appointmentId: string | null;
  readonly patientPhone: string | null;
  readonly patientEmail: string | null;
  readonly type: ReminderType;
  readonly channel: NotificationChannel;
  readonly scheduledFor: Date;
}

// ─── Notification payload ────────────────────────────────────────────────────

/**
 * Datos estructurados para construir el contenido del mensaje por ReminderType.
 * Derivado de Appointment + ClientConfig — nunca de env vars.
 */
export interface NotificationPayload {
  readonly patientName: string;
  readonly specialistName: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly clientName: string;
  readonly timezone: string;
  /** Solo presente en review_request */
  readonly reviewUrl?: string;
  /** Solo presente en reactivation */
  readonly reactivationMessage?: string;
  /** Solo presente en post_consulta */
  readonly postConsultaMessage?: string;
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/** Mensaje saliente de WhatsApp */
export interface WhatsAppMessage {
  readonly to: string;       // solo dígitos, sin + ni espacios — ej: "5215558056215"
  readonly body: string;
}

/** Credenciales para el proveedor de WhatsApp (Twilio / Meta Cloud API) */
export interface WhatsAppCredentials {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;  // número origen registrado — ej: "14155238886"
}

/** Resultado de sendWhatsApp() */
export interface WhatsAppSendResult {
  readonly success: boolean;
  readonly messageSid?: string;
  readonly error?: string;
}

// ─── Email ───────────────────────────────────────────────────────────────────

/** Mensaje saliente de email */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;   // fallback plain-text
}

/** Credenciales para Resend */
export interface ResendCredentials {
  readonly apiKey: string;
  readonly fromAddress: string;  // ej: "citas@presenciapro.com"
}

/** Resultado de sendEmail() */
export interface EmailSendResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly error?: string;
}

// ─── Dependency injection ────────────────────────────────────────────────────

/** Infraestructura inyectada para scheduleReminder() y dispatchDue() */
export interface NotificationDeps {
  readonly supabase: SupabaseClient;
  readonly whatsapp: WhatsAppCredentials;
  readonly resend: ResendCredentials;
}
