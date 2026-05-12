// ─── Bot Observability Logger ──────────────────────────────────────────────────
// Capa de observabilidad estructurada para el motor conversacional.
// Sin dependencias externas — solo console.log(JSON.stringify(event)).
// La escritura a bot_logs en Supabase es responsabilidad del handler.

export interface BotLogEvent {
  ts: string;               // new Date().toISOString()
  service: 'bot';
  business_id: string;
  customer_phone: string;
  state_from: string;
  state_to: string;
  model_used?: string;
  tokens_input?: number;
  tokens_cache_read?: number;
  tokens_output?: number;
  intent?: string;
  confidence?: number;
  duration_ms?: number;
}

export interface BotErrorEvent extends BotLogEvent {
  error_code: string;       // 'claude_timeout' | 'supabase_write_failed' | etc.
  error_message: string;
  recovered: boolean;
}

/**
 * Enmascara un número de teléfono para logs.
 * +5215558056215 → +5215****6215 (5 primeros + **** + 4 últimos)
 * Nunca enmascara datos en DB — solo para stdout.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'unknown';
  if (phone.length < 8) return phone.slice(-4).padStart(phone.length, '*');
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}

export function logBot(event: BotLogEvent): void {
  console.log(JSON.stringify({ ...event, customer_phone: maskPhone(event.customer_phone) }));
}

export function logBotError(event: BotErrorEvent): void {
  console.log(JSON.stringify({ ...event, customer_phone: maskPhone(event.customer_phone) }));
}
