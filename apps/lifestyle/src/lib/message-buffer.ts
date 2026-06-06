// ─── Message Buffer — debounce de mensajes consecutivos ───────────────────────
// S4-BOT-01 + S4-BOT-05. Capa fina sobre Upstash Redis: arma el cliente, las
// keys y la config desde env, y delega TODA la lógica (debounce adaptativo,
// race-safety y dedup de lote) a message-buffer-core.ts —que es pura y
// testeable sin red.
//
// Problema original: cuando un usuario WhatsApp envía varios mensajes seguidos
// ("Hola" / "quiero un corte" / "para mañana"), el bot respondía varias veces
// encimado. S4-BOT-05 lo agrava cuando los mensajes vienen pausados.
//
// Solución (ver message-buffer-core.ts):
//   - Debounce ADAPTATIVO: la ventana se re-arma con cada mensaje nuevo hasta
//     un cap, consolidando ráfagas pausadas en un solo turno.
//   - Race-safe: el lock del turno se mantiene durante todo el procesamiento;
//     los mensajes que llegan mientras el modelo trabaja se drenan después,
//     nunca en paralelo.
//   - Dedup: reintentos de webhook (mismo message_id) se descartan al ingresar
//     y al consolidar el lote.
//
// Arquitectura: Redis SET NX para elección de owner entre instancias de Vercel
// Fluid Compute. El sleep/drain vive dentro de after(), que mantiene la
// instancia viva durante la ventana + el procesamiento.
//
// Solo aplica a mensajes de tipo 'text'. Mensajes interactive/audio/image/
// document no llegan a esta función — parseMetaPayload ya los filtra.
//
// Sin Redis configurado (dev local): el mensaje se procesa de inmediato, sin
// buffer ni delay. Comportamiento transparente. Fail-open ante errores de Redis.

import { Redis } from '@upstash/redis';
import {
  buildSingleMessage,
  loadBufferConfig,
  runBufferedTurn,
  type BufferedMessage,
  type BufferKeys,
  type FlushedBuffer,
  type RedisLike,
} from './message-buffer-core';

export type { BufferedMessage, FlushedBuffer } from './message-buffer-core';
export { loadBufferConfig } from './message-buffer-core';

// ─── Redis client (singleton) ─────────────────────────────────────────────────

const _url   = process.env['UPSTASH_REDIS_REST_URL'];
const _token = process.env['UPSTASH_REDIS_REST_TOKEN'];

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!_url || !_token) return null;
  // automaticDeserialization:false — Upstash por defecto hace JSON.parse de los
  // valores al leer. Como guardamos JSON.stringify(msg) con rpush, una lectura
  // con lrange devolvería el OBJETO ya parseado y consolidateBatch volvería a
  // hacer JSON.parse sobre él → throw → batch null → processFn nunca corre.
  // Desactivarlo mantiene los valores como strings crudos (igual que el fake de
  // tests) y la consolidación funciona.
  if (!_redis) _redis = new Redis({ url: _url, token: _token, automaticDeserialization: false });
  return _redis;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

function buildKeys(phoneNumberId: string, fromPhone: string): BufferKeys {
  const base = `${phoneNumberId}:${fromPhone}`;
  return {
    buffer: `presenciapro:msgbuf:${base}`,
    lock:   `presenciapro:msglock:${base}`,
    seen:   `presenciapro:msgseen:${base}`,
  };
}

// ─── Deps de producción ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Acumula el mensaje entrante y, si esta invocación es elegida owner del turno,
 * ejecuta el debounce adaptativo y procesa el/los lote(s) consolidado(s) vía
 * `processFn`. Las invocaciones que no son owner solo empujan al buffer.
 *
 * - Sin Redis (dev local): procesa el mensaje original de inmediato.
 * - Error de Redis: fail-open → procesa el mensaje original directamente.
 *
 * El llamador (route.ts) NO debe procesar el mensaje por su cuenta: todo el
 * trabajo real ocurre dentro de `processFn`, que este buffer invoca cuando
 * corresponde.
 */
export async function bufferAndProcess(
  phoneNumberId: string,
  fromPhone:     string,
  msg:           BufferedMessage,
  processFn:     (batch: FlushedBuffer) => Promise<void>,
): Promise<void> {
  const redis = getRedis();

  // Sin Redis: procesar directamente sin buffer ni delay.
  if (!redis) {
    await processFn(buildSingleMessage(msg));
    return;
  }

  const keys = buildKeys(phoneNumberId, fromPhone);
  const cfg  = loadBufferConfig();

  try {
    await runBufferedTurn(
      redis as unknown as RedisLike,
      keys,
      msg,
      cfg,
      { sleep, now: Date.now },
      processFn,
    );
  } catch (err) {
    // Fail-open: Redis caído → procesar el mensaje original directamente.
    console.error(JSON.stringify({
      ts:      new Date().toISOString(),
      service: 'bot',
      event:   'message_buffer_error',
      error:   err instanceof Error ? err.message : String(err),
    }));
    await processFn(buildSingleMessage(msg));
  }
}
