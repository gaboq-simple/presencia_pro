// ─── WhatsApp Bot Webhook ─────────────────────────────────────────────────────
// GET:  verificación del webhook con Meta Developers (sin cambios).
// POST: mensajes entrantes de WhatsApp.
//       Provider se selecciona vía MESSAGING_PROVIDER env var:
//         'twilio' → Twilio Sandbox (desarrollo sin aprobación de Meta)
//         'meta'   → Meta Business Cloud API (producción)
//
// Multi-tenant routing:
//   Meta:   phone_number_id del payload → SELECT businesses WHERE whatsapp_phone_number_id = $1
//   Twilio: To (sandbox) → lookup por whatsapp_number o TWILIO_DEV_BUSINESS_ID
//
// Procesamiento async:
//   Twilio: responde 200 + TwiML vacío inmediatamente, procesa async.
//   Meta:   responde 200 + { status: 'ok' } inmediatamente, procesa async.
//   Vercel Fluid Compute mantiene el proceso vivo para completar el trabajo.

import crypto from 'crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleLifestyleMessage } from '@presenciapro/engine/bot';
import { sendMessage } from '@presenciapro/engine/notifications';
import type { LifestyleBusinessConfig } from '@presenciapro/engine/bot';
import { parseTwilioPayload, buildLifestyleMessage as buildTwilioMessage } from '@presenciapro/engine/bot/lifestyle/adapters/twilioAdapter';
import { parseMetaPayload, buildLifestyleMessage as buildMetaMessage } from '@presenciapro/engine/bot/lifestyle/adapters/metaAdapter';
import { maskPhone } from '@presenciapro/engine/utils';

// ─── Supabase admin client ────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key);
}

// ─── DB row type ──────────────────────────────────────────────────────────────

type BusinessRow = {
  id: string;
  name: string;
  whatsapp_number: string;
  whatsapp_phone_number_id: string;
  bot_name: string;
  away_message: string;
  fallback_message: string;
  office_hours: LifestyleBusinessConfig['officeHours'];
  walk_in_buffer_minutes: number;
  address: string;
  timezone: string;
};

function rowToBusiness(row: BusinessRow): LifestyleBusinessConfig {
  return {
    id:                    row.id,
    name:                  row.name,
    whatsappNumber:        row.whatsapp_number,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    botName:               row.bot_name,
    awayMessage:           row.away_message,
    fallbackMessage:       row.fallback_message,
    officeHours:           row.office_hours,
    walkInBufferMinutes:   row.walk_in_buffer_minutes,
    address:               row.address,
    timezone:              row.timezone,
  };
}

const BUSINESS_SELECT =
  'id, name, whatsapp_number, whatsapp_phone_number_id, ' +
  'bot_name, away_message, fallback_message, office_hours, ' +
  'walk_in_buffer_minutes, address, timezone';

const NON_TEXT_MESSAGE =
  'Por ahora solo puedo leer mensajes de texto. Escribeme lo que necesitas y con gusto te ayudo.';

// ─── GET — Webhook verification (Meta) ───────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ─── POST — Incoming message ──────────────────────────────────────────────────
// TODO (B-1 — rate limiting): sin rate limiting, este endpoint puede recibir
// flood de mensajes. Meta/Twilio tienen límites upstream, pero un atacante que
// conozca la URL puede generar carga excesiva. Implementar en Fase 2 usando
// Upstash Redis + sliding window por phone_number_id o IP de origen.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const provider = (process.env['MESSAGING_PROVIDER'] ?? 'meta').toLowerCase();

  if (provider === 'twilio') {
    return handleTwilioPost(request);
  }

  return handleMetaPost(request);
}

// ─── Twilio POST handler ──────────────────────────────────────────────────────

async function handleTwilioPost(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  // ── Verificar firma de Twilio ─────────────────────────────────────────────

  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  const ngrokUrl  = process.env['NGROK_URL'];

  if (!authToken || !ngrokUrl) {
    console.error('[bot/route] TWILIO_AUTH_TOKEN y NGROK_URL son requeridos en modo Twilio');
    return new NextResponse('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const webhookUrl = `${ngrokUrl}/api/bot`;
  const signature  = request.headers.get('x-twilio-signature') ?? '';

  if (!verifyTwilioSignature(authToken, webhookUrl, rawBody, signature)) {
    console.error('[bot/route] Firma de Twilio inválida — request rechazado');
    return new NextResponse('<Response></Response>', { status: 403 });
  }

  // ── Parsear payload ───────────────────────────────────────────────────────

  // isDev declarado antes del !normalized para poder usarlo en la detección no-texto
  const isDev    = process.env['NODE_ENV'] !== 'production';
  const formData = new URLSearchParams(rawBody);
  const normalized = parseTwilioPayload(formData);

  if (!normalized) {
    // Detectar mensaje no-texto (audio, imagen, sticker, video, etc.)
    // Indicadores: From y To presentes pero Body ausente + NumMedia > 0 o MediaUrl0 presente
    const from     = formData.get('From');
    const numMedia = parseInt(formData.get('NumMedia') ?? '0', 10);
    const mediaUrl = formData.get('MediaUrl0');

    if (from && (numMedia > 0 || mediaUrl)) {
      const customerPhone = from.replace(/^whatsapp:\+?/, '').replace(/^\+/, '');
      if (isDev) {
        return new NextResponse(
          `<Response><Message>${escapeXml(NON_TEXT_MESSAGE)}</Message></Response>`,
          { status: 200, headers: { 'Content-Type': 'text/xml' } },
        );
      }
      after(async () => {
        try {
          await sendMessage({ to: customerPhone, message: NON_TEXT_MESSAGE });
        } catch { /* best-effort */ }
      });
    }

    return new NextResponse('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // ── Procesar y responder ──────────────────────────────────────────────────
  //
  // Dev  (NODE_ENV !== 'production'):
  //   Espera el pipeline de forma síncrona (máx 12 s) y devuelve TwiML con
  //   el mensaje del bot. Evita el problema de fire-and-forget en Next.js dev.
  //
  // Prod (Vercel Fluid Compute):
  //   Responde TwiML vacío de inmediato; after() mantiene el proceso vivo
  //   para que processTwilioMessage complete el envío vía API de Twilio.

  if (isDev) {
    const DEV_TIMEOUT_MS = 12_000;

    const responseText = await Promise.race([
      getTwilioResponseText(
        normalized.customerPhone,
        normalized.toNumber,
        normalized.body,
        normalized.customerName,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DEV_TIMEOUT_MS)),
    ]);

    const twiml = responseText
      ? `<Response><Message>${escapeXml(responseText)}</Message></Response>`
      : '<Response></Response>';

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  after(() => processTwilioMessage(normalized.customerPhone, normalized.toNumber, normalized.body, normalized.customerName));

  return new NextResponse('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

// ─── Verificación de firma Meta ───────────────────────────────────────────────

/**
 * Verifica la firma X-Hub-Signature-256 de Meta usando HMAC-SHA256.
 *
 * Retorna true  — firma válida.
 * Retorna false — firma inválida → rechazar request.
 * Retorna null  — META_APP_SECRET no configurado → permitir (dev/staging).
 */
function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean | null {
  const appSecret = process.env['META_APP_SECRET'];

  if (!appSecret) {
    console.warn('[bot/route:meta] META_APP_SECRET no configurado — omitiendo verificación de firma (solo permitido en dev/staging)');
    return null;
  }

  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const receivedHex  = signatureHeader.slice('sha256='.length);
  const expectedHmac = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHmac, 'hex'),
      Buffer.from(receivedHex,  'hex'),
    );
  } catch {
    return false;
  }
}

// ─── Meta POST handler ────────────────────────────────────────────────────────

async function handleMetaPost(request: NextRequest): Promise<NextResponse> {
  // ── Leer raw body y verificar firma ──────────────────────────────────────
  // IMPORTANTE: leer como texto ANTES de parsear JSON — la firma de Meta se
  // calcula sobre el raw body exacto enviado por el servidor de Meta.

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ status: 'ok' });
  }

  const signatureValid = verifyMetaSignature(
    rawBody,
    request.headers.get('x-hub-signature-256'),
  );

  if (signatureValid === false) {
    console.error(JSON.stringify({
      ts:      new Date().toISOString(),
      service: 'bot',
      event:   'meta_signature_invalid',
      error:   'X-Hub-Signature-256 invalida — request rechazado',
    }));
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parsear JSON ──────────────────────────────────────────────────────────

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: 'ok' });
  }

  const normalized = parseMetaPayload(body);

  if (!normalized) {
    // Detectar mensaje no-texto ANTES de descartar — extraemos fromPhone del payload raw
    // (parseMetaPayload ya descartó la referencia al mensaje; aquí la re-leemos)
    const nonTextSender = detectMetaNonTextSender(body);
    if (nonTextSender) {
      after(() => sendNonTextResponseMeta(nonTextSender.phoneNumberId, nonTextSender.fromPhone));
    }
    // Status updates, delivery receipts, etc. — no hay nada más que hacer
    return NextResponse.json({ status: 'ok' });
  }

  after(() => processMetaMessage(normalized.phoneNumberId, normalized.customerPhone, normalized.body, normalized.customerName));

  return NextResponse.json({ status: 'ok' });
}

// ─── Verificación de firma Twilio ─────────────────────────────────────────────

/**
 * Verifica la firma X-Twilio-Signature usando HMAC-SHA1.
 *
 * Algoritmo oficial de Twilio:
 * 1. Tomar la URL completa del webhook.
 * 2. Ordenar los params POST alfabéticamente y concatenar key+value.
 * 3. Firmar (URL + concatenado) con HMAC-SHA1 usando el Auth Token.
 * 4. Comparar con la firma que viene en el header.
 */
function verifyTwilioSignature(
  authToken: string,
  webhookUrl: string,
  rawBody: string,
  signature: string,
): boolean {
  const params = new URLSearchParams(rawBody);
  const sortedParams = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('');

  const toSign = webhookUrl + sortedParams;
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(toSign, 'utf8')
    .digest('base64');

  // Comparación en tiempo constante para prevenir timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ─── Pipeline Twilio ──────────────────────────────────────────────────────────

/**
 * Resuelve el negocio para Twilio Sandbox.
 * Twilio Sandbox usa un número compartido: intenta lookup por whatsapp_number;
 * si no hay match, cae a TWILIO_DEV_BUSINESS_ID.
 * Devuelve null si no se puede resolver (ya loguea el motivo).
 */
async function resolveBusinessByTwilio(
  supabase: ReturnType<typeof getServiceClient>,
  toNumber: string,
): Promise<LifestyleBusinessConfig | null> {
  const { data: byNumber } = await supabase
    .from('businesses')
    .select(BUSINESS_SELECT)
    .eq('whatsapp_number', toNumber)
    .eq('active', true)
    .maybeSingle();

  if (byNumber) return rowToBusiness(byNumber as unknown as BusinessRow);

  const devBusinessId = process.env['TWILIO_DEV_BUSINESS_ID'];
  if (!devBusinessId) {
    console.error('[bot/route:twilio] No se encontró negocio para el número:', toNumber, '— configura TWILIO_DEV_BUSINESS_ID para desarrollo');
    return null;
  }

  const { data: byId } = await supabase
    .from('businesses')
    .select(BUSINESS_SELECT)
    .eq('id', devBusinessId)
    .eq('active', true)
    .maybeSingle();

  if (!byId) {
    console.error('[bot/route:twilio] TWILIO_DEV_BUSINESS_ID no encontrado en businesses:', devBusinessId);
    return null;
  }

  return rowToBusiness(byId as unknown as BusinessRow);
}

/**
 * Resuelve el negocio, construye el mensaje y llama al motor conversacional.
 * Devuelve el texto de respuesta del bot, o null si ocurre algún error.
 * No envía el mensaje — eso queda a cargo de la capa que llame a esta función.
 */
async function getTwilioResponseText(
  customerPhone: string,
  toNumber: string,
  messageBody: string,
  customerName: string | null,
): Promise<string | null> {
  try {
    const supabase  = getServiceClient();
    const business  = await resolveBusinessByTwilio(supabase, toNumber);
    if (!business) return null;

    const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';
    const msg = buildTwilioMessage(
      { customerPhone, toNumber, body: messageBody, customerName, messageId: null },
      business.id,
    );

    const response = await handleLifestyleMessage({ msg, business, supabase, anthropicKey });
    return response.message ?? null;
  } catch (err) {
    console.error('[bot/route:twilio] Error en getTwilioResponseText:', err);
    return null;
  }
}

/**
 * Prod: resuelve el negocio, procesa el mensaje y lo envía vía Twilio.
 * Usado por after() en Vercel Fluid Compute.
 * Si el handler falla después de resolver el negocio, envía fallbackMessage.
 */
async function processTwilioMessage(
  customerPhone: string,
  toNumber: string,
  messageBody: string,
  customerName: string | null,
): Promise<void> {
  const supabase = getServiceClient();

  // ── 1. Resolver negocio — si no se encuentra, no hay a quién enviar ──────

  let business: LifestyleBusinessConfig | null = null;
  try {
    business = await resolveBusinessByTwilio(supabase, toNumber);
  } catch (err) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'business_resolve_failed',
      business_id:    null,
      customer_phone: maskPhone(customerPhone),
      state:          null,
      error:          err instanceof Error ? err.message : String(err),
    }));
    return;
  }

  if (!business) return; // ya logueado en resolveBusinessByTwilio

  // ── 2. Procesar y enviar — fallback garantizado si falla ─────────────────

  try {
    const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';

    const msg = buildTwilioMessage(
      { customerPhone, toNumber, body: messageBody, customerName, messageId: null },
      business.id,
    );

    const response = await handleLifestyleMessage({ msg, business, supabase, anthropicKey });

    if (response.message) {
      await sendMessage({
        to:      customerPhone,
        message: response.message,
        // from no se requiere en Twilio (usa TWILIO_WHATSAPP_FROM del env)
      });
    }
  } catch (err) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'handler_failed',
      business_id:    business.id,
      customer_phone: maskPhone(customerPhone),
      state:          null,
      error:          err instanceof Error ? err.message : String(err),
    }));
    try {
      await sendMessage({ to: customerPhone, message: business.fallbackMessage });
    } catch {
      // nada más que hacer
    }
  }
}

// ─── XML escaping para TwiML ──────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Helpers: mensajes no-texto ───────────────────────────────────────────────

/**
 * Detecta un mensaje entrante de tipo no-texto en el payload raw de Meta.
 * Extrae phoneNumberId y fromPhone ANTES de que parseMetaPayload descarte el mensaje.
 * Retorna null si el payload es un status update, delivery receipt, u otro evento
 * sin mensaje de usuario.
 */
function detectMetaNonTextSender(
  body: unknown,
): { phoneNumberId: string; fromPhone: string } | null {
  const payload    = body as Record<string, unknown>;
  const entry      = (payload['entry'] as unknown[])?.[0] as Record<string, unknown> | undefined;
  const change     = (entry?.['changes'] as unknown[])?.[0] as Record<string, unknown> | undefined;
  const value      = change?.['value'] as Record<string, unknown> | undefined;
  const metadata   = value?.['metadata'] as Record<string, unknown> | undefined;
  const messages   = value?.['messages'] as unknown[] | undefined;

  const phoneNumberId = metadata?.['phone_number_id'] as string | undefined;
  if (!phoneNumberId || !messages?.length) return null;

  const message     = messages[0] as Record<string, unknown>;
  const fromPhone   = message['from'] as string | undefined;
  const messageType = message['type'] as string | undefined;

  // Solo los no-texto tienen 'from' pero no 'text.body'
  if (!fromPhone || !messageType || messageType === 'text') return null;

  return { phoneNumberId, fromPhone };
}

/** Envía el mensaje de "solo texto" al cliente — best-effort. */
async function sendNonTextResponseMeta(phoneNumberId: string, fromPhone: string): Promise<void> {
  try {
    await sendMessage({ to: fromPhone, message: NON_TEXT_MESSAGE, from: phoneNumberId });
  } catch {
    // best-effort
  }
}

// ─── Procesamiento async — Meta ───────────────────────────────────────────────

async function processMetaMessage(
  phoneNumberId: string,
  customerPhone: string,
  messageBody: string,
  customerName: string | null,
): Promise<void> {
  const supabase = getServiceClient();

  // ── 1. Resolver negocio — HUECO 3: logs estructurados ────────────────────

  const { data: businessData, error: bizError } = await supabase
    .from('businesses')
    .select(BUSINESS_SELECT)
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .eq('active', true)
    .maybeSingle();

  if (bizError) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'business_select_failed',
      business_id:    null,
      customer_phone: maskPhone(customerPhone),
      state:          null,
      error:          bizError instanceof Error ? bizError.message : String((bizError as { message?: string }).message ?? bizError),
    }));
    return;
  }

  if (!businessData) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'business_not_configured',
      business_id:    null,
      customer_phone: maskPhone(customerPhone),
      state:          null,
      error:          `No business configured for phone_number_id: ${phoneNumberId}`,
    }));
    return;
  }

  const business = rowToBusiness(businessData as unknown as BusinessRow);

  // ── 2. Procesar y enviar — HUECO 2: fallback garantizado si falla ─────────

  try {
    const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';

    const msg = buildMetaMessage(
      { phoneNumberId, customerPhone, body: messageBody, customerName, messageId: null },
      business.id,
    );

    const response = await handleLifestyleMessage({ msg, business, supabase, anthropicKey });

    if (response.message) {
      await sendMessage({
        to:      customerPhone,
        message: response.message,
        from:    business.whatsappPhoneNumberId,
      });
    }
  } catch (err) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'handler_failed',
      business_id:    business.id,
      customer_phone: maskPhone(customerPhone),
      state:          null,
      error:          err instanceof Error ? err.message : String(err),
    }));
    try {
      await sendMessage({
        to:      customerPhone,
        message: business.fallbackMessage,
        from:    business.whatsappPhoneNumberId,
      });
    } catch {
      // nada más que hacer
    }
  }
}
