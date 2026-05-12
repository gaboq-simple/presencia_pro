// ─── Webhook Signature Verification — Meta (WhatsApp Business API) ────────────
// Verifica la firma HMAC-SHA256 que Meta adjunta en el header x-hub-signature-256.
// Función pura, síncrona. No lanza excepciones — devuelve false en cualquier caso
// de falla para mantener comportamiento de falla cerrada.

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica que el webhook proviene de Meta comparando la firma HMAC-SHA256
 * del body crudo con la firma declarada en el header `x-hub-signature-256`.
 *
 * Falla cerrada: devuelve `false` si `appSecret` no está definido,
 * si el header está ausente, si el formato es inválido, o si la firma no coincide.
 *
 * @param signatureHeader - Valor del header `x-hub-signature-256` (puede ser null)
 * @param rawBody         - Body crudo del request, tal como llegó del wire (string UTF-8)
 * @param appSecret       - `WHATSAPP_APP_SECRET` del entorno; si es undefined → rechaza siempre
 */
export function verifyWebhookSignature(params: {
  readonly signatureHeader: string | null;
  readonly rawBody: string;
  readonly appSecret: string | undefined;
}): boolean {
  const { signatureHeader, rawBody, appSecret } = params;

  // Guard: falla cerrada — sin secret configurado, nunca aceptar
  if (!appSecret) return false;

  // Guard: header ausente
  if (!signatureHeader) return false;

  // Guard: formato esperado: "sha256=<hex>"
  if (!signatureHeader.startsWith('sha256=')) return false;

  const receivedHex = signatureHeader.slice('sha256='.length);

  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Guard: longitudes distintas indican firma malformada; timingSafeEqual requiere igual length
  if (receivedBuf.length === 0 || receivedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(receivedBuf, expectedBuf);
}
