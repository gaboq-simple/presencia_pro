// ─── Notifications — WhatsApp Client ─────────────────────────────────────────
// Cliente puro: envía un mensaje y devuelve el resultado.
// Sin lógica de negocio — sin ReminderType, sin templates, sin Supabase.
// Retry: 3 intentos, backoff exponencial (1s → 2s → 4s).

import type { WhatsAppCredentials, WhatsAppMessage, WhatsAppSendResult } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

// ─── Retry helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── sendWhatsApp ─────────────────────────────────────────────────────────────

/**
 * Envía un mensaje de WhatsApp vía Twilio.
 * Reintenta hasta MAX_RETRIES veces con backoff exponencial.
 * Nunca lanza — siempre devuelve WhatsAppSendResult.
 *
 * @param message  Mensaje a enviar (to + body)
 * @param creds    Credenciales Twilio inyectadas por el caller
 */
export async function sendWhatsApp(
  message: WhatsAppMessage,
  creds: WhatsAppCredentials,
): Promise<WhatsAppSendResult> {
  const url = `${TWILIO_API_BASE}/Accounts/${creds.accountSid}/Messages.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

  const body = new URLSearchParams({
    From: `whatsapp:+${creds.fromNumber}`,
    To:   `whatsapp:+${message.to}`,
    Body: message.body,
  });

  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (response.ok) {
        const data = await response.json() as { sid: string };
        return { success: true, messageSid: data.sid };
      }

      const errorData = await response.json() as { message?: string };
      lastError = errorData.message ?? `HTTP ${response.status}`;

      // Guard: no reintentar errores 4xx (excepto 429 rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { success: false, error: lastError };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < MAX_RETRIES) {
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  return { success: false, error: lastError };
}
