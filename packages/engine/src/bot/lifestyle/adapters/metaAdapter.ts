// ─── Meta Adapter ─────────────────────────────────────────────────────────────
// Normaliza el payload JSON de Meta Business Cloud API al contrato
// LifestyleIncomingMessage que espera handleLifestyleMessage().
//
// Extrae la lógica de parseo que antes vivía inline en route.ts.
// La route sigue resolviendo el businessId desde la DB — esto es solo
// normalización de formato.

import type { LifestyleIncomingMessage } from '../types';

// ─── Parsed output del adapter ────────────────────────────────────────────────

/**
 * Campos extraídos del payload de Meta, antes de que la route
 * resuelva el businessId.
 */
export type MetaNormalizedMessage = {
  /** Phone Number ID del negocio — clave para lookup en businesses. */
  readonly phoneNumberId: string;
  /** whatsapp_id del cliente — solo dígitos, sin '+'. Meta ya lo envía limpio. */
  readonly customerPhone: string;
  /** Texto del mensaje. */
  readonly body: string;
  /** Nombre del perfil de WhatsApp — null si no viene en contacts. */
  readonly customerName: string | null;
  /** ID único del mensaje (wamid.xxx) — para deduplicación de reintentos del webhook. */
  readonly messageId: string | null;
};

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * Parsea el payload JSON de Meta y extrae los campos relevantes.
 * Retorna null si el payload no corresponde a un mensaje de texto entrante
 * (ej: delivery receipts, status updates, etc.).
 */
export function parseMetaPayload(body: unknown): MetaNormalizedMessage | null {
  const payload  = body as Record<string, unknown>;
  const entry    = (payload['entry'] as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change   = (entry?.['changes'] as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value    = change?.['value'] as Record<string, unknown> | undefined;
  const metadata = value?.['metadata'] as Record<string, unknown> | undefined;
  const messages = value?.['messages'] as unknown[] | undefined;

  const phoneNumberId = metadata?.['phone_number_id'] as string | undefined;

  // Status updates, delivery receipts, etc. — no procesar
  if (!phoneNumberId || !messages?.length) return null;

  const message     = messages[0] as Record<string, unknown>;
  const fromPhone   = message['from'] as string | undefined;
  const messageBody = (message['text'] as Record<string, unknown> | undefined)?.['body'] as string | undefined;
  const messageId   = message['id'] as string | undefined;

  // Solo procesar mensajes de texto
  if (!fromPhone || !messageBody) return null;

  const contacts    = value?.['contacts'] as unknown[] | undefined;
  const contact     = contacts?.[0] as Record<string, unknown> | undefined;
  const profileName = (contact?.['profile'] as Record<string, unknown> | undefined)?.['name'] as string | undefined;

  return {
    phoneNumberId,
    customerPhone: fromPhone,
    body:          messageBody,
    customerName:  profileName ?? null,
    messageId:     messageId ?? null,
  };
}

/**
 * Construye el LifestyleIncomingMessage a partir del payload normalizado
 * y el businessId ya resuelto por la route.
 */
export function buildLifestyleMessage(
  normalized: MetaNormalizedMessage,
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
