// ─── State: QUALIFYING_SERVICE ────────────────────────────────────────────────
// Presenta los servicios activos del negocio y espera que el cliente elija.
//
// Fast path (determinista):
//   - Número de opción o nombre parcial → resuelve sin llamar al clasificador.
// Slow path (clasificador):
//   - Texto ambiguo → classifyIntent() con Haiku.
//   - ADVANCE → extrae service_id del value, avanza estado.
//   - CLARIFY → pregunta específica de confirmación.
//   - REPEAT_OPTIONS → lista servicios numerados de nuevo.
//   - SideQuestion → responde y retoma con conector.

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_HAIKU_MS } from '../claudeClient';
import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { getCatalog } from '../catalog';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import {
  handleClassification,
  buildClarifyMessage,
  buildRepeatOptionsMessage,
  buildSideQuestionResponse,
  type ClarificationResult,
} from '../clarification';
import { buildSystemPrompt } from '../prompt';
import { buildBusinessContext } from '../businessContext';
import { answerSideQuestionDeterministic, isServiceOrPriceQuestion, refineTopic, closingForTopic } from '../sideQuestion';
import { isCancellationIntent } from '../cancelIntent';
import type { ServiceRow, LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const MAX_SERVICES_PER_MESSAGE = 4;
const FLOW_QUESTION = 'Que servicio te interesa?';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Intentos totales de clarificación antes de escalar a FALLBACK.
// Exportado para el test de relación de caps (S5-BOT-12).
export const MAX_TOTAL_ATTEMPTS = 5;

export async function handleQualifyingService(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase, anthropicKey } = deps;

  const allServices = await getCatalog(business.id, supabase);

  if (allServices.length === 0) {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: 'Por el momento no tenemos servicios disponibles. Por favor contáctanos directamente.',
    };
  }

  // ── Si el contexto trae candidatos ambiguos, filtrar a solo esos ──────────
  // El usuario ya vio la pregunta de desambiguación — resolver dentro del subconjunto.

  const services = context.ambiguous_service_candidates && context.ambiguous_service_candidates.length > 0
    ? allServices.filter((s) => context.ambiguous_service_candidates!.includes(s.id))
    : allServices;

  // ── Fast path: parseo determinista ────────────────────────────────────────

  const matches = findMatchingServices(msg.body, services);

  if (matches.length === 1) {
    return buildAdvanceResult(context, matches[0]!);
  }

  if (matches.length > 1) {
    return buildAmbiguousResult(context, matches);
  }

  // ── Fast path: servicio único (S4-BOT-09) ─────────────────────────────────
  // Con un solo servicio en catálogo no hay nada que elegir. Si el cliente no
  // está preguntando algo del negocio (precio/ubicación/horario/etc.), avanzar
  // directo. Esto rompe el bucle de "¿cuál servicio?" cuando el cliente dice
  // "sí" / "quiero una cita" sin nombrar el servicio (no matchea y el
  // clasificador no puede extraerlo). Las preguntas reales siguen al clasificador.
  // AUD-02: "cancelar mi cita" NO es intención de reserva — sin este guard, el
  // fast-path le respondía "Perfecto, [servicio]…" a quien quería cancelar.
  if (allServices.length === 1 && !looksLikeSideQuestion(msg.body) && !isCancellationIntent(msg.body)) {
    return buildAdvanceResult(context, allServices[0]!);
  }

  // ── Si había candidatos ambiguos y el input no matchea ninguno,
  //    expandir a catálogo completo antes de ir al clasificador ───────────────
  const servicesForClassifier = services.length < allServices.length ? allServices : services;

  // ── Slow path: clasificador ───────────────────────────────────────────────

  const displayServices = servicesForClassifier.slice(0, MAX_SERVICES_PER_MESSAGE);
  const optionNames     = displayServices.map((s) => s.name);

  const businessContext = buildBusinessContext(business, displayServices, {
    appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '',
  });
  const recentHistory   = (context.messages ?? []).slice(-2);
  const attempts        = context.clarification_attempts ?? 0;

  const classification = await deps.classifier.classifyIntent({
    userMessage:      msg.body,
    availableOptions: optionNames,
    flowQuestion:     FLOW_QUESTION,
    businessContext,
    recentHistory,
    anthropicKey,
  });

  // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
  logClassifierOutput({
    supabase,
    businessId:    business.id,
    customerPhone: msg.customerPhone,
    state:         'QUALIFYING_SERVICE',
    metadata:      buildSingleClassifierMetadata(classification, msg.body),
  });

  const clarResult = handleClassification({
    classification,
    currentState:          'QUALIFYING_SERVICE',
    context,
    availableOptions:      optionNames,
    clarificationAttempts: attempts,
  });

  // ── ADVANCE ───────────────────────────────────────────────────────────────

  if (clarResult.action === 'ADVANCE') {
    const valueMatches = classification.value
      ? findMatchingServices(classification.value, servicesForClassifier)
      : [];

    if (valueMatches.length === 1) {
      return buildAdvanceResult(clarResult.updatedContext, valueMatches[0]!);
    }

    if (valueMatches.length > 1) {
      return buildAmbiguousResult(clarResult.updatedContext, valueMatches);
    }

    // Si el clasificador dijo ADVANCE pero no podemos extraer el servicio,
    // caer a REPEAT_OPTIONS defensivamente
  }

  // ── SIDE QUESTION ─────────────────────────────────────────────────────────
  // GAP 2 (S4-BOT-07): si el clasificador detecta la pregunta con alta confianza
  // pero NO produjo respuesta (side_question_answer null), NO caer a CLARIFY.
  // Derivar deterministamente: plantilla/honesto por keyword o [DERIVA] al minisite.

  if (classification.intent === 'SIDE_QUESTION' && clarResult.action === 'CLARIFY') {
    const question = classification.value ?? msg.body;
    const answer = clarResult.prefixMessage
      ?? answerSideQuestionDeterministic(
        question,
        business,
        servicesForClassifier,
        { appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '' },
      );
    // Cierre adaptativo (S4-BOT-08):
    //   - Servicios/precio (Nivel 1): anexa el menú numerado = continuación natural.
    //   - Resto (logística Nivel 2 / salida útil Nivel 3): SOLO el dato/salida,
    //     sin empuje de agenda. El cierre lo define el nivel del topic, no un
    //     "¿Te gustaría agendar?" genérico cosido al final.
    let responseText: string;
    if (isServiceOrPriceQuestion(question)) {
      responseText = buildSideQuestionResponse(answer, buildFlowQuestion(servicesForClassifier));
    } else {
      const closing = closingForTopic(refineTopic('other', question));
      responseText = closing ? `${answer}\n${closing}` : answer;
    }
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   clarResult.updatedContext,
      responseText,
    };
  }

  // ── CLARIFY ───────────────────────────────────────────────────────────────

  if (clarResult.action === 'CLARIFY') {
    const responseText = buildClarifyMessage(msg.body, optionNames, FLOW_QUESTION);
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   clarResult.updatedContext,
      responseText,
    };
  }

  // ── REPEAT_OPTIONS (también fallback para ADVANCE sin resolve) ────────────
  // Si se superó MAX_TOTAL_ATTEMPTS → escalar a FALLBACK con agente humano.
  // Anti-loop (S4-BOT-09): un ADVANCE que no resolvió servicio dejó
  // clarification_attempts en 0; repeatFallbackContext restaura el incremento
  // para que el escape a FALLBACK sea alcanzable y no haya bucle infinito.

  const fallbackCtx = repeatFallbackContext(clarResult, attempts);

  if ((fallbackCtx.clarification_attempts ?? 0) >= MAX_TOTAL_ATTEMPTS) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context, clarification_attempts: 0 },
      responseText: 'Parece que no estamos conectando. Dejame pasarte con alguien del equipo para ayudarte mejor.',
    };
  }

  const fallbackText = buildRepeatOptionsMessage(
    buildServiceOptions(displayServices, servicesForClassifier.length > MAX_SERVICES_PER_MESSAGE),
    FLOW_QUESTION,
  );
  const responseText = await generateRepeatQuestion(
    anthropicKey,
    buildSystemPrompt(business, undefined, servicesForClassifier),
    'los servicios disponibles para agendar',
    fallbackText,
  );

  return {
    newState:     'QUALIFYING_SERVICE',
    newContext:   fallbackCtx,
    responseText,
  };
}

// ─── Anti-loop (S4-BOT-09) ────────────────────────────────────────────────────

/**
 * Contexto a persistir en el camino REPEAT_OPTIONS. Cuando se llega aquí vía un
 * ADVANCE de alta confianza que NO pudo resolverse a un servicio (ej. el cliente
 * dijo "sí"/"no" y el clasificador no extrajo un servicio), handleClassification
 * ya reseteó clarification_attempts a 0. Si dejáramos ese 0, el guard de
 * MAX_TOTAL_ATTEMPTS nunca dispararía → bucle infinito sin escalar a un humano.
 * Restauramos el incremento sobre los intentos previos para mantener el escape a
 * FALLBACK alcanzable. En el REPEAT_OPTIONS normal (baja confianza) el contador
 * ya viene incrementado por handleClassification, así que se respeta tal cual.
 */
export function repeatFallbackContext(
  clarResult:    ClarificationResult,
  priorAttempts: number,
): LifestyleBotContext {
  if (clarResult.action === 'ADVANCE') {
    return { ...clarResult.updatedContext, clarification_attempts: priorAttempts + 1 };
  }
  return clarResult.updatedContext;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAdvanceResult(
  context:  LifestyleBotContext,
  service:  ServiceRow,
): StateHandlerResult {
  const newContext: LifestyleBotContext = {
    ...context,
    serviceId:                    service.id,
    ambiguous_service_candidates: undefined,
    clarification_attempts:       0,
    last_side_question:           null,
  };
  return {
    newState:     'QUALIFYING_STAFF',
    newContext,
    responseText: `Perfecto, ${service.name}. Tienes algun barbero de preferencia o te asignamos uno disponible?`,
  };
}

function buildAmbiguousResult(
  context:    LifestyleBotContext,
  candidates: ServiceRow[],
): StateHandlerResult {
  const lines = candidates.map(
    (s) => `${s.name} ($${formatPrice(s.price)} ${s.currency}, ${s.duration_minutes} min)`,
  );
  const question =
    `Tenemos ${lines.join(' y ')}. Cual te interesa?`;
  return {
    newState: 'QUALIFYING_SERVICE',
    newContext: {
      ...context,
      ambiguous_service_candidates: candidates.map((s) => s.id),
      clarification_attempts:       0,
    },
    responseText: question,
  };
}

function buildServiceOptions(displayServices: ServiceRow[], hasMore: boolean): string[] {
  const opts = displayServices.map(
    (s) => `${s.name} — ${s.duration_minutes} min — $${formatPrice(s.price)} ${s.currency}`,
  );
  if (hasMore) opts.push('Ver más servicios');
  return opts;
}

function buildFlowQuestion(services: ServiceRow[]): string {
  const displayServices = services.slice(0, MAX_SERVICES_PER_MESSAGE);
  const lines = buildServiceOptions(displayServices, services.length > MAX_SERVICES_PER_MESSAGE);
  return `${FLOW_QUESTION}\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
}

/**
 * Retorna TODOS los servicios que coinciden con el input (parcial case-insensitive).
 * - Número de opción → array con ese servicio
 * - Nombre exacto → array con ese servicio
 * - Coincidencia parcial → puede retornar 2+ (caso ambiguo)
 * - Sin match → []
 */
function findMatchingServices(
  input: string,
  services: ServiceRow[],
): ServiceRow[] {
  const trimmed = input.trim();

  // Por número
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= services.length) {
    const s = services[num - 1];
    return s ? [s] : [];
  }

  const lower = trimmed.toLowerCase();

  // Nombre exacto → siempre único
  const exact = services.find((s) => s.name.toLowerCase() === lower);
  if (exact) return [exact];

  // Parcial: todos los servicios cuyo nombre contiene el input
  const byNameContains = services.filter((s) => s.name.toLowerCase().includes(lower));
  if (byNameContains.length > 0) return byNameContains;

  // Parcial inverso: el input contiene el nombre del servicio
  const byInputContains = services.filter((s) => lower.includes(s.name.toLowerCase()));
  if (byInputContains.length > 0) return byInputContains;

  return [];
}

function formatPrice(price: number): string {
  return price.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Pistas de logística/info del negocio que NO cubre isServiceOrPriceQuestion
// (ubicación, horario, pago, estacionamiento, niños, reseñas). Sin acentos.
const SIDE_Q_HINTS = [
  'donde', 'direccion', 'ubicacion', 'mapa', 'como llego',
  'horario', 'horarios', 'abren', 'cierran', 'abierto', 'cuando', 'dura', 'duracion',
  'pago', 'pagar', 'tarjeta', 'efectivo', 'transferencia',
  'estacionamiento', 'parking', 'valet', 'cochera',
  'nino', 'ninos', 'infantil', 'hijo',
  'resena', 'resenas', 'opinion', 'review', 'reviews',
];

/**
 * Detector determinista: ¿el mensaje parece una pregunta sobre el negocio?
 * Usado por el fast-path de servicio único para NO auto-resolver cuando el
 * cliente en realidad está preguntando algo (precio/ubicación/horario/etc.) —
 * esas siguen al clasificador para responderse como side-question. Una
 * afirmación o intención de reserva ("sí", "quiero una cita") retorna false.
 */
export function looksLikeSideQuestion(text: string): boolean {
  if (/[?¿]/.test(text)) return true;
  if (isServiceOrPriceQuestion(text)) return true;
  const q = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return SIDE_Q_HINTS.some((kw) => q.includes(kw));
}

async function generateRepeatQuestion(
  anthropicKey: string,
  system: string,
  stateContext: string,
  fallback: string,
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const resp = await callClaude({
      client,
      model:     HAIKU_MODEL,
      maxTokens: 120,
      system:    [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages:  [{
        role:    'user',
        content: `El usuario no entendió la pregunta anterior sobre ${stateContext}. Reformula la pregunta de forma diferente y más clara. No uses el mismo texto. Máximo 2 líneas.`,
      }],
      timeoutMs: TIMEOUT_HAIKU_MS,
      context:   { businessId: '', customerPhone: '', state: 'QUALIFYING_SERVICE' },
    });
    const block = resp.content[0];
    return block?.type === 'text' ? block.text.trim() : fallback;
  } catch {
    return `Perdona, te pregunto de otra forma: ${fallback}`;
  }
}
