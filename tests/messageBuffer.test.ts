// S4-BOT-05 — Tests del buffer de mensajes (debounce adaptativo, race, dedup).
// Puros y deterministas: sin red, sin Redis real, sin Anthropic. Corren en ms.
// Ejecutar: npm test
//
// El I/O se inyecta vía un FakeRedis en memoria + un reloj/sleep simulados, de
// modo que la lógica de message-buffer-core se ejercita sin tiempos reales.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  consolidateBatch,
  runBufferedTurn,
  type BufferConfig,
  type BufferedMessage,
  type BufferKeys,
  type FlushedBuffer,
  type RedisLike,
} from '../apps/lifestyle/src/lib/message-buffer-core';

// ─── FakeRedis: implementación en memoria de RedisLike ────────────────────────

class FakeRedis implements RedisLike {
  lists = new Map<string, string[]>();
  kv    = new Map<string, string>();
  sets  = new Map<string, Set<string>>();

  async rpush(key: string, value: string): Promise<number> {
    const arr = this.lists.get(key) ?? [];
    arr.push(value);
    this.lists.set(key, arr);
    return arr.length;
  }
  async lrange(key: string, start: number, stop: number): Promise<unknown[]> {
    const arr = this.lists.get(key) ?? [];
    return stop === -1 ? arr.slice(start) : arr.slice(start, stop + 1);
  }
  async llen(key: string): Promise<number> {
    return (this.lists.get(key) ?? []).length;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.lists.delete(k)) n++;
      this.kv.delete(k);
    }
    return n;
  }
  async expire(): Promise<number> {
    return 1;
  }
  async set(key: string, value: string, opts: { nx: true; px: number }): Promise<'OK' | null> {
    if (opts?.nx && this.kv.has(key)) return null;
    this.kv.set(key, value);
    return 'OK';
  }
  async sadd(key: string, member: string): Promise<number> {
    const s = this.sets.get(key) ?? new Set<string>();
    const had = s.has(member);
    s.add(member);
    this.sets.set(key, s);
    return had ? 0 : 1;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KEYS: BufferKeys = { buffer: 'buf', lock: 'lock', seen: 'seen' };

const CFG: BufferConfig = {
  baseMs:      5,
  extensionMs: 5,
  capMs:       1000,
  bufferTtlS:  12,
  lockTtlMs:   60_000,
  seenTtlS:    120,
};

function msg(id: string, text: string, ts: number): BufferedMessage {
  return { text, timestamp: ts, message_id: id, customer_name: null };
}

// ─── consolidateBatch ─────────────────────────────────────────────────────────

test('consolidateBatch: concatena en orden cronológico', () => {
  const raw = [
    JSON.stringify(msg('b', 'segundo', 200)),
    JSON.stringify(msg('a', 'primero', 100)),
  ];
  const out = consolidateBatch(raw);
  assert.ok(out);
  assert.equal(out!.combinedText, 'primero\nsegundo');
  assert.equal(out!.count, 2);
  assert.equal(out!.lastMessageId, 'b');
});

test('consolidateBatch: dedup contra TODOS los message_id (no solo el último)', () => {
  // Reintento de un message_id INTERMEDIO del lote → se ignora.
  const raw = [
    JSON.stringify(msg('m1', 'hola', 100)),
    JSON.stringify(msg('m2', 'quiero corte', 200)),
    JSON.stringify(msg('m2', 'quiero corte', 200)), // reintento intermedio
    JSON.stringify(msg('m3', 'manana', 300)),
  ];
  const out = consolidateBatch(raw);
  assert.ok(out);
  assert.equal(out!.count, 3);
  assert.equal(out!.combinedText, 'hola\nquiero corte\nmanana');
});

test('consolidateBatch: mensajes sin id no se deduplican', () => {
  const raw = [
    JSON.stringify({ text: 'a', timestamp: 1, message_id: null, customer_name: null }),
    JSON.stringify({ text: 'b', timestamp: 2, message_id: null, customer_name: null }),
  ];
  const out = consolidateBatch(raw);
  assert.equal(out!.count, 2);
});

test('consolidateBatch: vacío o JSON inválido → null', () => {
  assert.equal(consolidateBatch([]), null);
  assert.equal(consolidateBatch(['{bad json']), null);
});

// ─── Debounce adaptativo ──────────────────────────────────────────────────────

test('debounce adaptativo: 5 mensajes pausados se consolidan en UN turno', async () => {
  const redis = new FakeRedis();
  let clock = 0;
  let sleeps = 0;

  // Mensajes que "llegan" durante la ventana (uno por cada sleep, hasta agotar).
  const arriving = [
    msg('m2', 'quiero corte', 200),
    msg('m3', 'manana', 300),
    msg('m4', 'a las 5', 400),
    msg('m5', 'con el que sea', 500),
  ];

  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      sleeps++;
      const next = arriving.shift();
      if (next) await redis.rpush(KEYS.buffer, JSON.stringify(next));
    },
  };

  const batches: FlushedBuffer[] = [];
  const result = await runBufferedTurn(
    redis, KEYS, msg('m1', 'hola', 100), CFG, deps,
    async (b) => { batches.push(b); },
  );

  assert.deepEqual(result, { status: 'processed', turns: 1 });
  assert.equal(batches.length, 1, 'un solo turno de procesamiento');
  assert.equal(batches[0]!.count, 5, 'los 5 mensajes se consolidaron');
  assert.equal(batches[0]!.combinedText, 'hola\nquiero corte\nmanana\na las 5\ncon el que sea');
  assert.ok(sleeps >= 2, 'la ventana se extendió (más de un sleep)');
});

test('debounce adaptativo: respeta el CAP cuando los mensajes no paran', async () => {
  const redis = new FakeRedis();
  let clock = 0;
  let pushedDuringWindow = 0;
  const capCfg: BufferConfig = { ...CFG, baseMs: 5, extensionMs: 5, capMs: 20 };

  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
      // Flujo "infinito": siempre llega un mensaje nuevo durante la ventana.
      pushedDuringWindow++;
      await redis.rpush(KEYS.buffer, JSON.stringify(msg(`x${pushedDuringWindow}`, 'spam', clock)));
    },
  };

  const batches: FlushedBuffer[] = [];
  await runBufferedTurn(
    redis, KEYS, msg('m1', 'hola', 0), capCfg, deps,
    async (b) => { batches.push(b); },
  );

  assert.equal(batches.length, 1, 'cerró en el cap, no quedó en loop infinito');
  assert.ok(clock >= capCfg.capMs, 'esperó al menos hasta el cap');
  assert.ok(clock <= capCfg.capMs + capCfg.extensionMs, 'no excedió el cap más allá de una extensión');
});

// ─── Race: lock retenido durante el procesamiento ─────────────────────────────

test('race: un mensaje que llega durante el procesamiento NO se procesa en paralelo', async () => {
  const redis = new FakeRedis();
  let clock = 0;
  const deps = { now: () => clock, sleep: async (ms: number) => { clock += ms; } };

  let processing = false;
  let lockHeldDuringProcessing: 'OK' | null = 'OK';
  const order: string[] = [];

  const batches: FlushedBuffer[] = [];
  const result = await runBufferedTurn(
    redis, KEYS, msg('m1', 'primer turno', 100), CFG, deps,
    async (b) => {
      assert.equal(processing, false, 'processFn nunca se ejecuta en paralelo');
      processing = true;
      order.push(`process:${b.combinedText}`);
      batches.push(b);

      if (b.combinedText === 'primer turno') {
        // Simular: un mensaje llega MIENTRAS procesamos el primer turno.
        await redis.rpush(KEYS.buffer, JSON.stringify(msg('m2', 'llego durante proceso', 200)));
        // Otra instancia intenta tomar el lock del turno → debe FALLAR (lock retenido).
        lockHeldDuringProcessing = await redis.set(KEYS.lock, '1', { nx: true, px: CFG.lockTtlMs });
      }
      processing = false;
    },
  );

  assert.equal(lockHeldDuringProcessing, null, 'el lock seguía retenido durante el procesamiento');
  assert.deepEqual(result, { status: 'processed', turns: 2 });
  assert.equal(batches.length, 2);
  assert.equal(batches[0]!.combinedText, 'primer turno');
  assert.equal(batches[1]!.combinedText, 'llego durante proceso', 'se drenó en el SIGUIENTE turno');
});

test('race: una invocación que no es owner solo bufferea (status=buffered)', async () => {
  const redis = new FakeRedis();
  const deps = { now: () => 0, sleep: async () => {} };

  // Owner toma el lock manualmente (simula un turno en curso de otra instancia).
  await redis.set(KEYS.lock, '1', { nx: true, px: CFG.lockTtlMs });

  let processed = false;
  const result = await runBufferedTurn(
    redis, KEYS, msg('m9', 'mensaje concurrente', 100), CFG, deps,
    async () => { processed = true; },
  );

  assert.deepEqual(result, { status: 'buffered' });
  assert.equal(processed, false, 'no procesó: otra instancia es owner');
  assert.equal(await redis.llen(KEYS.buffer), 1, 'el mensaje quedó en el buffer para el owner');
});

// ─── Dedup de ingreso (reintentos de webhook) ─────────────────────────────────

test('dedup de ingreso: reintento del mismo message_id → status=duplicate', async () => {
  const redis = new FakeRedis();
  const deps = { now: () => 0, sleep: async () => {} };

  // Primer ingreso del id: se procesa.
  await runBufferedTurn(redis, KEYS, msg('dup1', 'hola', 100), CFG, deps, async () => {});

  // Reintento del MISMO id (webhook de Meta reintenta): se ignora antes de bufferear.
  let reprocessed = false;
  const result = await runBufferedTurn(
    redis, KEYS, msg('dup1', 'hola', 100), CFG, deps,
    async () => { reprocessed = true; },
  );

  assert.deepEqual(result, { status: 'duplicate' });
  assert.equal(reprocessed, false);
});
