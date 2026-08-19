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
  readonly patientWhatsappId: string | null;
  readonly patientEmail: string | null;
  readonly type: ReminderType;
  readonly channel: NotificationChannel;
  readonly scheduledFor: Date;
  /**
   * Cuerpo del mensaje pre-construido. Cuando está presente, dispatch-notifications
   * lo usa directamente en lugar del mensaje genérico construido en Deno.
   * Útil para incluir links firmados (cancelación, intake) que requieren
   * acceso al ClientConfig del servidor Next.js.
   */
  readonly messageBody?: string;
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

/** Credenciales para Meta WhatsApp Business Cloud API v20.0 */
export interface MetaWhatsAppCredentials {
  readonly accessToken: string;   // System User Token del Meta Business Account
  readonly phoneNumberId: string; // Phone Number ID del número origen — businesses.whatsapp_phone_number_id
}

/** Resultado de sendWhatsApp() */
export interface WhatsAppSendResult {
  readonly success: boolean;
  readonly messageSid?: string;
  readonly error?: string;
  /** El envío se DETUVO por decisión del sistema, no por un fallo (S8-PER-01 P3).
   *  Se distingue de `error` a propósito: un fallo hay que reintentarlo, una
   *  supresión hay que respetarla. Confundirlos haría que un reintento burlara
   *  la baja del cliente. */
  readonly suppressed?: boolean;
  /** Por qué se suprimió, para el log. Nunca se rinde al cliente. */
  readonly suppressedReason?: string;
}

// ─── Propósito del envío (S8-PER-01 · P3) ────────────────────────────────────
// La "regla de niveles" del plan de permiso, escrita como TIPO y no como
// comentario: la baja bloquea lo proactivo y no bloquea ni las respuestas del
// bot ni los recordatorios de las citas que el propio cliente agende después.
//
// El discriminante hace dos cosas a la vez, y la segunda es la que importa:
//   1. sin `purpose` no compila — nadie puede agregar un envío nuevo "sin darse
//      cuenta" de que tiene que declarar para qué es;
//   2. `proactive` EXIGE el lookup de bajas. No se puede declarar un envío
//      proactivo y "olvidarse" de pasar con qué comprobar la baja: el tipo no
//      deja. Es la diferencia entre una regla y una intención.

/** Cómo preguntar si un titular se dio de baja. Interfaz mínima a propósito:
 *  el engine no conoce supabase-js y no va a empezar acá. */
export interface OptOutLookup {
  /** `true` = ese teléfono NO debe recibir mensajes proactivos de ese negocio. */
  isOptedOut(businessId: string, phone: string): Promise<boolean>;
}

export type SendPurpose =
  /** El cliente escribió y el bot le responde. Servicio solicitado, dentro de la
   *  ventana de 24 h. NUNCA se suprime: suprimirlo convertiría la baja en un
   *  castigo — el cliente pregunta a qué hora abren y el sistema lo ignora. */
  | { readonly purpose: 'session_reply' }
  /** Recordatorio, reagenda o cancelación de una cita CONCRETA. No se suprime:
   *  quien agenda espera su recordatorio, y no dárselo es peor servicio, no más
   *  privacidad. */
  | { readonly purpose: 'appointment_utility' }
  /** Mensaje al DUEÑO o al staff (reporte semanal, aviso del corte, solicitud de
   *  bloqueo). No hay `customers` que consultar: el destinatario no es uno. */
  | { readonly purpose: 'internal_ops' }
  /** Marketing, reactivación, solicitud de reseña. **Lo único que la baja
   *  bloquea**, y por eso es el único que exige con qué comprobarla. */
  | { readonly purpose: 'proactive'; readonly db: OptOutLookup; readonly businessId: string };

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
