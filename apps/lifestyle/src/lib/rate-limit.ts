// ─── Rate Limiting — Upstash Redis (distribuido) ─────────────────────────────
// Usa @upstash/ratelimit con Sliding Window para rate limiting distribuido
// entre instancias de Vercel Fluid Compute.
//
// Si UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN no están configuradas
// (entorno de desarrollo local), cae automáticamente a un rate limiter
// in-memory (no distribuido, pero funcional para dev).
//
// Política de errores: fail-open. Si Redis está caído, se permite el request
// y se loguea el error. Un rate limiter caído NO debe bloquear usuarios legítimos.

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// ─── Configuración Upstash ────────────────────────────────────────────────────

const url   = process.env['UPSTASH_REDIS_REST_URL'];
const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
const isUpstashConfigured = !!url && !!token;

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({ url: url!, token: token! });
  }
  return redisClient;
}

// Cache de instancias Ratelimit por configuración (evita crear una nueva por request)
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(max: number, windowSec: number): Ratelimit {
  const cacheKey = `${max}:${windowSec}`;
  if (!limiterCache.has(cacheKey)) {
    limiterCache.set(cacheKey, new Ratelimit({
      redis:   getRedis(),
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
      prefix:  'presenciapro:rl',
    }));
  }
  return limiterCache.get(cacheKey)!;
}

// ─── Fallback in-memory (dev local sin Upstash) ───────────────────────────────

type InMemoryEntry = { count: number; resetAt: number };
const inMemoryMap = new Map<string, InMemoryEntry>();

function inMemoryLimit(
  key: string,
  max: number,
  windowSec: number,
): RateLimitResult {
  const now      = Date.now();
  const windowMs = windowSec * 1_000;
  const entry    = inMemoryMap.get(key);

  if (!entry || now >= entry.resetAt) {
    inMemoryMap.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, limit: max, remaining: max - 1, reset: Math.ceil((now + windowMs) / 1_000) };
  }

  entry.count += 1;
  const remaining = Math.max(0, max - entry.count);
  return {
    success:   entry.count <= max,
    limit:     max,
    remaining,
    reset:     Math.ceil(entry.resetAt / 1_000),
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

export type RateLimitResult = {
  success:   boolean;
  limit:     number;
  remaining: number;
  reset:     number; // Unix timestamp en segundos
};

/**
 * Evalúa si `key` puede hacer otro request dentro de la ventana.
 *
 * @param key       Identificador único del cliente/acción (ej: "pin:1.2.3.4")
 * @param max       Máximo de requests permitidos en la ventana
 * @param windowSec Tamaño de la ventana en segundos
 *
 * @returns { success, limit, remaining, reset }
 *   - success:   true si el request está permitido
 *   - limit:     tope configurado
 *   - remaining: requests restantes en la ventana actual
 *   - reset:     Unix timestamp (segundos) cuando se resetea la ventana
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  // Fallback in-memory para dev local
  if (!isUpstashConfigured) {
    return inMemoryLimit(key, max, windowSec);
  }

  try {
    const result = await getLimiter(max, windowSec).limit(key);
    return {
      success:   result.success,
      limit:     result.limit,
      remaining: result.remaining,
      reset:     Math.ceil(result.reset / 1_000), // Upstash retorna ms
    };
  } catch (err) {
    // Fail-open: Redis caído → permitir el request
    console.error(JSON.stringify({
      ts:    new Date().toISOString(),
      event: 'rate_limit_redis_error',
      key,
      error: err instanceof Error ? err.message : String(err),
    }));
    return { success: true, limit: max, remaining: max, reset: 0 };
  }
}
