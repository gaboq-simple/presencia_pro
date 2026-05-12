// ─── Lifestyle Bot — Model Router ─────────────────────────────────────────────
// Selecciona el modelo de Anthropic óptimo según el estado del bot.
//
// Estados terminales / respuestas simples → Haiku (deterministas, bajo costo).
// Estados de razonamiento y personalidad → Sonnet (calidad NLU superior).
//
// El clasificador de intenciones (classifier.ts) ya usa Haiku directamente
// y NO pasa por este router — no tocarlo.

import type { LifestyleBotState } from '../../types/lifestyle.types';

// ─── Constantes de modelos ────────────────────────────────────────────────────

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-20250514';

// ─── Clasificación de estados ─────────────────────────────────────────────────

/**
 * Estados que usan Haiku: respuestas deterministas o de estructura fija.
 * El bot solo necesita formatear datos que ya tiene — no requiere razonamiento complejo.
 */
const HAIKU_STATES = new Set<LifestyleBotState>([
  'GREETING',              // saludo inicial — plantilla personalizada simple
  'CONFIRMED',             // resumen de cita — datos estructurados del sistema
  'AWAITING_BOOKING_NAME', // recolección de nombre — lógica determinista, sin NLU complejo
  'FALLBACK',              // mensaje de fallback — plantilla fija del negocio
  'QUALIFYING_WAITLIST',   // confirmación de lista de espera — plantilla
  'COMPLETED',             // cierre de conversación — mensaje simple
  'AWAY',                  // fuera de horario — no llama a Anthropic (devuelve awayMessage)
  'ESCALATED',             // escalado a humano — no genera texto con Claude
]);

// ─── Selector público ─────────────────────────────────────────────────────────

/**
 * Retorna el model ID de Anthropic apropiado para el estado dado.
 *
 * Los state handlers no necesitan conocer el modelo — reciben el string
 * pre-seleccionado via StateHandlerDeps.model.
 */
export function selectModel(state: LifestyleBotState): string {
  return HAIKU_STATES.has(state) ? HAIKU_MODEL : SONNET_MODEL;
}
