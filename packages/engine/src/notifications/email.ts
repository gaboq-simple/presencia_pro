// ─── Notifications — Email Client (Resend) ───────────────────────────────────
// Cliente puro: construye y envía emails con templates base.
// Sin lógica de negocio — sin ReminderType, sin Supabase.
// Retry: 3 intentos, backoff exponencial (1s → 2s → 4s).

import type { EmailMessage, EmailSendResult, ResendCredentials } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const RESEND_API_URL = 'https://api.resend.com/emails';

// ─── Retry helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── sendEmail ────────────────────────────────────────────────────────────────

/**
 * Envía un email vía Resend.
 * Reintenta hasta MAX_RETRIES veces con backoff exponencial.
 * Nunca lanza — siempre devuelve EmailSendResult.
 *
 * @param message  Email a enviar
 * @param creds    Credenciales Resend inyectadas por el caller
 */
export async function sendEmail(
  message: EmailMessage,
  creds: ResendCredentials,
): Promise<EmailSendResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    creds.fromAddress,
          to:      message.to,
          subject: message.subject,
          html:    message.html,
          text:    message.text,
        }),
      });

      if (response.ok) {
        const data = await response.json() as { id: string };
        return { success: true, messageId: data.id };
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

// ─── HTML template base ───────────────────────────────────────────────────────

/**
 * Wrapper HTML mínimo para todos los emails del sistema.
 * El contenido específico por ReminderType se construye en reminders.ts.
 *
 * @param clientName  Nombre del cliente (clínica/consultorio)
 * @param body        HTML interno del cuerpo del mensaje
 */
export function wrapHtml(clientName: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${clientName}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f9f9f9; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff;
                 border-radius: 8px; padding: 32px; border: 1px solid #e5e7eb; }
    .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; text-align: center; }
    p { line-height: 1.6; color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    ${body}
    <div class="footer">${clientName} · Este mensaje fue generado automáticamente.</div>
  </div>
</body>
</html>`;
}
