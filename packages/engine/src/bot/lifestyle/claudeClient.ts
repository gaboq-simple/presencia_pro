// ─── Claude API Client — wrapper con timeout y rate limit ────────────────────
// Centraliza resiliencia para todas las llamadas al SDK de Anthropic:
//   1. Timeout via AbortSignal.timeout(timeoutMs) — evita esperas indefinidas.
//   2. Detección de 429 (RateLimitError) — log WARN estructurado con business_id.
//   3. Re-throw del error — el caller activa su fallback determinista.
//
// Tiempos recomendados:
//   Haiku (clasificador, presentación de slots):  TIMEOUT_HAIKU_MS  = 10 000 ms
//   Sonnet / modelo de negocio (greeting, etc.):  TIMEOUT_SONNET_MS = 15 000 ms
//
// TODO: si se detectan múltiples 429 consecutivos debería dispararse una alerta
//       (Slack, PagerDuty, etc.) — implementar en una sesión de monitoreo dedicada.

import Anthropic from '@anthropic-ai/sdk';
import { maskPhone } from '../../utils/logger';

export const TIMEOUT_HAIKU_MS  = 10_000;
export const TIMEOUT_SONNET_MS = 15_000;

// ─── Tipos ────────────────────────────────────────────────────────────────────

// Nota (residuo LLM, 2026-07-22): se retiró el soporte de bloques system con
// cache_control. Era un no-op silencioso probado: todos los call sites corren
// Haiku 4.5 (mínimo cacheable 4096 tokens) con systems de ~800-2000 tokens —
// por debajo del mínimo la API ni siquiera escribe el cache. Además el system
// varía por negocio/contexto y el tráfico WhatsApp es esporádico vs el TTL de
// 5 min. Si algún día un system supera el mínimo Y hay ráfagas del mismo
// negocio, reintroducirlo es trivial (bloque {type:'text', cache_control}).

export type CallClaudeParams = {
  client:    Anthropic;
  model:     string;
  maxTokens: number;
  system?:   string;
  messages:  Anthropic.MessageParam[];
  timeoutMs: number;
  /**
   * AUD-07d: temperatura de muestreo. Los CLASIFICADORES la fijan en 0 —
   * un clasificador JSON con la default (1.0) produce flips de confidence
   * entre ejecuciones idénticas y cruza los umbrales 0.85/0.60 "según el día".
   * NO pasarla en llamadas generativas con modelos que rechazan sampling
   * params no-default (Sonnet 5+): solo Haiku la usa hoy.
   */
  temperature?: number;
  /** Contexto para logs de error — ayuda a diagnosticar 429 en multi-tenant. */
  context: {
    businessId:    string;
    customerPhone: string;
    state:         string;
  };
};

// ─── Helper: es un RateLimitError del SDK? ────────────────────────────────────

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // El SDK lanza RateLimitError (subclase de APIError) con status 429
  const e = err as Record<string, unknown>;
  if (typeof e['status'] === 'number' && e['status'] === 429) return true;
  // Nombre de la clase por si el duck-type falla
  if (e['name'] === 'RateLimitError') return true;
  return false;
}

// ─── callClaude ───────────────────────────────────────────────────────────────

/**
 * Llama a `client.messages.create()` con timeout y manejo de 429.
 *
 * - Si el timeout se cumple (AbortError): el catch del caller activa el fallback.
 * - Si el error es un 429: loguea WARN estructurado y re-lanza para el fallback.
 * - Cualquier otro error: re-lanza sin transformar.
 */
export async function callClaude(params: CallClaudeParams): Promise<Anthropic.Message> {
  const { client, model, maxTokens, system, messages, timeoutMs, context } = params;

  try {
    return await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(system !== undefined ? { system } : {}),
        messages,
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn(JSON.stringify({
        ts:             new Date().toISOString(),
        service:        'bot',
        event:          'claude_rate_limit_429',
        business_id:    context.businessId,
        customer_phone: maskPhone(context.customerPhone),
        state:          context.state,
        model,
        timeout_ms:     timeoutMs,
        // TODO: implementar alerta si 429s son frecuentes (sesión de monitoreo)
      }));
    } else {
      // Sin este log, un modelo retirado (404), timeout o 5xx degrada TODAS las
      // respuestas generativas a plantilla determinista sin ningún síntoma —
      // pasó en prod con claude-sonnet-4-20250514 (AUD-01, 2026-07-20).
      const e = err as { name?: string; status?: number; message?: string };
      console.error(JSON.stringify({
        ts:             new Date().toISOString(),
        service:        'bot',
        event:          'claude_api_error',
        error_name:     e?.name ?? 'unknown',
        error_status:   typeof e?.status === 'number' ? e.status : null,
        error_message:  typeof e?.message === 'string' ? e.message.slice(0, 300) : null,
        business_id:    context.businessId,
        customer_phone: maskPhone(context.customerPhone),
        state:          context.state,
        model,
        timeout_ms:     timeoutMs,
      }));
    }
    throw err;
  }
}
