// ─── Lifestyle Bot — Model Router ─────────────────────────────────────────────
// Selecciona el modelo de Anthropic por TAREA DE GENERACIÓN, no por estado
// entrante del FSM.
//
// Historia (punto 4 de AUD-01): la versión anterior clasificaba ESTADOS en
// "Haiku states" vs "Sonnet states" y pre-seleccionaba deps.model en el
// handler. El routing quedó invertido en la práctica: los estados "Sonnet"
// (qualifying*, showing) hardcodeaban HAIKU_MODEL local en sus generativas, y
// las únicas llamadas que consumían deps.model vivían en estados "Haiku"
// (greeting, confirmed) — resultado: Sonnet no se usaba en NINGUNA llamada
// real. El estado entrante es mal proxy del trabajo: un mismo estado hace
// tareas distintas (clasificar, reformular una línea, generar el turno de
// personalidad). Ahora cada call site declara su tarea y este router decide.
//
// El clasificador de intenciones (classifier.ts) usa CLASSIFIER_MODEL (Haiku)
// directamente y NO pasa por este router — no tocarlo.

// ─── Constantes de modelos (única fuente — no duplicar en states) ────────────

export const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
// claude-sonnet-4-20250514 fue retirado por Anthropic (~2026-06-15) y devuelve 404;
// verificado en vivo 2026-07-20 (AUD-01). claude-sonnet-5 es el reemplazo
// vigente (alias sin fecha). Ojo si se reusa en llamadas nuevas: Sonnet 5
// rechaza sampling params no-default (temperature/top_p) — ver claudeClient.
export const SONNET_MODEL = 'claude-sonnet-5';

// ─── Tareas de generación ─────────────────────────────────────────────────────

/**
 * Las tres tareas generativas del bot:
 *
 * - `conversational_turn`: el turno con personalidad e historial — hoy solo el
 *   saludo/acuse de GREETING (generateGreetingText). Es la única generativa
 *   donde la calidad NLU/voz justifica Sonnet.
 * - `micro_copy`: redactar UNA pieza corta con datos ya provistos (reformular
 *   una pregunta, la confirmación de cita, una side answer). Estructura fija,
 *   cero razonamiento → Haiku.
 * - `slot_presentation`: el presentador puro de horarios (S5-BOT-09) → Haiku.
 */
export type GenerationTask = 'conversational_turn' | 'micro_copy' | 'slot_presentation';

/**
 * Retorna el model ID de Anthropic apropiado para la tarea de generación.
 * Los call sites declaran QUÉ van a generar; el modelo se decide aquí.
 */
export function modelForTask(task: GenerationTask): string {
  return task === 'conversational_turn' ? SONNET_MODEL : HAIKU_MODEL;
}
