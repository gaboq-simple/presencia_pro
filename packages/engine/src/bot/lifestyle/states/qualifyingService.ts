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
import { classifyIntent } from '../classifier';
import {
  handleClassification,
  buildClarifyMessage,
  buildRepeatOptionsMessage,
  buildSideQuestionResponse,
} from '../clarification';
import { buildSystemPrompt } from '../prompt';
import { buildBusinessContext } from '../businessContext';
import { answerSideQuestionDeterministic, isServiceOrPriceQuestion } from '../sideQuestion';
import type { ServiceRow, LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

const MAX_SERVICES_PER_MESSAGE = 4;
const FLOW_QUESTION = 'Que servicio te interesa?';
// Retorno natural y consistente tras una side-question NO relacionada a servicios/precio.
// No anexa el menú (la lista satura respuestas de ubicación/horario/pago/etc.).
const RETURN_TO_BOOKING = 'Te gustaria agendar una cita?';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

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

  const classification = await classifyIntent({
    userMessage:      msg.body,
    availableOptions: optionNames,
    flowQuestion:     FLOW_QUESTION,
    businessContext,
    recentHistory,
    anthropicKey,
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
    // Solo anexa el menú de servicios cuando es pertinente (servicios/precio).
    // Para ubicación/horario/pago/niños/etc. usa un retorno simple sin lista.
    const flowQuestion = isServiceOrPriceQuestion(question)
      ? buildFlowQuestion(servicesForClassifier)
      : RETURN_TO_BOOKING;
    const responseText = buildSideQuestionResponse(answer, flowQuestion);
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

  const MAX_TOTAL_ATTEMPTS = 5;
  if ((clarResult.updatedContext.clarification_attempts ?? 0) >= MAX_TOTAL_ATTEMPTS) {
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
    newContext:   clarResult.updatedContext,
    responseText,
  };
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
