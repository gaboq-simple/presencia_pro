// ─── Message Buffer — Core (pura, testeable sin red) ──────────────────────────
// S4-BOT-05. Lógica de consolidación de mensajes consecutivos de WhatsApp,
// independiente de Upstash y de Vercel. Todo el I/O se inyecta vía la interfaz
// RedisLike + deps (sleep/now), de modo que las pruebas corren deterministas y
// en milisegundos sin tocar la red ni Redis real.
//
// Tres garantías que este módulo implementa (ver S4-BOT-05):
//
//   FIX 1 — Debounce ADAPTATIVO: mientras sigan llegando mensajes del mismo
//   usuario, la ventana se re-arma (base + extensiones) hasta un CAP máximo.
//   Así 3-5 mensajes cortos —aunque vengan pausados— se consolidan en UN turno.
//
//   FIX 2 — Race debounce↔procesamiento: el lock del turno se mantiene durante
//   TODO el procesamiento (no se libera antes). Los mensajes que llegan mientras
//   el modelo trabaja se acumulan en el buffer y se drenan en la siguiente
//   iteración del mismo owner — nunca se procesan en paralelo.
//
//   DEDUP de lote: al consolidar se deduplica contra TODOS los message_id del
//   lote (no solo el último) y, antes de bufferear, se descartan reintentos de
//   webhook ya vistos (set `seen`).

// ─── Tipos de mensaje ─────────────────────────────────────────────────────────

export type BufferedMessage = {
  text:          string;
  timestamp:     number;
  message_id:    string | null;
  customer_name: string | null;
};

export type FlushedBuffer = {
  /** Todos los textos del lote concatenados con '\n'. */
  combinedText:  string;
  /** message_id del último mensaje (cronológico) tras deduplicar — para dedup aguas abajo. */
  lastMessageId: string | null;
  /** Primer customer_name no-null del lote. */
  customerName:  string | null;
  /** Número de mensajes únicos consolidados. */
  count:         number;
};

// ─── Configuración del debounce ───────────────────────────────────────────────

export type BufferConfig = {
  /** Ventana base de debounce en ms (default env MESSAGE_BUFFER_WINDOW_MS=2500). */
  baseMs:      number;
  /** Extensión por mensaje nuevo en ms (default env MESSAGE_BUFFER_EXTENSION_MS=2500). */
  extensionMs: number;
  /** Cap total de la ventana adaptativa en ms (default env MESSAGE_BUFFER_MAX_WINDOW_MS=10000). */
  capMs:       number;
  /** TTL del buffer en segundos. Debe exceder capMs para permitir recuperación de orphans. */
  bufferTtlS:  number;
  /** TTL del lock de turno en ms. Debe exceder capMs + tiempo de procesamiento. */
  lockTtlMs:   number;
  /** TTL del set de message_id ya vistos, en segundos (dedup de reintentos de webhook). */
  seenTtlS:    number;
};

// ─── Interfaz mínima de Redis (subset de Upstash) ─────────────────────────────

export type RedisLike = {
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  llen(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, opts: { nx: true; px: number }): Promise<'OK' | null>;
  sadd(key: string, member: string): Promise<number>;
};

export type BufferDeps = {
  sleep: (ms: number) => Promise<void>;
  now:   () => number;
};

export type BufferKeys = {
  buffer: string;
  lock:   string;
  seen:   string;
};

/** Resultado del turno bufferizado (útil para logs/tests). */
export type RunResult =
  | { status: 'duplicate' }                 // message_id ya visto → ignorado
  | { status: 'buffered' }                  // otra instancia es owner → solo se empujó
  | { status: 'processed'; turns: number }; // este owner procesó N lotes

// ─── Consolidación + dedup de lote ────────────────────────────────────────────

/**
 * Parsea el buffer crudo, ordena cronológicamente y deduplica por message_id
 * (conserva la primera aparición; los mensajes sin id no se pueden deduplicar).
 * Retorna null si no queda ningún mensaje válido.
 */
export function consolidateBatch(raw: unknown[]): FlushedBuffer | null {
  const parsed: BufferedMessage[] = (raw ?? [])
    .map((item) => {
      // Defensa en profundidad: Upstash con automaticDeserialization=true
      // devuelve el valor YA parseado (objeto). Si recibimos un objeto, lo
      // usamos tal cual; solo parseamos cuando es string.
      if (item && typeof item === 'object') {
        return item as BufferedMessage;
      }
      try {
        return JSON.parse(item as string) as BufferedMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is BufferedMessage => m !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const seen = new Set<string>();
  const deduped = parsed.filter((m) => {
    if (!m.message_id) return true;          // sin id → no deduplicable, se conserva
    if (seen.has(m.message_id)) return false; // id repetido en el lote → descartar
    seen.add(m.message_id);
    return true;
  });

  if (deduped.length === 0) return null;

  return {
    combinedText:  deduped.map((m) => m.text).join('\n'),
    lastMessageId: deduped[deduped.length - 1]?.message_id ?? null,
    customerName:  deduped.find((m) => m.customer_name !== null)?.customer_name ?? null,
    count:         deduped.length,
  };
}

export function buildSingleMessage(msg: BufferedMessage): FlushedBuffer {
  return {
    combinedText:  msg.text,
    lastMessageId: msg.message_id,
    customerName:  msg.customer_name,
    count:         1,
  };
}

// ─── Ventana adaptativa ───────────────────────────────────────────────────────

/**
 * Espera la ventana de debounce re-armándola mientras lleguen mensajes nuevos.
 *
 *   1. Espera `baseMs`.
 *   2. Si el buffer creció respecto al último conteo Y no se superó `capMs`,
 *      espera otra `extensionMs` (recortada para no exceder el cap) y repite.
 *   3. Si no creció o se alcanzó el cap, cierra la ventana.
 *
 * Resultado: una ráfaga de mensajes —aunque pausados— se consolida en un solo
 * turno, sin esperar más allá del cap total.
 */
export async function adaptiveWait(
  redis:  RedisLike,
  bufferKey: string,
  cfg:    BufferConfig,
  deps:   BufferDeps,
): Promise<void> {
  const start = deps.now();
  let lastCount = await redis.llen(bufferKey);

  await deps.sleep(cfg.baseMs);

  for (;;) {
    const count   = await redis.llen(bufferKey);
    const elapsed = deps.now() - start;

    if (count <= lastCount) return;        // sin mensajes nuevos → ventana cerrada
    if (elapsed >= cfg.capMs) return;      // cap alcanzado → no extender más

    lastCount = count;
    const remaining = cfg.capMs - elapsed;
    await deps.sleep(Math.min(cfg.extensionMs, remaining));
  }
}

// ─── Turno bufferizado completo (debounce + race-safe drain) ───────────────────

/**
 * Ejecuta un turno bufferizado race-safe.
 *
 * - Descarta reintentos de webhook ya vistos (dedup de ingreso por message_id).
 * - Empuja el mensaje al buffer.
 * - Elige un único owner por turno vía SET NX. Quien NO adquiere el lock retorna
 *   `buffered` (su mensaje será consolidado por el owner).
 * - El owner ejecuta un drain loop: ventana adaptativa → consolida → `processFn`.
 *   Mantiene el lock durante el procesamiento; los mensajes que lleguen mientras
 *   el modelo trabaja quedan en el buffer y se drenan en la siguiente vuelta,
 *   nunca en paralelo. El lock se libera solo al final (finally).
 *
 * `processFn` realiza el trabajo real (resolver negocio + FSM + enviar respuesta).
 */
export async function runBufferedTurn(
  redis:     RedisLike,
  keys:      BufferKeys,
  msg:       BufferedMessage,
  cfg:       BufferConfig,
  deps:      BufferDeps,
  processFn: (batch: FlushedBuffer) => Promise<void>,
): Promise<RunResult> {
  // 1. Dedup de ingreso: reintento de webhook con el mismo message_id → ignorar.
  if (msg.message_id) {
    const added = await redis.sadd(keys.seen, msg.message_id);
    await redis.expire(keys.seen, cfg.seenTtlS);
    if (added === 0) return { status: 'duplicate' };
  }

  // 2. Empujar al buffer y refrescar su TTL.
  await redis.rpush(keys.buffer, JSON.stringify(msg));
  await redis.expire(keys.buffer, cfg.bufferTtlS);

  // 3. Elección de owner del turno.
  const acquired = await redis.set(keys.lock, '1', { nx: true, px: cfg.lockTtlMs });
  if (acquired === null) return { status: 'buffered' };

  // 4. Drain loop — mantiene el lock durante todo el procesamiento (FIX 2).
  let turns = 0;
  try {
    for (;;) {
      const pending = await redis.llen(keys.buffer);
      if (pending === 0) break;            // nada pendiente → fin del turno

      await adaptiveWait(redis, keys.buffer, cfg, deps);

      const raw = await redis.lrange(keys.buffer, 0, -1);
      await redis.del(keys.buffer);

      const batch = consolidateBatch(raw);
      if (!batch) break;

      await processFn(batch);              // procesamiento serializado bajo el lock
      turns++;
      // Los mensajes que hayan llegado durante processFn están de nuevo en el
      // buffer; la siguiente iteración los detecta vía llen y los drena.
    }
    return { status: 'processed', turns };
  } finally {
    await redis.del(keys.lock);
  }
}

// ─── Config desde env ─────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Construye la configuración del buffer desde variables de entorno, con los
 * valores actuales como default (retrocompatible con S4-BOT-01).
 */
export function loadBufferConfig(): BufferConfig {
  const baseMs      = intEnv('MESSAGE_BUFFER_WINDOW_MS', 2500);
  const extensionMs = intEnv('MESSAGE_BUFFER_EXTENSION_MS', 2500);
  const capMs       = Math.max(intEnv('MESSAGE_BUFFER_MAX_WINDOW_MS', 10000), baseMs);
  const bufferTtlS  = Math.max(intEnv('MESSAGE_BUFFER_TTL_S', Math.ceil(capMs / 1000) + 2), 12);
  const lockTtlMs   = intEnv('MESSAGE_BUFFER_LOCK_TTL_MS', 60000);
  const seenTtlS    = intEnv('MESSAGE_BUFFER_SEEN_TTL_S', 120);
  return { baseMs, extensionMs, capMs, bufferTtlS, lockTtlMs, seenTtlS };
}
