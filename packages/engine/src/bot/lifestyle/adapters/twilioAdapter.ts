// ─── Twilio Adapter ───────────────────────────────────────────────────────────
// Normaliza el payload x-www-form-urlencoded de Twilio Webhook al contrato
// LifestyleIncomingMessage que espera handleLifestyleMessage().
//
// Twilio Sandbox — campos relevantes del payload entrante:
//   From=whatsapp:+521XXXXXXXXXX  (número del cliente)
//   To=whatsapp:+14155238886      (sandbox — siempre el mismo)
//   Body=texto del mensaje
//   ProfileName=Nombre WhatsApp   (puede estar ausente)
//
// Limitación de Sandbox: todos los negocios comparten el mismo To.
// businessId se resuelve en la route, no aquí.

import type { LifestyleIncomingMessage } from '../types';

// ─── Parsed output del adapter ────────────────────────────────────────────────

/**
 * Payload de Twilio normalizado, listo para que la route construya
 * el LifestyleIncomingMessage completo (agrega businessId desde DB).
 */
export type TwilioNormalizedMessage = {
  /** Número del cliente — solo dígitos, sin 'whatsapp:' ni '+'. */
  readonly customerPhone: string;
  /** Número de destino (To) — solo dígitos, sin 'whatsapp:' ni '+'. */
  readonly toNumber: string;
  /** Texto del mensaje entrante. */
  readonly body: string;
  /** Nombre del perfil de WhatsApp — null si no viene en el payload. */
  readonly customerName: string | null;
  /** MessageSid de Twilio — para deduplicación de reintentos del webhook. */
  readonly messageId: string | null;
};

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * Parsea el FormData de Twilio y retorna los campos normalizados.
 * Retorna null si el payload no tiene los campos mínimos requeridos.
 */
export function parseTwilioPayload(formData: URLSearchParams): TwilioNormalizedMessage | null {
  const from        = formData.get('From');
  const to          = formData.get('To');
  const body        = formData.get('Body');
  const profileName = formData.get('ProfileName');
  const messageSid  = formData.get('MessageSid');

  if (!from || !to || !body) return null;

  return {
    customerPhone: stripWhatsappPrefix(from),
    toNumber:      stripWhatsappPrefix(to),
    body:          body.trim(),
    customerName:  profileName?.trim() || null,
    messageId:     messageSid ?? null,
  };
}

/**
 * Construye el LifestyleIncomingMessage a partir del payload normalizado
 * y el businessId ya resuelto por la route.
 */
export function buildLifestyleMessage(
  normalized: TwilioNormalizedMessage,
  businessId: string,
): LifestyleIncomingMessage {
  return {
    businessId,
    customerPhone: normalized.customerPhone,
    customerName:  normalized.customerName,
    body:          normalized.body,
    timestamp:     new Date(),
    messageId:     normalized.messageId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Elimina el prefijo 'whatsapp:' y el '+' inicial de un número de Twilio.
 * Ej: 'whatsapp:+14155238886' → '14155238886'
 */
function stripWhatsappPrefix(raw: string): string {
  return raw.replace(/^whatsapp:\+?/, '').replace(/^\+/, '');
}
