// ─── State: QUALIFYING_STAFF ──────────────────────────────────────────────────
// Pregunta si el cliente tiene barbero de preferencia.
//
// Fast path (determinista):
//   - 1 staff activo → salta con autoAssign.
//   - Nombre parcial / "cualquiera" → resuelve directamente.
// Slow path (clasificador):
//   - Texto ambiguo → classifyIntent() con Haiku.
//   - SELECT_OPTION → extrae nombre del value, avanza estado.
//   - NO_PREFERENCE → autoAssign = true, avanza estado.
//   - SIDE_QUESTION → responde y retoma con conector.
//   - CLARIFY / REPEAT_OPTIONS → lista de barberos.

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_HAIKU_MS } from '../claudeClient';
import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { getStaffForService } from '../catalog';
import { logClassifierOutput, buildSingleClassifierMetadata } from '../classifierLog';
import {
  handleClassification,
  buildClarifyMessage,
  buildRepeatOptionsMessage,
  buildSideQuestionResponse,
} from '../clarification';
import { buildMicroCopySystemPrompt } from '../prompt';
import { detectsServiceCorrection } from '../utils';
import { isAvailabilityQuestion } from '../availabilityIntent';
import { wantsToChooseStaff, asksWhoOnly } from '../staffAxisIntent';
import { parseDate } from './qualifyingDatetime';
import { getTodayStr } from '../tzUtils';
import { NO_PREFERENCE_KEYWORDS } from '../interpreter';
import type { StaffRow, LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';
import { ESCALATION_TO_TEAM_MESSAGE, SERVICE_QUESTION_RESET, DATE_QUESTION_MESSAGE, TECHNICAL_HICCUP_MESSAGE, dayLabelFromDateStr } from '../copy';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Intentos totales de clarificación antes de escalar a FALLBACK.
// Exportado para el test de relación de caps (S5-BOT-12).
export const MAX_TOTAL_ATTEMPTS = 5;

// NO_PREFERENCE_KEYWORDS se movió a interpreter.ts (R4.2): fuente ÚNICA compartida
// con confirmingAppointment. El saneo S5-BOT-04 (sin 'disponible'/'libre' sueltos)
// vive allá. Aquí solo se usa como fallback del estrangulamiento.

const FLOW_QUESTION = '¿Con quién te gustaría agendar?';

export async function handleQualifyingStaff(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase, anthropicKey } = deps;

  // ── Corrección de servicio mid-flow ──────────────────────────────────────

  if (detectsServiceCorrection(msg.body.trim().toLowerCase())) {
    return {
      newState: 'QUALIFYING_SERVICE',
      newContext: {
        ...context,
        serviceId:                    undefined,
        staffId:                      undefined,
        requestedStaffId:             undefined,
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
      },
      responseText: SERVICE_QUESTION_RESET,
    };
  }

  if (!context.serviceId) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: '¿Qué servicio te interesa?',
    };
  }

  const activeStaff = await getStaffForService(business.id, context.serviceId, supabase);

  // Si el staffId pre-llenado (desde greeting / favoritos) ya no está activo para
  // este servicio, limpiar para evitar avanzar con un staffId inválido.
  const effectiveContext: LifestyleBotContext =
    context.staffId && !activeStaff.some((s) => s.id === context.staffId)
      ? { ...context, staffId: undefined, autoAssign: undefined }
      : context;

  // S5-BOT-04: ¿el cliente quiere elegir barbero (eje a) o pregunta quién lo
  // atiende (eje b)? El eje-barbero debe GANAR a isAvailabilityQuestion para el
  // caso mixto "¿qué barbero está disponible para las 12?" (hora+barbero) → va
  // al eje barbero, no a slots-por-hora.
  const wantsStaffAxis = wantsToChooseStaff(msg.body) || asksWhoOnly(msg.body);

  // ── FASE B: pregunta de disponibilidad → ofrecer slots (sin seguir preguntando) ──
  // Si el cliente pregunta "¿qué horario hay mañana?" / "¿a qué hora tienes?",
  // no insistir en elegir barbero: asignar "el que sea" (autoAssign) y mostrar
  // slots reales. Si trae fecha la usamos; si no, partimos de hoy y SHOWING_SLOTS
  // ofrecera las alternativas mas cercanas.
  if (isAvailabilityQuestion(msg.body) && !wantsStaffAxis) {
    const bodyLower     = msg.body.trim().toLowerCase();
    const parsed        = parseDate(bodyLower, msg.timestamp, business.timezone);
    const requestedDate = effectiveContext.requestedDate ?? parsed ?? getTodayStr(business.timezone);
    const newContext: LifestyleBotContext = {
      ...effectiveContext,
      autoAssign:             true,
      staffId:                undefined,
      requestedDate,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
  }

  // Si solo hay un barbero activo para este servicio: saltar con autoAssign
  if (activeStaff.length <= 1) {
    const newContext: LifestyleBotContext = {
      ...effectiveContext,
      staffId:                activeStaff[0]?.id,
      autoAssign:             activeStaff.length === 0,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    // Si ya tenemos fecha (pre-filled desde greeting), saltar directo a slots
    if (effectiveContext.requestedDate) {
      return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
    }
    return {
      newState:     'QUALIFYING_DATETIME',
      newContext,
      responseText: buildDatetimeQuestion(),
    };
  }

  // ── S5-BOT-04: eje-barbero → presentar POR barbero (presentBy:'staff') ──────
  // Eje (a) "qué barberos hay" / "puedo elegir" y eje (b) "¿con quién?" se
  // tratan igual en A1: en vez de auto-asignar mudo, mostrar los slots SIN
  // suprimir el nombre del barbero. La respuesta híbrida fina (eje b) es A2.
  // Va ANTES de NO_PREFERENCE para que "¿qué barbero está disponible?" no se
  // lea como "el que sea". Multi-barbero (activeStaff.length > 1 garantizado
  // por el shortcut de arriba).
  if (wantsStaffAxis) {
    const bodyLower     = msg.body.trim().toLowerCase();
    const parsed        = parseDate(bodyLower, msg.timestamp, business.timezone);
    const requestedDate = effectiveContext.requestedDate ?? parsed ?? getTodayStr(business.timezone);
    const newContext: LifestyleBotContext = {
      ...effectiveContext,
      autoAssign:             true,
      staffId:                undefined,
      presentBy:              'staff',
      requestedDate,
      clarification_attempts: 0,
      last_side_question:     null,
    };
    return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
  }

  // ── Fast path: parseo determinista ────────────────────────────────────────

  const lower = msg.body.trim().toLowerCase();

  // ¿No tiene preferencia? (R4.2) Consume interpretation.noPreference (computado
  // 1×/turno en dispatch); fallback al keyword-match local si dispatch no inyectó
  // interpretation (tests directos) — estrangulamiento R4.1. SIN guard de turno:
  // qualifyingStaff aún no mostró slots, así que "cualquiera" es no-preferencia de
  // barbero (a diferencia de confirming). Preserva el comportamiento previo.
  const noPref = deps.interpretation
    ? deps.interpretation.noPreference
    : NO_PREFERENCE_KEYWORDS.some((kw) => lower.includes(kw));
  if (noPref) {
    return buildAutoAssignResult(effectiveContext);
  }

  // ¿Mencionó un nombre específico?
  const matched = resolveStaff(msg.body, activeStaff);
  if (matched) {
    return buildStaffSelectedResult(effectiveContext, matched);
  }

  // ── Slow path: clasificador ───────────────────────────────────────────────

  const staffNames      = activeStaff.map((s) => s.name);
  const businessContext = `Negocio: ${business.name}\nBarberos disponibles: ${staffNames.join(', ')}`;
  const recentHistory   = (effectiveContext.messages ?? []).slice(-2);
  const attempts        = effectiveContext.clarification_attempts ?? 0;

  const classification = await deps.classifier.classifyIntent({
    userMessage:      msg.body,
    availableOptions: staffNames,
    flowQuestion:     FLOW_QUESTION,
    businessContext,
    recentHistory,
    anthropicKey,
    businessId:    business.id,
    customerPhone: msg.customerPhone,
  });

  // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
  logClassifierOutput({
    supabase,
    businessId:    business.id,
    customerPhone: msg.customerPhone,
    state:         'QUALIFYING_STAFF',
    metadata:      buildSingleClassifierMetadata(classification, msg.body),
  });

  const clarResult = handleClassification({
    classification,
    currentState:          'QUALIFYING_STAFF',
    context:               effectiveContext,
    availableOptions:      staffNames,
    clarificationAttempts: attempts,
  });

  // ── Fallo técnico del clasificador (AUD-07b): honesto y sin gastar intentos ──
  if (clarResult.action === 'TECH_ISSUE') {
    return {
      newState:     'QUALIFYING_STAFF',
      newContext:   clarResult.updatedContext,
      responseText: TECHNICAL_HICCUP_MESSAGE,
    };
  }

  // ── Fecha dicha al elegir barbero (deuda #1): persistir, no tirar ──────────
  // "mejor el jueves" mientras se pregunta el barbero ya no se pierde: se
  // guarda la fecha y se retoma la pregunta — la matriz de correcciones deja
  // de ser asimétrica (el servicio ya se corregía en todos los estados).
  if (clarResult.action === 'DATE_HINT') {
    const hintedDate = deps.interpretation?.date ?? null;
    if (hintedDate) {
      return {
        newState:     'QUALIFYING_STAFF',
        newContext:   { ...clarResult.updatedContext, requestedDate: hintedDate },
        responseText: `Va, ${dayLabelFromDateStr(hintedDate)}. ¿Con quién te gustaría agendar?`,
      };
    }
  }

  // ── NO_PREFERENCE via clasificador ────────────────────────────────────────

  if (clarResult.action === 'ADVANCE' && classification.intent === 'NO_PREFERENCE') {
    return buildAutoAssignResult(clarResult.updatedContext);
  }

  // ── SELECT_OPTION via clasificador ────────────────────────────────────────

  if (clarResult.action === 'ADVANCE') {
    const valueResolved = classification.value
      ? resolveStaff(classification.value, activeStaff)
      : null;

    if (valueResolved) {
      return buildStaffSelectedResult(clarResult.updatedContext, valueResolved);
    }

    // Si ADVANCE pero no podemos extraer el staff, caer a REPEAT_OPTIONS
  }

  // ── SIDE QUESTION ─────────────────────────────────────────────────────────

  if (classification.intent === 'SIDE_QUESTION' && clarResult.prefixMessage) {
    const flowQ        = buildStaffQuestion(activeStaff, effectiveContext.staffId);
    const responseText = buildSideQuestionResponse(clarResult.prefixMessage, flowQ);
    return {
      newState:     'QUALIFYING_STAFF',
      newContext:   clarResult.updatedContext,
      responseText,
    };
  }

  // ── CLARIFY ───────────────────────────────────────────────────────────────

  if (clarResult.action === 'CLARIFY') {
    const responseText = buildClarifyMessage(msg.body, staffNames, FLOW_QUESTION);
    return {
      newState:     'QUALIFYING_STAFF',
      newContext:   clarResult.updatedContext,
      responseText,
    };
  }

  // ── REPEAT_OPTIONS ────────────────────────────────────────────────────────
  // Si se superó MAX_TOTAL_ATTEMPTS → escalar a FALLBACK con agente humano.

  if ((clarResult.updatedContext.clarification_attempts ?? 0) >= MAX_TOTAL_ATTEMPTS) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...effectiveContext, clarification_attempts: 0 },
      responseText: ESCALATION_TO_TEAM_MESSAGE,
    };
  }

  const fallbackText = buildRepeatOptionsMessage(
    [...staffNames, 'Cualquiera / no tengo preferencia'],
    FLOW_QUESTION,
  );
  const prevBotMessage = [...(context.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.content ?? null;
  const responseText = await generateRepeatQuestion(
    anthropicKey,
    // System corto: esta llamada solo reformula una pregunta — el system
    // completo de 7 pasos era ruido (y ~5x el costo de input).
    buildMicroCopySystemPrompt(business),
    'el barbero de preferencia del cliente',
    fallbackText,
    prevBotMessage,
  );

  return {
    newState:     'QUALIFYING_STAFF',
    newContext:   clarResult.updatedContext,
    responseText,
  };
}

// ─── Builders de resultado ────────────────────────────────────────────────────

function buildAutoAssignResult(context: LifestyleBotContext): StateHandlerResult {
  // "Cualquiera" borra la intención de barbero: requestedStaffId no sobrevive
  // a un auto-assign explícito (S5-BOT-10).
  const newContext: LifestyleBotContext = {
    ...context,
    autoAssign:             true,
    staffId:                undefined,
    requestedStaffId:       undefined,
    clarification_attempts: 0,
    last_side_question:     null,
  };
  // Si ya tenemos fecha (pre-filled desde greeting), saltar directo a slots
  if (context.requestedDate) {
    return { newState: 'SHOWING_SLOTS', newContext, responseText: '' };
  }
  return {
    newState:     'QUALIFYING_DATETIME',
    newContext,
    responseText: buildDatetimeQuestion(),
  };
}

function buildStaffSelectedResult(
  context: LifestyleBotContext,
  staff:   StaffRow,
): StateHandlerResult {
  const newContext: LifestyleBotContext = {
    ...context,
    staffId:                staff.id,
    requestedStaffId:       staff.id,
    autoAssign:             false,
    clarification_attempts: 0,
    last_side_question:     null,
  };
  // Si ya tenemos fecha (pre-filled desde greeting), saltar directo a slots
  if (context.requestedDate) {
    return { newState: 'SHOWING_SLOTS', newContext, responseText: `Con ${staff.name}, perfecto.` };
  }
  return {
    newState:     'QUALIFYING_DATETIME',
    newContext,
    responseText: `Con ${staff.name}, perfecto. ${buildDatetimeQuestion()}`,
  };
}

// ─── Generación de preguntas ──────────────────────────────────────────────────

function buildStaffQuestion(activeStaff: StaffRow[], favStaffId: string | undefined): string {
  const staffList = activeStaff.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

  if (favStaffId) {
    const fav = activeStaff.find((s) => s.id === favStaffId);
    if (fav) {
      return `¿Con ${fav.name} como la vez anterior, o prefieres otro?\n\n${staffList}\n\nO escribe "cualquiera" si da igual.`;
    }
  }

  return `${FLOW_QUESTION}\n\n${staffList}\n\nO escribe "cualquiera" si no tienes preferencia.`;
}

function buildDatetimeQuestion(): string {
  return DATE_QUESTION_MESSAGE;
}

// ─── Búsqueda flexible de staff ───────────────────────────────────────────────

/**
 * Busca un staff por nombre de forma flexible.
 * Acepta nombre completo, nombre parcial, tokens individuales.
 */
function resolveStaff(input: string, staff: StaffRow[]): StaffRow | null {
  const lower = input.trim().toLowerCase();

  const exact = staff.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;

  const contained = staff.find((s) => lower.includes(s.name.toLowerCase()));
  if (contained) return contained;

  // Primera palabra del nombre del staff en el input (ej: "Carlos" de "Carlos Mendez")
  const firstNameMatch = staff.find((s) => {
    const firstName = s.name.split(' ')[0]?.toLowerCase() ?? '';
    return firstName.length > 2 && lower.includes(firstName);
  });
  if (firstNameMatch) return firstNameMatch;

  return null;
}

async function generateRepeatQuestion(
  anthropicKey: string,
  system: string,
  stateContext: string,
  fallback: string,
  previousBotMessage: string | null,
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: anthropicKey || undefined });
    const resp = await callClaude({
      client,
      model:     HAIKU_MODEL,
      maxTokens: 120,
      system,
      messages:  [{
        role:    'user',
        // AUD-07d: sin el texto anterior, "no uses el mismo texto" era
        // inverificable para el modelo — podía regenerar casi lo mismo.
        content: previousBotMessage
          ? `El usuario no entendió tu pregunta anterior sobre ${stateContext}. Tu mensaje anterior fue: "${previousBotMessage}". Reformúlala con OTRAS palabras, más clara. Máximo 2 líneas.`
          : `El usuario no entendió la pregunta anterior sobre ${stateContext}. Reformula la pregunta de forma diferente y más clara. No uses el mismo texto. Máximo 2 líneas.`,
      }],
      timeoutMs: TIMEOUT_HAIKU_MS,
      context:   { businessId: '', customerPhone: '', state: 'QUALIFYING_STAFF' },
    });
    const block = resp.content[0];
    return block?.type === 'text' ? block.text.trim() : fallback;
  } catch {
    return `Perdona, te pregunto de otra forma: ${fallback}`;
  }
}
