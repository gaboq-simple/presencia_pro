// ─── WhatsApp Message Templates ───────────────────────────────────────────────
// Helper para enviar mensajes usando Meta Message Templates aprobados.
//
// Meta rechaza texto libre (type: 'text') cuando el cliente no ha respondido
// en las últimas 24h (error 131026). Los templates aprobados funcionan siempre.
//
// Uso:
//   import { sendReminder24h, TEMPLATE_NAMES } from '@/lib/whatsapp-templates';
//
// Templates documentados en apps/lifestyle/WHATSAPP-TEMPLATES.md
// Someter a aprobacion en Meta Business Manager antes del go-live.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetaConfig {
  /** businesses.whatsapp_phone_number_id */
  phoneNumberId: string;
  /** WHATSAPP_ACCESS_TOKEN env var */
  accessToken: string;
}

export interface TemplateSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  usedFallback?: boolean;
}

interface TemplateTextParameter {
  type: 'text';
  text: string;
}

interface TemplateComponent {
  type: 'body' | 'header' | 'footer';
  parameters: TemplateTextParameter[];
}

interface MetaTemplateResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; code?: number };
}

// ─── Template name registry ───────────────────────────────────────────────────

export const TEMPLATE_NAMES = {
  reminder24h:          'appointment_reminder_24h',
  reminder2h:           'appointment_reminder_2h',
  reminder1h:           'appointment_reminder_1h',
  followUp:             'appointment_follow_up',
  reviewRequest:        'appointment_review_request',
  waitlistSlotAvailable: 'waitlist_slot_available',
  cancellationNotice:   'appointment_cancellation_notice',
  rescheduleNotice:     'appointment_reschedule_notice',
} as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[keyof typeof TEMPLATE_NAMES];

// ─── Core: sendTemplateMessage ────────────────────────────────────────────────

/**
 * Envía un mensaje usando un Meta Message Template aprobado.
 * No reintenta — el caller decide si usar fallback.
 * Nunca lanza — devuelve TemplateSendResult.
 */
export async function sendTemplateMessage(
  config: MetaConfig,
  recipientPhone: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[],
): Promise<TemplateSendResult> {
  const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   recipientPhone,
        type: 'template',
        template: {
          name:     templateName,
          language: { code: languageCode },
          components,
        },
      }),
    });

    const data = await res.json() as MetaTemplateResponse;

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
      };
    }

    return {
      success:   true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (err) {
    return {
      success: false,
      error:   err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Fallback: texto libre ─────────────────────────────────────────────────────

/**
 * Envía un mensaje de texto libre (type: 'text').
 * Funciona dentro de la ventana de 24h de conversacion activa.
 * Falla con error 131026 si el cliente lleva >24h sin responder.
 */
async function sendFreeTextFallback(
  config: MetaConfig,
  recipientPhone: string,
  body: string,
): Promise<TemplateSendResult> {
  const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   recipientPhone,
        type: 'text',
        text: { body },
      }),
    });

    const data = await res.json() as MetaTemplateResponse;

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
      };
    }

    return { success: true, usedFallback: true };
  } catch (err) {
    return {
      success: false,
      error:   err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Intenta template primero. Si falla (template no aprobado o error de Meta),
 * cae al texto libre como fallback. Util durante el periodo de transicion
 * mientras Meta aprueba los templates.
 */
async function sendWithFallback(
  config: MetaConfig,
  recipientPhone: string,
  templateName: string,
  components: TemplateComponent[],
  fallbackText: string,
): Promise<TemplateSendResult> {
  const templateResult = await sendTemplateMessage(
    config,
    recipientPhone,
    templateName,
    'es_MX',
    components,
  );

  if (templateResult.success) return templateResult;

  // Template fallo (no aprobado, nombre incorrecto, etc.) — intentar texto libre
  console.warn(
    `[whatsapp-templates] template '${templateName}' failed (${templateResult.error}), trying free-text fallback`,
  );

  const fallbackResult = await sendFreeTextFallback(config, recipientPhone, fallbackText);
  return { ...fallbackResult, usedFallback: true };
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function params(...values: string[]): TemplateComponent {
  return {
    type:       'body',
    parameters: values.map((text) => ({ type: 'text', text })),
  };
}

// ─── Wrappers tipados por template ────────────────────────────────────────────

/**
 * reminder_24h — "Hola {{1}}, mañana tienes cita de {{2}} con {{3}} a las {{4}} en {{5}}."
 */
export async function sendReminder24h(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  serviceName:   string,
  staffName:     string,
  timeStr:       string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.reminder24h,
    [params(customerName, serviceName, staffName, timeStr, businessName)],
    `Hola ${customerName}, mañana tienes cita de ${serviceName} con ${staffName} a las ${timeStr} en ${businessName}. ¡Te esperamos!`,
  );
}

/**
 * reminder_2h — "Hola {{1}}, en 2 horas tienes cita de {{2}} con {{3}} a las {{4}} en {{5}}."
 */
export async function sendReminder2h(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  serviceName:   string,
  staffName:     string,
  timeStr:       string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.reminder2h,
    [params(customerName, serviceName, staffName, timeStr, businessName)],
    `Hola ${customerName}, en 2 horas tienes cita de ${serviceName} con ${staffName} a las ${timeStr} en ${businessName}. ¡Te esperamos!`,
  );
}

/**
 * reminder_1h — "Hola {{1}}, te recordamos tu cita de {{2}} con {{3}} hoy a las {{4}} en {{5}}."
 */
export async function sendReminder1h(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  serviceName:   string,
  staffName:     string,
  timeStr:       string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.reminder1h,
    [params(customerName, serviceName, staffName, timeStr, businessName)],
    `Hola ${customerName}, te recordamos tu cita de ${serviceName} con ${staffName} hoy a las ${timeStr} en ${businessName}.`,
  );
}

/**
 * follow_up — "Hola {{1}}, gracias por tu visita a {{2}}. ¿Como te fue?"
 */
export async function sendFollowUp(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.followUp,
    [params(customerName, businessName)],
    `Hola ${customerName}, gracias por tu visita a ${businessName}. Esperamos que hayas quedado satisfecho. ¿Como te fue?`,
  );
}

/**
 * review_request — "Hola {{1}}, gracias por visitarnos en {{2}}. ¿Nos regalas tu opinion? {{3}}"
 * Pasa reviewUrl como {{3}} — debe ser la URL de Google Reviews u otra plataforma.
 */
export async function sendReviewRequest(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  businessName:  string,
  reviewUrl:     string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.reviewRequest,
    [params(customerName, businessName, reviewUrl)],
    `Hola ${customerName}, gracias por visitarnos en ${businessName}. ¿Nos regalas tu opinion? ${reviewUrl}`,
  );
}

/**
 * waitlist_slot_available — "Buenas noticias, {{1}}! Se libero un lugar para {{2}} el {{3}} a las {{4}} con {{5}}."
 * Responde SI en 30 min o el lugar se libera.
 */
export async function sendWaitlistOffer(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  serviceName:   string,
  dateStr:       string,
  timeStr:       string,
  staffName:     string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.waitlistSlotAvailable,
    [params(customerName, serviceName, dateStr, timeStr, staffName)],
    `Buenas noticias, ${customerName}! Se libero un lugar para ${serviceName} el ${dateStr} a las ${timeStr} con ${staffName}. ¿Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.`,
  );
}

/**
 * cancellation_notice — "Hola {{1}}, tu cita del {{2}} a las {{3}} en {{4}} fue cancelada."
 */
export async function sendCancellationNotice(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  dateStr:       string,
  timeStr:       string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.cancellationNotice,
    [params(customerName, dateStr, timeStr, businessName)],
    `Hola ${customerName}, tu cita del ${dateStr} a las ${timeStr} en ${businessName} fue cancelada. Si deseas reagendar, responde a este mensaje.`,
  );
}

/**
 * reschedule_notice — "Hola {{1}}, tu cita del {{2}} a las {{3}} fue movida al {{4}} a las {{5}} en {{6}}."
 */
export async function sendRescheduleNotice(
  config:        MetaConfig,
  customerPhone: string,
  customerName:  string,
  oldDateStr:    string,
  oldTimeStr:    string,
  newDateStr:    string,
  newTimeStr:    string,
  businessName:  string,
): Promise<TemplateSendResult> {
  return sendWithFallback(
    config,
    customerPhone,
    TEMPLATE_NAMES.rescheduleNotice,
    [params(customerName, oldDateStr, oldTimeStr, newDateStr, newTimeStr, businessName)],
    `Hola ${customerName}, tu cita del ${oldDateStr} a las ${oldTimeStr} fue movida al ${newDateStr} a las ${newTimeStr} en ${businessName}. Si necesitas cambios, responde a este mensaje.`,
  );
}
