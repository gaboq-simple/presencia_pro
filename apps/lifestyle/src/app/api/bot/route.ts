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
import { handleLifestyleMessage, verifyWebhookSignature, checkEasterEgg } from '@presenciapro/engine/bot';
import { sendMessage } from '@presenciapro/engine/notifications';
import type { LifestyleBusinessConfig } from '@presenciapro/engine/bot';
import { parseTwilioPayload, buildLifestyleMessage as buildTwilioMessage } from '@presenciapro/engine/bot/lifestyle/adapters/twilioAdapter';
import { parseMetaPayload, buildLifestyleMessage as buildMetaMessage } from '@presenciapro/engine/bot/lifestyle/adapters/metaAdapter';
import { maskPhone } from '@presenciapro/engine/utils';
import { rateLimit } from '@/lib/rate-limit';
import { tenantDb } from '@/lib/tenantDb';
import { bufferAndProcess } from '@/lib/message-buffer';
import { isTestResetCommand, TEST_RESET_CONFIRMATION } from '@/lib/test-reset';

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
  slug: string;
  whatsapp_number: string;
  whatsapp_phone_number_id: string;
  bot_name: string;
  away_message: string;
  fallback_message: string;
  office_hours: LifestyleBusinessConfig['officeHours'];
  walk_in_buffer_minutes: number;
  address: string;
  timezone: string;
  business_type?: string;
  review_url?: string | null;
  map_url?: string | null;
  attributes?: Record<string, boolean> | null;
};

function rowToBusiness(row: BusinessRow): LifestyleBusinessConfig {
  return {
    id:                    row.id,
    name:                  row.name,
    slug:                  row.slug,
    whatsappNumber:        row.whatsapp_number,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    botName:               row.bot_name,
    awayMessage:           row.away_message,
    fallbackMessage:       row.fallback_message,
    officeHours:           row.office_hours,
    walkInBufferMinutes:   row.walk_in_buffer_minutes,
    address:               row.address,
    timezone:              row.timezone,
    businessType:          row.business_type,
    reviewUrl:             row.review_url ?? null,
    mapUrl:                row.map_url ?? null,
    attributes:            row.attributes ?? null,
  };
}

const BUSINESS_SELECT =
  'id, name, slug, whatsapp_number, whatsapp_phone_number_id, ' +
  'bot_name, away_message, fallback_message, office_hours, ' +
  'walk_in_buffer_minutes, address, timezone, business_type, ' +
  'review_url, map_url, attributes';

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

  const appSecret = process.env['META_APP_SECRET'];
  if (!appSecret) {
    console.error(JSON.stringify({
      ts:      new Date().toISOString(),
      service: 'bot',
      event:   'meta_secret_not_configured',
      error:   'META_APP_SECRET no configurado — request rechazado',
    }));
    return NextResponse.json({ error: 'webhook signature secret not configured' }, { status: 401 });
  }

  const signatureValid = verifyWebhookSignature({
    signatureHeader: request.headers.get('x-hub-signature-256'),
    rawBody,
    appSecret,
  });

  if (signatureValid !== true) {
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
      after(() => sendNonTextResponseMeta(nonTextSender.phoneNumberId, nonTextSender.fromPhone, nonTextSender.messageType));
    }
    // Status updates, delivery receipts, etc. — no hay nada más que hacer
    return NextResponse.json({ status: 'ok' });
  }

  // ── Easter egg — comando oculto interceptado ANTES de rate limit, buffer,
  // FSM y cualquier escritura de estado. No toca bot_conversations. ─────────
  const easterEgg = checkEasterEgg(normalized.body);
  if (easterEgg) {
    console.log(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'easter_egg_triggered',
      customer_phone: maskPhone(normalized.customerPhone),
    }));
    after(async () => {
      try {
        await sendMessage({
          to:      normalized.customerPhone,
          message: easterEgg,
          from:    normalized.phoneNumberId,
        });
      } catch { /* best-effort */ }
    });
    return NextResponse.json({ status: 'ok' });
  }

  // ── Rate limiting — 30 mensajes / 60s por número de negocio ──────────────
  const rl = await rateLimit(`bot:${normalized.phoneNumberId}`, 30, 60);
  if (!rl.success) {
    const retryAfter = rl.reset > 0 ? rl.reset - Math.floor(Date.now() / 1_000) : 60;
    return NextResponse.json(
      { error: 'Too Many Requests' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfter)) } },
    );
  }

  after(async () => {
    // ── Debounce buffer — acumula mensajes rápidos del mismo número ───────
    // bufferAndProcess elige un único owner por turno. Si esta invocación no es
    // owner, solo empuja al buffer y retorna. El owner ejecuta el debounce
    // adaptativo y procesa el/los lote(s) consolidado(s) vía el callback,
    // manteniendo el lock durante todo el procesamiento (sin race ni paralelo).
    await bufferAndProcess(
      normalized.phoneNumberId,
      normalized.customerPhone,
      {
        text:          normalized.body,
        timestamp:     Date.now(),
        message_id:    normalized.messageId,
        customer_name: normalized.customerName,
      },
      async (flushed) => {
        if (flushed.count > 1) {
          console.log(JSON.stringify({
            ts:             new Date().toISOString(),
            service:        'bot',
            event:          'buffer_flushed',
            customer_phone: maskPhone(normalized.customerPhone),
            message_count:  flushed.count,
            info:           `Buffered ${flushed.count} messages from ${maskPhone(normalized.customerPhone)}, processing as single block`,
          }));
        }

        await processMetaMessage(
          normalized.phoneNumberId,
          normalized.customerPhone,
          flushed.combinedText,
          flushed.customerName,
          flushed.lastMessageId,
        );
      },
    );
  });

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

    // ── Comando de reset de prueba (dev síncrono — esta ruta no pasa por
    // handoffGate; retorna el texto directamente como TwiML) ───────────────
    if (isTestResetCommand(customerPhone, messageBody, process.env['TEST_PHONE_ALLOWLIST'])) {
      await performTestReset(supabase, business.id, customerPhone);
      return TEST_RESET_CONFIRMATION;
    }

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

  // ── Comando de reset de prueba — ANTES del handoffGate ───────────────────
  if (isTestResetCommand(customerPhone, messageBody, process.env['TEST_PHONE_ALLOWLIST'])) {
    await performTestReset(supabase, business.id, customerPhone);
    try {
      await sendMessage({ to: customerPhone, message: TEST_RESET_CONFIRMATION });
    } catch { /* best-effort */ }
    return;
  }

  // ── Handoff gate — verificar modo de sesión antes de pasar al FSM ─────────
  const shouldProcess = await handoffGate(supabase, business, customerPhone, messageBody);
  if (!shouldProcess) return;

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
 * Extrae phoneNumberId, fromPhone y messageType ANTES de que parseMetaPayload descarte el mensaje.
 * Retorna null si el payload es un status update, delivery receipt, u otro evento
 * sin mensaje de usuario.
 */
function detectMetaNonTextSender(
  body: unknown,
): { phoneNumberId: string; fromPhone: string; messageType: string } | null {
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

  return { phoneNumberId, fromPhone, messageType };
}

/**
 * Envía una respuesta estática por tipo de mensaje no-texto — best-effort, sin pasar por Claude.
 *
 * Nota: el business row NO está disponible en este punto del flujo.
 * La detección de non-text ocurre cuando `parseMetaPayload` retorna null (mensaje descartado),
 * ANTES del bloque `after()` que llama a `processMetaMessage` donde se resuelve el negocio.
 * Ambas rutas son mutuamente excluyentes — por eso se hace un query ligero solo para `location`.
 */
async function sendNonTextResponseMeta(
  phoneNumberId: string,
  fromPhone: string,
  messageType: string,
): Promise<void> {
  try {
    let reply: string;

    switch (messageType) {
      case 'audio':
        reply = 'Por ahora solo puedo leer mensajes de texto. Escribeme lo que necesitas y con gusto te ayudo \uD83D\uDE0A';
        break;
      case 'image':
      case 'video':
        reply = 'No puedo ver fotos ni videos, pero si me describes lo que buscas te ayudo!';
        break;
      case 'sticker':
        // Silencio — los stickers son decorativos, responder crea ruido
        return;
      case 'document':
        reply = 'No puedo abrir documentos, pero si me dices que necesitas te ayudo.';
        break;
      case 'location': {
        // Requiere lookup ligero — address no está disponible sin resolver el negocio
        const supabase = getServiceClient();
        const { data } = await supabase
          .from('businesses')
          .select('address')
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .eq('active', true)
          .maybeSingle();
        const address = (data as { address?: string } | null)?.address;
        reply = address
          ? `Gracias! Nosotros estamos en ${address}.`
          : 'Gracias por compartir tu ubicacion! Para ver donde estamos, escribeme.';
        break;
      }
      default:
        reply = NON_TEXT_MESSAGE;
    }

    await sendMessage({ to: fromPhone, message: reply, from: phoneNumberId });
  } catch {
    // best-effort
  }
}

// ─── Test reset command ───────────────────────────────────────────────────────
// Comando de reset SOLO para pruebas. Devuelve una conversación a estado limpio
// (GREETING / context vacío / modo bot, handoff liberado) sin borrar la fila a
// mano. Las guardas puras (trigger exacto + allowlist) viven en '@/lib/test-reset'
// (unit-testable). La allowlist se lee de TEST_PHONE_ALLOWLIST (CSV, NO commiteada)
// y se inyecta en cada call site. Se intercepta ANTES del handoffGate para que una
// conversación en modo human/paused no trague el comando antes de resetearse.

/**
 * Resetea la fila de bot_conversations de (business_id, customer_phone) a estado
 * limpio. Reusa el cliente service-role existente. No envía la confirmación —
 * eso queda a cargo del caller (varía por provider).
 */
async function performTestReset(
  supabase: ReturnType<typeof getServiceClient>,
  businessId: string,
  customerPhone: string,
): Promise<void> {
  await tenantDb(supabase, businessId)
    .table('bot_conversations')
    .update({
      state:        'GREETING',
      context:      {},
      session_mode: 'bot',
      taken_by:     null,
      taken_at:     null,
    })
    .eq('customer_phone', customerPhone);

  console.log(JSON.stringify({
    ts:             new Date().toISOString(),
    service:        'bot',
    event:          'test_reset_command',
    business_id:    businessId,
    customer_phone: maskPhone(customerPhone),
  }));
}

// ─── Handoff gate ─────────────────────────────────────────────────────────────
// Verifica si la conversación está bajo control humano o pausada.
// Retorna true  → el FSM debe procesar el mensaje (modo 'bot' o auto-released).
// Retorna false → mensaje interceptado (persistido pero NO pasa al FSM).
//
// Auto-release: si session_mode='human' y taken_at > 30 min, devuelve el control
// al bot automáticamente (evita que una conversación quede en limbo).
// 'paused' no tiene auto-release — es una pausa intencional.

const HANDOFF_TIMEOUT_MINUTES = 30; // TODO: leer de businesses.handoff_timeout_minutes
const HANDOFF_TIMEOUT_MS      = HANDOFF_TIMEOUT_MINUTES * 60 * 1_000;
const HANDOFF_AUTO_RELEASE_MSG =
  'Gracias por tu paciencia. Puedo seguir ayudándote — escríbeme qué necesitas y te asisto.';

async function handoffGate(
  supabase: ReturnType<typeof getServiceClient>,
  business: LifestyleBusinessConfig,
  customerPhone: string,
  messageBody: string,
): Promise<boolean> {
  const { data: conv } = await tenantDb(supabase, business.id)
    .table('bot_conversations')
    .select('id, session_mode, taken_at')
    .eq('customer_phone', customerPhone)
    .maybeSingle();

  // Sin conversación previa o bot en control → flujo normal
  if (!conv) return true;

  const row = conv as { id: string; session_mode: string; taken_at: string | null };

  if (row.session_mode === 'bot') return true;

  // Auto-release: solo aplica en modo 'human' con timeout superado
  if (row.session_mode === 'human' && row.taken_at) {
    const elapsed = Date.now() - new Date(row.taken_at).getTime();
    if (elapsed > HANDOFF_TIMEOUT_MS) {
      const minutesInHuman = Math.round(elapsed / 60_000);
      await tenantDb(supabase, business.id)
        .table('bot_conversations')
        .update({ session_mode: 'bot', taken_by: null, taken_at: null })
        .eq('customer_phone', customerPhone);
      console.log(JSON.stringify({
        ts:               new Date().toISOString(),
        service:          'bot',
        event:            'handoff_auto_released',
        conversation_id:  row.id,
        customer_phone:   maskPhone(customerPhone),
        minutes_in_human: minutesInHuman,
      }));
      try {
        await sendMessage({
          to:      customerPhone,
          message: HANDOFF_AUTO_RELEASE_MSG,
          from:    business.whatsappPhoneNumberId,
        });
      } catch { /* best-effort */ }
      return true; // auto-released → FSM retoma control
    }
  }

  // Modo 'human' (dentro del timeout) o 'paused': interceptar y persistir
  const { data: insertedMsg } = await tenantDb(supabase, business.id)
    .table('conversation_messages')
    .insert({
      customer_phone: customerPhone,
      direction:      'inbound',
      body:           messageBody,
      sent_by:        'customer',
      staff_id:       null,
    })
    .select('id')
    .single()
    .then((r: { data: { id: string } | null }) => r, () => ({ data: null }));

  console.log(JSON.stringify({
    ts:              new Date().toISOString(),
    service:         'bot',
    event:           'handoff_message_persisted',
    conversation_id: row.id,
    customer_phone:  maskPhone(customerPhone),
    message_id:      (insertedMsg as { id?: string } | null)?.id ?? null,
  }));

  return false; // interceptado — no pasar al FSM
}

// ─── Procesamiento async — Meta ───────────────────────────────────────────────

async function processMetaMessage(
  phoneNumberId: string,
  customerPhone: string,
  messageBody: string,
  customerName: string | null,
  messageId: string | null = null,
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

  // ── Comando de reset de prueba — ANTES del handoffGate ───────────────────
  // Debe ir antes del gate: si la conversación quedó en human/paused, el gate
  // tragaría el comando y nunca se resetearía.
  if (isTestResetCommand(customerPhone, messageBody, process.env['TEST_PHONE_ALLOWLIST'])) {
    await performTestReset(supabase, business.id, customerPhone);
    try {
      await sendMessage({
        to:      customerPhone,
        message: TEST_RESET_CONFIRMATION,
        from:    business.whatsappPhoneNumberId,
      });
    } catch { /* best-effort */ }
    return;
  }

  // ── Handoff gate — verificar modo de sesión antes de pasar al FSM ─────────
  const shouldProcess = await handoffGate(supabase, business, customerPhone, messageBody);
  if (!shouldProcess) return;

  // ── 2. Procesar y enviar — HUECO 2: fallback garantizado si falla ─────────

  try {
    const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';

    const msg = buildMetaMessage(
      { phoneNumberId, customerPhone, body: messageBody, customerName, messageId },
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
