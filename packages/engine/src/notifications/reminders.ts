// ─── Notifications — Reminders ───────────────────────────────────────────────
// scheduleReminder(): inserta una fila en scheduled_notifications.
// buildWhatsAppBody() / buildEmailContent(): constructores de contenido por tipo.
// Nunca envía directamente — el despacho lo hace dispatchDue() o un cron externo.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientConfig } from '../types/index';
import type {
  ReminderRequest,
  ReminderType,
  NotificationPayload,
  WhatsAppMessage,
  EmailMessage,
} from './types';
import { wrapHtml } from './email';

// ─── shouldScheduleReviewRequest ─────────────────────────────────────────────

/**
 * Verifica los 4 criterios que deben cumplirse para enviar una solicitud de reseña.
 * Función pura — sin I/O.
 *
 * Criterios:
 *  1. La cita está en status 'completed'
 *  2. reviewUrl no está vacío
 *  3. No fue un no_show (status !== 'no_show')
 *  4. La cita no fue agendada de última hora (lead < cancellationWindowMs)
 */
export function shouldScheduleReviewRequest(params: {
  readonly reviewUrl: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly createdAt: Date;
  readonly cancellationWindowMs: number;
}): boolean {
  // Criterio 1: solo para citas completadas
  if (params.status !== 'completed') return false;

  // Criterio 2: debe existir una URL de reseña
  if (!params.reviewUrl) return false;

  // Criterio 3: no_show implica status diferente a 'completed' — cubierto por criterio 1

  // Criterio 4: no fue agendada de última hora (menos del cancellationWindow de anticipación)
  const bookingLeadMs = params.startsAt.getTime() - params.createdAt.getTime();
  if (bookingLeadMs < params.cancellationWindowMs) return false;

  return true;
}

// ─── getEffectiveReactivationDays ─────────────────────────────────────────────

/**
 * Retorna los días de espera efectivos antes de enviar la reactivación a un paciente,
 * usando el `followUpDays` del servicio de su última cita si está configurado,
 * o el global `postConsulta.reactivationDays` como fallback.
 *
 * @param config    - Configuración del cliente
 * @param serviceId - ID del servicio de la última cita del paciente (opcional)
 */
export function getEffectiveReactivationDays(
  config: ClientConfig,
  serviceId?: string,
): number {
  if (serviceId) {
    const service = config.services.find((s) => s.id === serviceId);
    if (service?.followUpDays !== undefined) return service.followUpDays;
  }
  return config.postConsulta.reactivationDays;
}

// ─── scheduleReminder ─────────────────────────────────────────────────────────

/**
 * Persiste un recordatorio pendiente en scheduled_notifications.
 * No envía nada — el despacho ocurre cuando scheduled_for <= now().
 *
 * @returns El UUID asignado a la fila creada.
 */
export async function scheduleReminder(
  request: ReminderRequest,
  supabase: SupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .insert({
      client_id:      request.clientId,
      appointment_id: request.appointmentId,
      patient_phone:  request.patientWhatsappId,   // Edge Function compat — dispatcher lee patient_phone
      whatsapp_id:    request.patientWhatsappId,
      patient_email:  request.patientEmail,
      type:           request.type,
      channel:        request.channel,
      scheduled_for:  request.scheduledFor.toISOString(),
      // message_body: almacena contenido pre-construido (links firmados, etc.)
      // undefined se omite del insert (Supabase ignora claves undefined)
      ...(request.messageBody !== undefined && { message_body: request.messageBody }),
    })
    .select('id')
    .single();

  if (error) throw new Error(`scheduleReminder: ${error.message}`);
  return (data as { id: string }).id;
}

// ─── Date formatting ──────────────────────────────────────────────────────────

/** Formatea una fecha en zona horaria del cliente — ej: "lunes 7 de abril a las 10:00" */
function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    hour:    '2-digit',
    minute:  '2-digit',
  }).format(date);
}

// ─── WhatsApp body builders ───────────────────────────────────────────────────

/**
 * Construye el cuerpo de texto para un mensaje de WhatsApp según el tipo.
 * Nunca lanza — devuelve string vacío si el tipo no está cubierto.
 */
export function buildWhatsAppBody(
  type: ReminderType,
  payload: NotificationPayload,
): string {
  const fecha = formatLocalDate(payload.startsAt, payload.timezone);
  const modo  = payload.serviceMode === 'domicilio' ? 'a domicilio' : 'en consultorio';

  switch (type) {
    case 'appointment_reminder':
      return (
        `Hola ${payload.patientName} 👋 Te recordamos tu cita de *${payload.serviceName}* ` +
        `${modo} con ${payload.specialistName} el *${fecha}*.\n\n` +
        `Si necesitas cancelar o reagendar, contáctanos con anticipación.`
      );

    case 'appointment_confirmation':
      return (
        `Hola ${payload.patientName}, tu cita de *${payload.serviceName}* con ` +
        `${payload.specialistName} el *${fecha}* está pendiente de confirmación.\n\n` +
        `Responde *SÍ* para confirmar o *NO* para cancelar.`
      );

    case 'appointment_confirmed':
      return (
        `✅ ¡Cita confirmada! Te esperamos el *${fecha}* para tu servicio de ` +
        `*${payload.serviceName}* ${modo} con ${payload.specialistName}.`
      );

    case 'appointment_cancelled':
      return (
        `Tu cita de *${payload.serviceName}* ${modo} con ${payload.specialistName} ` +
        `agendada para el *${fecha}* ha sido cancelada.\n\n` +
        `Si deseas reagendar, con gusto te ayudamos.`
      );

    case 'review_request':
      return (
        `Hola ${payload.patientName}, esperamos que tu cita con ${payload.specialistName} ` +
        `haya sido de tu agrado. 🙏\n\n` +
        `¿Nos regalas un minuto para dejar tu opinión?\n${payload.reviewUrl ?? ''}`
      );

    case 'reactivation':
      return payload.reactivationMessage ?? '';

    case 'post_consulta':
      // TODO(config): Personalizar postConsulta.postConsultaMessage en client.config.ts
      // El campo es opcional — si el cliente no lo define, se usa este mensaje genérico.
      return (
        payload.postConsultaMessage ??
        `Hola ${payload.patientName} 🌸 Gracias por tu visita con ${payload.specialistName}. ` +
        `Recuerda seguir las indicaciones post-tratamiento. Quedamos a tus órdenes si tienes alguna duda.`
      );
  }
}

// ─── Email content builders ───────────────────────────────────────────────────

/** Contenido de un email: subject + html + text */
interface EmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Construye el subject, HTML y texto plano para un email según el tipo.
 * Usa wrapHtml() de email.ts para el layout base.
 */
export function buildEmailContent(
  type: ReminderType,
  payload: NotificationPayload,
): EmailContent {
  const fecha = formatLocalDate(payload.startsAt, payload.timezone);
  const modo  = payload.serviceMode === 'domicilio' ? 'a domicilio' : 'en consultorio';

  switch (type) {
    case 'appointment_reminder': {
      const subject = `Recordatorio: tu cita del ${fecha}`;
      const text    =
        `Hola ${payload.patientName},\n\n` +
        `Te recordamos tu cita de ${payload.serviceName} ${modo} con ` +
        `${payload.specialistName} el ${fecha}.\n\n` +
        `Si necesitas cancelar o reagendar, contáctanos con anticipación.`;
      const html = wrapHtml(payload.clientName, `
        <p>Hola <strong>${payload.patientName}</strong>,</p>
        <p>Te recordamos tu cita de <strong>${payload.serviceName}</strong> ${modo}
           con <strong>${payload.specialistName}</strong> el <strong>${fecha}</strong>.</p>
        <p>Si necesitas cancelar o reagendar, contáctanos con anticipación.</p>
      `);
      return { subject, html, text };
    }

    case 'appointment_confirmation': {
      const subject = `Confirma tu cita del ${fecha}`;
      const text    =
        `Hola ${payload.patientName},\n\n` +
        `Tu cita de ${payload.serviceName} con ${payload.specialistName} el ${fecha} ` +
        `está pendiente de confirmación. Por favor responde a este mensaje para confirmar.`;
      const html = wrapHtml(payload.clientName, `
        <p>Hola <strong>${payload.patientName}</strong>,</p>
        <p>Tu cita de <strong>${payload.serviceName}</strong> con
           <strong>${payload.specialistName}</strong> el <strong>${fecha}</strong>
           está pendiente de confirmación.</p>
        <p>Por favor contáctanos para confirmar tu lugar.</p>
      `);
      return { subject, html, text };
    }

    case 'appointment_confirmed': {
      const subject = `Cita confirmada — ${fecha}`;
      const text    =
        `¡Cita confirmada! Te esperamos el ${fecha} para tu servicio de ` +
        `${payload.serviceName} ${modo} con ${payload.specialistName}.`;
      const html = wrapHtml(payload.clientName, `
        <p>✅ <strong>¡Cita confirmada!</strong></p>
        <p>Te esperamos el <strong>${fecha}</strong> para tu servicio de
           <strong>${payload.serviceName}</strong> ${modo} con
           <strong>${payload.specialistName}</strong>.</p>
      `);
      return { subject, html, text };
    }

    case 'appointment_cancelled': {
      const subject = `Cita cancelada — ${payload.serviceName}`;
      const text    =
        `Tu cita de ${payload.serviceName} ${modo} con ${payload.specialistName} ` +
        `agendada para el ${fecha} ha sido cancelada. ` +
        `Si deseas reagendar, con gusto te ayudamos.`;
      const html = wrapHtml(payload.clientName, `
        <p>Hola <strong>${payload.patientName}</strong>,</p>
        <p>Tu cita de <strong>${payload.serviceName}</strong> ${modo} con
           <strong>${payload.specialistName}</strong> agendada para el
           <strong>${fecha}</strong> ha sido cancelada.</p>
        <p>Si deseas reagendar, con gusto te ayudamos.</p>
      `);
      return { subject, html, text };
    }

    case 'review_request': {
      const subject = `¿Cómo fue tu cita con ${payload.specialistName}?`;
      const text    =
        `Hola ${payload.patientName},\n\n` +
        `Esperamos que tu cita haya sido de tu agrado. ` +
        `¿Nos regalas un minuto para dejarnos tu opinión?\n` +
        `${payload.reviewUrl ?? ''}`;
      const html = wrapHtml(payload.clientName, `
        <p>Hola <strong>${payload.patientName}</strong>,</p>
        <p>Esperamos que tu cita con <strong>${payload.specialistName}</strong>
           haya sido de tu agrado. 🙏</p>
        ${payload.reviewUrl
          ? `<p><a href="${payload.reviewUrl}">Déjanos tu reseña aquí</a></p>`
          : ''}
      `);
      return { subject, html, text };
    }

    case 'reactivation': {
      const subject = `Te extrañamos, ${payload.patientName}`;
      const text    = payload.reactivationMessage ?? '';
      const html    = wrapHtml(payload.clientName, `
        <p>${payload.reactivationMessage ?? ''}</p>
      `);
      return { subject, html, text };
    }

    case 'post_consulta': {
      // TODO(config): Personalizar postConsulta.postConsultaMessage en client.config.ts
      const body = payload.postConsultaMessage ??
        `Hola ${payload.patientName}, gracias por tu visita con ${payload.specialistName}. ` +
        `Recuerda seguir las indicaciones post-tratamiento.`;
      const subject = `Indicaciones post-consulta — ${payload.serviceName}`;
      const html    = wrapHtml(payload.clientName, `
        <p>Hola <strong>${payload.patientName}</strong>,</p>
        <p>Gracias por tu visita con <strong>${payload.specialistName}</strong>. 🌸</p>
        <p>${body}</p>
      `);
      return { subject, html, text: body };
    }
  }
}

// ─── buildWhatsAppMessage / buildEmailMessage ─────────────────────────────────

/** Ensambla un WhatsAppMessage listo para pasar a sendWhatsApp() */
export function buildWhatsAppMessage(
  to: string,
  type: ReminderType,
  payload: NotificationPayload,
): WhatsAppMessage {
  return { to, body: buildWhatsAppBody(type, payload) };
}

/** Ensambla un EmailMessage listo para pasar a sendEmail() */
export function buildEmailMessage(
  to: string,
  type: ReminderType,
  payload: NotificationPayload,
): EmailMessage {
  const content = buildEmailContent(type, payload);
  return { to, ...content };
}
