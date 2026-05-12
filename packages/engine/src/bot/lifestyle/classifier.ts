// ─── Lifestyle Bot — Intent Classifier ───────────────────────────────────────
// Clasifica la intención del usuario usando claude-haiku-4-5-20251001.
// Modelo: Haiku — nunca Sonnet ni Opus.
// Retorna SOLO JSON — si la respuesta no es JSON válido → UNCLEAR confidence 0.
//
// Historial: máximo 2 mensajes recientes para mantener costo bajo.
// Sin efectos secundarios — pure function sobre la API de Anthropic.

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_HAIKU_MS } from './claudeClient';
import type { LifestyleConversationMessage } from '../../types/lifestyle.types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type IntentType =
  | 'SELECT_OPTION'      // el cliente elige una opción del menú (servicio, staff, slot)
  | 'CONFIRM_YES'        // confirmación afirmativa (sí, dale, va, confirmo…)
  | 'CONFIRM_NO'         // negación / cancelación (no, mejor no, cancel…)
  | 'DATE_PREFERENCE'    // expresa fecha o turno (mañana, el viernes, por la tarde…)
  | 'NO_PREFERENCE'      // "cualquiera", "no importa", "el que sea"
  | 'SIDE_QUESTION'      // pregunta fuera del flujo (precio, dirección, duración…)
  | 'UNCLEAR';           // no se pudo clasificar con confianza suficiente

export type IntentClassification = {
  /** Tipo de intención detectada. */
  readonly intent:     IntentType;
  /**
   * Confianza entre 0.0 y 1.0.
   * ≥ 0.85 → ADVANCE  |  0.60-0.84 → CLARIFY  |  < 0.60 → REPEAT_OPTIONS
   */
  readonly confidence: number;
  /**
   * Valor extraído normalizado, dependiente del intent:
   * SELECT_OPTION   → texto de la opción o número ("1", "corte clásico")
   * DATE_PREFERENCE → expresión de fecha/turno ("viernes", "por la tarde")
   * SIDE_QUESTION   → la pregunta del cliente tal cual
   * demás           → null
   */
  readonly value:      string | null;
  /**
   * Respuesta generada por el clasificador a una SIDE_QUESTION.
   * Solo se llena cuando intent === 'SIDE_QUESTION' y hay respuesta posible
   * con la información del negocio. Null en todos los demás intents.
   */
  readonly side_question_answer: string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';
const MAX_HISTORY      = 2;

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Clasifica la intención del último mensaje del cliente en el contexto del flujo.
 *
 * @param params.userMessage   Texto del cliente a clasificar.
 * @param params.availableOptions Lista de opciones disponibles en este estado
 *   (servicios, nombres de staff, slots…). Puede estar vacía.
 * @param params.flowQuestion  La pregunta que el bot acaba de hacer al cliente.
 *   Ayuda al clasificador a entender el contexto esperado.
 * @param params.businessContext Información del negocio (nombre, servicios, etc.)
 *   para que el clasificador pueda responder side questions.
 * @param params.recentHistory Últimos mensajes de la conversación (máx 2).
 * @param params.anthropicKey  API key de Anthropic.
 */
export async function classifyIntent(params: {
  userMessage:     string;
  availableOptions: string[];
  flowQuestion:    string;
  businessContext: string;
  recentHistory:   LifestyleConversationMessage[];
  anthropicKey:    string;
}): Promise<IntentClassification> {
  const {
    userMessage,
    availableOptions,
    flowQuestion,
    businessContext,
    recentHistory,
    anthropicKey,
  } = params;

  const client = new Anthropic({ apiKey: anthropicKey || undefined });

  // Tomar solo los últimos MAX_HISTORY mensajes
  const history = recentHistory.slice(-MAX_HISTORY);

  const systemPrompt = buildClassifierSystemPrompt(
    availableOptions,
    flowQuestion,
    businessContext,
  );

  // Convertir historial a mensajes de Anthropic
  const historyMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  let rawResponse: string;

  try {
    const response = await callClaude({
      client,
      model:      CLASSIFIER_MODEL,
      maxTokens:  256,
      system:     systemPrompt,
      messages:   [
        ...historyMessages,
        { role: 'user', content: userMessage },
      ],
      timeoutMs:  TIMEOUT_HAIKU_MS,
      context:    { businessId: '', customerPhone: '', state: 'classifier' },
    });

    const firstBlock = response.content[0];
    rawResponse = firstBlock?.type === 'text' ? firstBlock.text.trim() : '';
  } catch {
    return unclearResult();
  }

  return parseClassifierResponse(rawResponse);
}

// ─── System prompt del clasificador ──────────────────────────────────────────

function buildClassifierSystemPrompt(
  availableOptions: string[],
  flowQuestion:     string,
  businessContext:  string,
): string {
  const optionsBlock =
    availableOptions.length > 0
      ? `Opciones disponibles actualmente:\n${availableOptions.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
      : 'No hay opciones numeradas en este paso.';

  return `Eres un clasificador de intenciones para un bot de agendamiento en WhatsApp.
Tu única función es analizar el mensaje del cliente y devolver un JSON estricto.

## Contexto del negocio
${businessContext}

## Pregunta actual del flujo
${flowQuestion}

## ${optionsBlock}

## Intenciones posibles
- SELECT_OPTION: el cliente elige una de las opciones disponibles (por número, nombre parcial o descripción)
- CONFIRM_YES: afirmación (sí, si, dale, va, claro, ok, confirmo, listo, perfecto, anótame, agendar, etc.)
- CONFIRM_NO: negación o cancelación (no, mejor no, cancel, cancelar, otro día, etc.)
- DATE_PREFERENCE: expresa preferencia de fecha o turno (hoy, mañana, el viernes, por la tarde, etc.)
- NO_PREFERENCE: no tiene preferencia (cualquiera, no importa, el que sea, quien sea, da igual, etc.)
- SIDE_QUESTION: pregunta fuera del flujo sobre el negocio (precio, dirección, horarios, duración, etc.)
- UNCLEAR: no se puede determinar la intención con suficiente confianza

## Reglas de clasificación
1. Si hay ambigüedad entre SELECT_OPTION y SIDE_QUESTION, prefiere SELECT_OPTION cuando hay opciones disponibles y el mensaje hace referencia a una de ellas.
2. Para SELECT_OPTION, extrae el valor normalizado: el nombre de la opción o el número ("1", "corte clásico").
3. Para DATE_PREFERENCE, extrae la expresión de fecha/turno tal como la dijo el cliente.
4. Para SIDE_QUESTION, genera una respuesta breve (máx 2 líneas) solo con información que tengas del negocio. Si no tienes la información, pon null en side_question_answer.
5. Errores ortográficos, abreviaciones y variantes de español mexicano son válidos ("si" = "sí", "ke" = "que", "xfa" = "por favor").
6. confidence debe reflejar tu certeza real — no infles el score.

## Formato de respuesta
Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown, sin explicaciones:
{
  "intent": "<IntentType>",
  "confidence": <número entre 0.0 y 1.0>,
  "value": "<string o null>",
  "side_question_answer": "<string o null>"
}`;
}

// ─── Parser de respuesta ──────────────────────────────────────────────────────

const VALID_INTENTS = new Set<string>([
  'SELECT_OPTION', 'CONFIRM_YES', 'CONFIRM_NO',
  'DATE_PREFERENCE', 'NO_PREFERENCE', 'SIDE_QUESTION', 'UNCLEAR',
]);

function parseClassifierResponse(raw: string): IntentClassification {
  try {
    // Extraer JSON aunque venga con texto adicional (defensa)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return unclearResult();

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const intent     = typeof parsed['intent']     === 'string' ? parsed['intent']     : 'UNCLEAR';
    const confidence = typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0;
    const value      = typeof parsed['value']      === 'string' ? parsed['value']      : null;
    const sqa        = typeof parsed['side_question_answer'] === 'string'
      ? parsed['side_question_answer']
      : null;

    if (!VALID_INTENTS.has(intent)) return unclearResult();

    // Clamp confidence a [0, 1]
    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    return {
      intent:               intent as IntentType,
      confidence:           clampedConfidence,
      value,
      side_question_answer: sqa,
    };
  } catch {
    return unclearResult();
  }
}

function unclearResult(): IntentClassification {
  return {
    intent:               'UNCLEAR',
    confidence:           0,
    value:                null,
    side_question_answer: null,
  };
}

// ─── Multi-intent classification ──────────────────────────────────────────────
// Extrae TODA la información relevante de un mensaje en una sola llamada.
// Usado en GREETING para saltar estados cuando el cliente da varios datos.

export type MultiIntentClassification = {
  serviceMatch?: { value: string; confidence: number };
  staffMatch?:   { value: string; confidence: number };
  dateMatch?:    { value: string; confidence: number };
  timeMatch?:    { value: string; shift?: 'morning' | 'afternoon'; confidence: number };
  sideQuestion?: { question: string; topic: 'price' | 'hours' | 'location' | 'duration' | 'other' };
  confirmYes?:   boolean;
  confirmNo?:    boolean;
  unclear?:      boolean;
};

/**
 * Clasifica múltiples intents simultáneos en un solo mensaje.
 * Usa Haiku para velocidad. Retorna todos los campos encontrados.
 *
 * @param params.userMessage   Texto del cliente.
 * @param params.services      Nombres de servicios del catálogo.
 * @param params.staff         Nombres de staff activo.
 * @param params.anthropicKey  API key de Anthropic.
 */
export async function classifyMultiIntent(params: {
  userMessage:  string;
  services:     string[];
  staff:        string[];
  anthropicKey: string;
}): Promise<MultiIntentClassification> {
  const { userMessage, services, staff, anthropicKey } = params;

  const client      = new Anthropic({ apiKey: anthropicKey || undefined });
  const systemPrompt = buildMultiIntentSystemPrompt(services, staff);

  let rawResponse: string;
  try {
    const response = await callClaude({
      client,
      model:      CLASSIFIER_MODEL,
      maxTokens:  300,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
      timeoutMs:  TIMEOUT_HAIKU_MS,
      context:    { businessId: '', customerPhone: '', state: 'multi_intent_classifier' },
    });
    const firstBlock = response.content[0];
    rawResponse = firstBlock?.type === 'text' ? firstBlock.text.trim() : '';
  } catch {
    return { unclear: true };
  }

  return parseMultiIntentResponse(rawResponse);
}

function buildMultiIntentSystemPrompt(services: string[], staff: string[]): string {
  const serviceList = services.length > 0 ? services.join(', ') : 'Sin servicios en catálogo';
  const staffList   = staff.length   > 0 ? staff.join(', ')    : 'Sin staff registrado';

  return `Eres un extractor de información para un bot de agendamiento en WhatsApp.
Tu única función es leer el mensaje del cliente y extraer TODA la información útil que aparezca.

Un mensaje puede contener servicio, staff, fecha y hora al mismo tiempo.
Extrae TODOS los campos que encuentres — no elijas uno, sácalos todos.

## Catálogo del negocio
Servicios: ${serviceList}
Staff disponible: ${staffList}

## Campos a extraer (incluye solo los que encuentres)
- serviceMatch: si menciona un servicio del catálogo (acepta nombre parcial o errores ortográficos)
- staffMatch: si menciona el nombre de algún miembro del staff
- dateMatch: si expresa fecha o día (hoy, mañana, el viernes, 23 de abril, etc.)
- timeMatch: si expresa hora o turno (a las 5, por la tarde, en la mañana, etc.)
- sideQuestion: si hace una pregunta sobre el negocio (precio, horario, dirección, duración)
- confirmYes: true si el mensaje es afirmación (sí, dale, ok, va, claro, listo, anótame)
- confirmNo: true si el mensaje es negación (no, mejor no, cancel, otro día)
- unclear: true si no contiene información útil alguna

## Reglas
1. Para serviceMatch y staffMatch, compara con el catálogo. Acepta variantes: "corte" → "Corte Clásico", "juanito" → "Juan García".
2. confidence entre 0.0 y 1.0 — refleja certeza real, no infles.
3. Omite los campos que no encuentres — no pongas null, simplemente no los incluyas en el JSON.
4. Si el mensaje tiene servicio + staff + fecha + hora, retorna los cuatro campos juntos.
5. Para sideQuestion, categoriza el tema: price (precio/costo/cuánto cuesta), hours (horario/cuándo abren), location (dirección/dónde queda/cómo llegar), duration (cuánto dura/tiempo del servicio), other (cualquier otra pregunta sobre el negocio).

Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown:
{
  "serviceMatch": { "value": "<nombre normalizado del catálogo>", "confidence": 0.0 },
  "staffMatch":   { "value": "<nombre normalizado del staff>",    "confidence": 0.0 },
  "dateMatch":    { "value": "<expresión tal como la dijo>",      "confidence": 0.0 },
  "timeMatch":    { "value": "<expresión tal como la dijo>", "shift": "morning|afternoon", "confidence": 0.0 },
  "sideQuestion": { "question": "<pregunta exacta del cliente>", "topic": "price|hours|location|duration|other" },
  "confirmYes":   true,
  "confirmNo":    true,
  "unclear":      true
}`;
}

function parseMultiIntentResponse(raw: string): MultiIntentClassification {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { unclear: true };

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const result: MultiIntentClassification = {};

    const sm = parsed['serviceMatch'];
    if (isMatchField(sm)) {
      result.serviceMatch = { value: sm.value, confidence: clampN(sm.confidence) };
    }

    const stm = parsed['staffMatch'];
    if (isMatchField(stm)) {
      result.staffMatch = { value: stm.value, confidence: clampN(stm.confidence) };
    }

    const dm = parsed['dateMatch'];
    if (isMatchField(dm)) {
      result.dateMatch = { value: dm.value, confidence: clampN(dm.confidence) };
    }

    const tm = parsed['timeMatch'];
    if (isMatchField(tm)) {
      const shift = (tm as Record<string, unknown>)['shift'];
      result.timeMatch = {
        value:      tm.value,
        confidence: clampN(tm.confidence),
        ...(shift === 'morning' || shift === 'afternoon' ? { shift } : {}),
      };
    }

    const sq = parsed['sideQuestion'];
    if (sq && typeof sq === 'object' && !Array.isArray(sq)) {
      const s = sq as Record<string, unknown>;
      const VALID_TOPICS = new Set(['price', 'hours', 'location', 'duration', 'other']);
      if (typeof s['question'] === 'string' && VALID_TOPICS.has(s['topic'] as string)) {
        result.sideQuestion = {
          question: s['question'],
          topic:    s['topic'] as 'price' | 'hours' | 'location' | 'duration' | 'other',
        };
      }
    }

    if (parsed['confirmYes'] === true) result.confirmYes = true;
    if (parsed['confirmNo']  === true) result.confirmNo  = true;
    if (parsed['unclear']    === true) result.unclear     = true;

    const hasContent =
      result.serviceMatch || result.staffMatch || result.dateMatch ||
      result.timeMatch    || result.sideQuestion ||
      result.confirmYes   || result.confirmNo;
    if (!hasContent) result.unclear = true;

    return result;
  } catch {
    return { unclear: true };
  }
}

type MatchField = { value: string; confidence: number };

function isMatchField(v: unknown): v is MatchField {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['value']      === 'string' &&
    typeof (v as Record<string, unknown>)['confidence'] === 'number'
  );
}

function clampN(n: number): number {
  return Math.max(0, Math.min(1, n));
}
