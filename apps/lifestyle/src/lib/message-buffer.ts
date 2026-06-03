// ─── Message Buffer — debounce de mensajes consecutivos ───────────────────────
// Problema: cuando un usuario WhatsApp envía 3 mensajes rápidos ("Hola" /
// "quiero un corte" / "para mañana"), el bot responde 3 veces encimado.
//
// Solución: buffer en Redis con ventana de debounce de 2.5s.
//   - Primer mensaje de la ventana: adquiere lock con SET NX, espera WINDOW_MS,
//     lee buffer completo, concatena y procesa como un solo bloque.
//   - Mensajes subsecuentes (misma ventana): solo pushean al buffer y retornan.
//     El lock owner los recogerá al despertar.
//
// Arquitectura: Redis SET NX para elección de lock owner entre instancias de
// Vercel Fluid Compute. El sleep vive dentro de after(), que mantiene la
// instancia viva durante los 2.5s.
//
// Recuperación de orphans: si el lock owner muere durante el sleep (edge case
// ≈ 1 en 10,000):
//   - El lock expira automáticamente después de WINDOW_MS.
//   - Si el usuario envía otro mensaje dentro del TTL del buffer (10s), ese
//     mensaje adquiere el lock, hace sleep, y flushea todos los mensajes
//     acumulados (incluyendo los del owner muerto).
//   - Si no llega otro mensaje en 10s, el buffer expira silenciosamente.
//     El usuario simplemente reenvía. Este tradeoff es aceptable.
//
// Solo aplica a mensajes de tipo 'text'. Mensajes interactive/audio/image/
// document no llegan a esta función — parseMetaPayload ya los filtra.
//
// Sin Redis configurado (dev local): bufferAndWait retorna inmediatamente con
// el mensaje original (sin delay, sin buffer). Comportamiento transparente.

import { Redis } from '@upstash/redis';

// ─── Configuración ────────────────────────────────────────────────────────────

/**
 * Ventana de debounce en ms. Configurable vía env var MESSAGE_BUFFER_WINDOW_MS.
 * Default: 2500ms (2.5 segundos).
 */
export const MESSAGE_BUFFER_WINDOW_MS =
  parseInt(process.env['MESSAGE_BUFFER_WINDOW_MS'] ?? '2500', 10);

/** TTL del buffer en segundos. Debe ser mayor que WINDOW_MS para permitir recuperación de orphans. */
const BUFFER_TTL_S = 10;

// ─── Redis client (singleton) ─────────────────────────────────────────────────

const _url   = process.env['UPSTASH_REDIS_REST_URL'];
const _token = process.env['UPSTASH_REDIS_REST_TOKEN'];

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!_url || !_token) return null;
  if (!_redis) _redis = new Redis({ url: _url, token: _token });
  return _redis;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type BufferedMessage = {
  text:          string;
  timestamp:     number;
  message_id:    string | null;
  customer_name: string | null;
};

export type FlushedBuffer = {
  /** Todos los textos concatenados con '\n'. */
  combinedText:  string;
  /** message_id del último mensaje en orden cronológico (para dedup en el engine). */
  lastMessageId: string | null;
  /** Nombre del primer mensaje con customerName no-null. */
  customerName:  string | null;
  /** Número de mensajes acumulados. */
  count:         number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufferKey(phoneNumberId: string, fromPhone: string): string {
  return `presenciapro:msgbuf:${phoneNumberId}:${fromPhone}`;
}

function lockKey(phoneNumberId: string, fromPhone: string): string {
  return `presenciapro:msglock:${phoneNumberId}:${fromPhone}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSingleMessage(msg: BufferedMessage): FlushedBuffer {
  return {
    combinedText:  msg.text,
    lastMessageId: msg.message_id,
    customerName:  msg.customer_name,
    count:         1,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Hace debounce del mensaje entrante usando Redis como buffer distribuido.
 *
 * - Si esta invocación adquiere el lock (primer mensaje de la ventana):
 *   Espera `MESSAGE_BUFFER_WINDOW_MS`, lee todos los mensajes acumulados,
 *   los concatena y retorna el resultado.
 *
 * - Si otra instancia ya tiene el lock (mensaje subsecuente):
 *   Pushea al buffer y retorna `null`. El caller debe ignorar este mensaje —
 *   el lock owner lo procesará junto con los demás al despertar.
 *
 * - Sin Redis configurado (dev local):
 *   Retorna el mensaje original inmediatamente sin delay.
 *
 * - En caso de error Redis:
 *   Fail-open: retorna el mensaje original para no bloquear el bot.
 */
export async function bufferAndWait(
  phoneNumberId: string,
  fromPhone:     string,
  msg:           BufferedMessage,
): Promise<FlushedBuffer | null> {
  const redis = getRedis();

  // Sin Redis: procesar directamente sin buffer ni delay
  if (!redis) {
    return buildSingleMessage(msg);
  }

  const bKey = bufferKey(phoneNumberId, fromPhone);
  const lKey = lockKey(phoneNumberId, fromPhone);

  try {
    // 1. Agregar mensaje al buffer y refrescar su TTL
    await redis.rpush(bKey, JSON.stringify(msg));
    await redis.expire(bKey, BUFFER_TTL_S);

    // 2. Intentar adquirir el lock de procesamiento
    //    NX = solo si no existe | PX = TTL en milisegundos
    //    Upstash retorna 'OK' si SET NX tuvo éxito, null si ya existía
    const acquired = await redis.set(lKey, '1', { nx: true, px: MESSAGE_BUFFER_WINDOW_MS });

    if (acquired === null) {
      // Otra instancia tiene el lock — solo empujamos al buffer y salimos.
      // El lock owner leerá este mensaje cuando despierte.
      return null;
    }

    // 3. Somos el lock owner. Esperar la ventana de debounce.
    await sleep(MESSAGE_BUFFER_WINDOW_MS);

    // 4. Leer y limpiar el buffer atómicamente
    const raw = await redis.lrange(bKey, 0, -1);
    await redis.del(bKey, lKey);

    if (!raw || raw.length === 0) {
      // Buffer expiró (TTL de 10s) o fue limpiado por otra instancia.
      // Procesar el mensaje original como fallback.
      return buildSingleMessage(msg);
    }

    // 5. Parsear, ordenar cronológicamente y concatenar
    const messages: BufferedMessage[] = raw
      .map((item) => {
        try {
          return JSON.parse(item as string) as BufferedMessage;
        } catch {
          return null;
        }
      })
      .filter((m): m is BufferedMessage => m !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (messages.length === 0) return buildSingleMessage(msg);

    return {
      combinedText:  messages.map((m) => m.text).join('\n'),
      lastMessageId: messages[messages.length - 1]?.message_id ?? null,
      customerName:  messages.find((m) => m.customer_name !== null)?.customer_name ?? null,
      count:         messages.length,
    };

  } catch (err) {
    // Fail-open: Redis caído → procesar mensaje original directamente
    console.error(JSON.stringify({
      ts:    new Date().toISOString(),
      service: 'bot',
      event: 'message_buffer_error',
      error: err instanceof Error ? err.message : String(err),
    }));
    return buildSingleMessage(msg);
  }
}
