// ─── Messaging Abstraction Layer ──────────────────────────────────────────────
// Capa de abstracción sobre los providers de WhatsApp (Twilio / Meta).
// El provider activo se selecciona por la variable MESSAGING_PROVIDER:
//   'twilio' → desarrollo con Twilio Sandbox (sin aprobación de Meta)
//   'meta'   → producción con Meta Business Cloud API
//
// Swap de provider: cambiar MESSAGING_PROVIDER en el entorno.
// Sin tocar lógica de negocio ni firmas de handler.

import { sendWhatsApp, sendWhatsAppMeta } from './whatsapp';
import { maskPhone } from '../bot/lifestyle/utils/logger';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface MessagingProvider {
  send(params: {
    readonly to: string;
    readonly message: string;
    readonly from?: string;
  }): Promise<void>;
}

// ─── TwilioProvider ───────────────────────────────────────────────────────────

class TwilioProvider implements MessagingProvider {
  async send(params: { readonly to: string; readonly message: string }): Promise<void> {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'];
    const authToken  = process.env['TWILIO_AUTH_TOKEN'];
    const fromRaw    = process.env['TWILIO_WHATSAPP_FROM'] ?? '';

    if (!accountSid || !authToken) {
      throw new Error('[TwilioProvider] TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }

    // TWILIO_WHATSAPP_FROM puede venir como 'whatsapp:+14155238886' o '+14155238886'
    // sendWhatsApp espera fromNumber sin '+' ni prefijo.
    const fromNumber = fromRaw.replace(/^whatsapp:\+?/, '').replace(/^\+/, '');

    const result = await sendWhatsApp(
      { to: params.to, body: params.message },
      { accountSid, authToken, fromNumber },
    );

    if (!result.success) {
      throw new Error(`[TwilioProvider] Error al enviar mensaje: ${result.error ?? 'unknown'}`);
    }
  }
}

// ─── MetaProvider ─────────────────────────────────────────────────────────────

class MetaProvider implements MessagingProvider {
  async send(params: {
    readonly to: string;
    readonly message: string;
    readonly from?: string;
  }): Promise<void> {
    const accessToken   = process.env['WHATSAPP_ACCESS_TOKEN'];
    // 'from' es el Phone Number ID del negocio (businesses.whatsapp_phone_number_id)
    const phoneNumberId = params.from;

    if (!accessToken) {
      throw new Error('[MetaProvider] WHATSAPP_ACCESS_TOKEN must be set');
    }

    if (!phoneNumberId) {
      throw new Error('[MetaProvider] from (phoneNumberId) is required for Meta provider');
    }

    const result = await sendWhatsAppMeta(
      { to: params.to, body: params.message },
      { accessToken, phoneNumberId },
    );

    if (!result.success) {
      throw new Error(`[MetaProvider] Error al enviar mensaje: ${result.error ?? 'unknown'}`);
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

type ProviderName = 'twilio' | 'meta';

function getMessagingProvider(): MessagingProvider {
  const raw = (process.env['MESSAGING_PROVIDER'] ?? 'meta').toLowerCase();

  if (raw !== 'twilio' && raw !== 'meta') {
    throw new Error(
      `[messaging] MESSAGING_PROVIDER debe ser 'twilio' o 'meta', recibido: '${raw}'`,
    );
  }

  const provider: ProviderName = raw;

  if (provider === 'twilio') return new TwilioProvider();
  return new MetaProvider();
}

// ─── sendMessage ──────────────────────────────────────────────────────────────

/**
 * Envía un mensaje de WhatsApp al número indicado usando el provider
 * configurado en MESSAGING_PROVIDER.
 *
 * @param to      Número de destino — solo dígitos, sin '+' ni espacios.
 * @param message Texto del mensaje.
 * @param from    Phone Number ID del negocio (requerido solo con MetaProvider).
 */
export async function sendMessage(params: {
  readonly to: string;
  readonly message: string;
  readonly from?: string;
}): Promise<void> {
  try {
    const provider = getMessagingProvider();
    await provider.send(params);
  } catch (err) {
    // Log siempre; relanzar para que el caller decida si silenciar o no.
    const safeMsg = maskPhone(err instanceof Error ? err.message : String(err));
    console.error('[sendMessage] Error:', safeMsg);
    throw err;
  }
}
