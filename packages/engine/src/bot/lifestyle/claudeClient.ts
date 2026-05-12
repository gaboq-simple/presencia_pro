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

type SystemContent = string | Array<{
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}>;

export type CallClaudeParams = {
  client:    Anthropic;
  model:     string;
  maxTokens: number;
  system?:   SystemContent;
  messages:  Anthropic.MessageParam[];
  timeoutMs: number;
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
        ...(system !== undefined ? { system: system as Parameters<typeof client.messages.create>[0]['system'] } : {}),
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
    }
    throw err;
  }
}
