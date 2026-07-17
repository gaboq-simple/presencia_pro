// ─── State: GREETING ──────────────────────────────────────────────────────────
// Saluda al cliente y realiza el RETURNING_CHECK interno.
//
// RETURNING_CHECK (no es un estado externo):
//   1. Busca customers WHERE business_id = $1 AND phone = $2
//   2. Si existe: carga customerId, favoritos y last_visit en el contexto
//      → saluda por nombre (reconocimiento sutil)
//   3. Si no existe: crea registro mínimo con phone y name del perfil WA
//      → saluda genéricamente con nombre del negocio
//
// MULTI-INTENT CLASSIFICATION:
//   Antes de generar el saludo, clasifica el primer mensaje del cliente.
//   Si detecta servicio + staff + fecha → va directo a SHOWING_SLOTS.
//   Si detecta servicio + staff → QUALIFYING_DATETIME.
//   Si detecta servicio + fecha → QUALIFYING_STAFF (con fecha pre-filled).
//   Si detecta solo servicio → QUALIFYING_STAFF.
//   Si no detecta nada → QUALIFYING_SERVICE (saludo genérico).

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_SONNET_MS } from '../claudeClient';
import type { LifestyleBotContext, LifestyleBotState } from '../../../types/lifestyle.types';
import { buildSystemPrompt } from '../prompt';
import { tenantDb } from '../../../tenantDb';
import { logBot, maskPhone } from '../../../utils/logger';
import type { MultiIntentClassification } from '../types';
import {
  logClassifierOutput,
  buildSingleClassifierMetadata,
  buildMultiClassifierMetadata,
} from '../classifierLog';
import { buildBusinessContext } from '../businessContext';
import { routeSideQuestion, derivaFallback, composeGreetingSideAnswer, refineTopic, closingForTopic } from '../sideQuestion';
import { getCatalog, getActiveStaff } from '../catalog';
import { parseDate, resolveInterpretedTime, applyTimeRes } from './qualifyingDatetime';
import { formatTimeHuman } from '../utils';
import { buildDefaultGreetingPlan, buildGenerativeMessages, type ConvTurn } from '../continuity';
import type { LifestyleIncomingMessage, ServiceRow, StaffRow, StateHandlerDeps, StateHandlerResult } from '../types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.80;

// ─── Tipos DB ─────────────────────────────────────────────────────────────────

type CustomerRow = {
  id: string;
  name: string;
  favorite_staff_id: string | null;
  favorite_service_id: string | null;
  last_visit: string | null;
  favorite_staff: { name: string } | null;
  favorite_service: { name: string } | null;
};

// ─── Caso de saludo ───────────────────────────────────────────────────────────

type GreetCase = 'none' | 'service_only' | 'service_date' | 'service_date_time' | 'service_staff' | 'full';

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleGreeting(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase, anthropicKey } = deps;

  // Historial reciente de la conversación (lo gestiona handler.ts). Si NO está
  // vacío, la conversación ya está en curso → el generador no debe re-saludar.
  const history: ConvTurn[] = (context.messages ?? []) as ConvTurn[];

  // ── RETURNING_CHECK ────────────────────────────────────────────────────────

  let customerId: string;
  let customerName: string;
  let isReturning = false;
  let favoriteStaffId: string | null    = null;
  let favoriteServiceId: string | null  = null;
  let favStaffName: string | null       = null;
  let favServiceName: string | null     = null;

  const { data: existing } = await tenantDb(supabase, business.id)
    .table('customers')
    .select('id, name, favorite_staff_id, favorite_service_id, last_visit, favorite_staff:favorite_staff_id(name), favorite_service:favorite_service_id(name)')
    .eq('phone', msg.customerPhone)
    .maybeSingle();

  if (existing) {
    const row         = existing as unknown as CustomerRow;
    customerId        = row.id;
    customerName      = row.name;
    favoriteStaffId   = row.favorite_staff_id;
    favoriteServiceId = row.favorite_service_id;
    favStaffName      = row.favorite_staff?.name ?? null;
    favServiceName    = row.favorite_service?.name ?? null;
    isReturning       = true;
  } else {
    const nameToSave = msg.customerName ?? 'Cliente';
    const { data: inserted, error } = await tenantDb(supabase, business.id)
      .table('customers')
      .insert({
        phone:              msg.customerPhone,
        name:               nameToSave,
        consent_at:         new Date().toISOString(),
        consented_via:      'whatsapp_first_message',
        consent_message_id: msg.messageId ?? null,
      })
      .select('id')
      .single();

    if (!error && inserted) {
      customerId   = (inserted as { id: string }).id;
      customerName = nameToSave;
    } else {
      // El fallo más común de este INSERT es una carrera en UNIQUE(business_id,
      // phone): un mensaje concurrente ya creó al cliente y el SELECT inicial no
      // lo vio. Re-consultar recupera la liga sin cambiar el flujo. Antes se
      // tragaba el fallo (customerId = '') → una cita agendada después en esta
      // conversación quedaba SIN liga al cliente, en silencio.
      const { data: recovered } = await tenantDb(supabase, business.id)
        .table('customers')
        .select('id, name')
        .eq('phone', msg.customerPhone)
        .maybeSingle();

      if (recovered) {
        const rec    = recovered as { id: string; name: string };
        customerId   = rec.id;
        customerName = rec.name ?? nameToSave;
      } else {
        // Fallo genuino (no carrera): no se pudo crear ni recuperar el cliente.
        // customerId queda vacío, pero el fallo se registra RUIDOSO (no mudo) para
        // que sea observable — nunca una liga perdida en silencio.
        customerId   = '';
        customerName = nameToSave;
        console.error(JSON.stringify({
          ts:             new Date().toISOString(),
          service:        'bot',
          event:          'customer_create_failed',
          business_id:    business.id,
          customer_phone: maskPhone(msg.customerPhone),
          error:          error?.message ?? 'unknown',
        }));
      }
    }
  }

  // ── Cargar catálogo + staff en paralelo ────────────────────────────────────

  const [services, allStaff] = await Promise.all([
    getCatalog(business.id, supabase),
    getActiveStaff(business.id, supabase),
  ]);

  // ── Multi-intent classification ────────────────────────────────────────────

  let multi: MultiIntentClassification = { unclear: true };
  if (services.length > 0) {
    multi = await deps.classifier.classifyMultiIntent({
      userMessage:  msg.body,
      services:     services.map((s) => s.name),
      staff:        allStaff.map((s) => s.name),
      anthropicKey,
    }).catch(() => ({ unclear: true } as MultiIntentClassification));

    // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
    logClassifierOutput({
      supabase,
      businessId:    business.id,
      customerPhone: msg.customerPhone,
      state:         'GREETING',
      metadata:      buildMultiClassifierMetadata(multi, msg.body),
    });
  }

  // ── Resolver entidades detectadas ──────────────────────────────────────────

  const serviceMatchValue = (multi.serviceMatch?.confidence ?? 0) >= CONFIDENCE_THRESHOLD
    ? multi.serviceMatch!.value
    : null;
  const serviceMatches    = serviceMatchValue ? findServicesFromValue(serviceMatchValue, services) : [];
  let resolvedService     = serviceMatches.length === 1 ? serviceMatches[0]! : null;
  const ambiguousServices = serviceMatches.length > 1 ? serviceMatches : [];

  const resolvedStaff = (multi.staffMatch?.confidence ?? 0) >= CONFIDENCE_THRESHOLD
    ? resolveStaffFromValue(multi.staffMatch!.value, allStaff)
    : null;

  const dateExpr  = (multi.dateMatch?.confidence ?? 0) >= CONFIDENCE_THRESHOLD
    ? multi.dateMatch!.value
    : null;
  const parsedDate = dateExpr ? parseDate(dateExpr.toLowerCase(), msg.timestamp, deps.business.timezone) : null;

  // R2 P3(b): la HORA se LEE del intérprete determinista (computado 1×/turno en
  // dispatch) y se resuelve con la POLÍTICA ÚNICA del FSM (resolveInterpretedTime,
  // compartida con QUALIFYING_DATETIME). Antes greeting tenía su propio parseTime
  // que adivinaba 1–6→PM, divergiendo de datetime; ahora ambos usan el MISMO
  // parser (extractRawTime) + la MISMA política:
  //  - hora resuelta (period explícito | minutos | hora ≥ 7) → "HH:MM".
  //  - hora ambigua (1–6 en punto sin período) → NO se adivina: parsedTimeStr=null
  //    (no se hornea un PM falso). La fuente cambia; la LÓGICA de greetCase queda
  //    equivalente porque sigue ramificando por la PRESENCIA de parsedTimeStr.
  // El TURNO (shift "por la tarde") sigue viniendo del clasificador: es una señal
  // distinta de la hora-reloj y el intérprete neutro no captura turnos sueltos.
  const timeConfident = (multi.timeMatch?.confidence ?? 0) >= CONFIDENCE_THRESHOLD;
  const shiftRaw      = timeConfident ? multi.timeMatch!.shift : undefined;

  // FIX 2: MISMA política que qualifyingDatetime (applyTimeRes). 'resolved' → hora
  // concreta; 'defer-agenda' (1–11 en punto sin marcador) → parkear cruda en
  // pendingAgendaTime y resolver contra la agenda real en SHOWING_SLOTS.
  const interpretedTime = deps.interpretation?.time ?? null;
  const timePatch       = applyTimeRes(interpretedTime ? resolveInterpretedTime(interpretedTime) : null);
  const parsedTimeStr: string | null =
    timePatch && 'requestedTime' in timePatch ? timePatch.requestedTime : null;
  const parsedAgendaTime: { hour: number; minute: number } | null =
    timePatch && 'pendingAgendaTime' in timePatch ? timePatch.pendingAgendaTime : null;

  // Derivar shift: desde HH:MM resuelto (preciso) o desde el turno del clasificador
  let parsedShift: 'morning' | 'afternoon' | null = null;
  if (parsedTimeStr) {
    const hour = parseInt(parsedTimeStr.split(':')[0]!, 10);
    parsedShift = hour >= 13 ? 'afternoon' : 'morning';
  } else {
    parsedShift = shiftRaw ?? null;
  }

  // ── Auto-pick servicio único (S4-BOT-09) ───────────────────────────────────
  // Si el negocio tiene un solo servicio y el cliente no lo nombró pero sí
  // mostró intención de reservar (fecha/hora/staff o afirmación), seleccionarlo
  // automáticamente: no tiene sentido preguntar "¿cuál servicio?". Así
  // "quiero agendar una cita para mañana" avanza sin trabarse. No aplica a
  // preguntas del negocio (se responden aparte) ni a saludos sin señal de reserva.
  // Una hora aparcada (defer-agenda) también es señal de reserva: "a las 8" sin
  // servicio explícito debe auto-elegir el servicio único igual que antes (cuando
  // "a las 8" resolvía directo a 08:00). Si no, perdería el booking-signal.
  const hasBookingSignal = Boolean(resolvedStaff || parsedDate || parsedTimeStr || parsedAgendaTime || multi.confirmYes);
  if (!resolvedService && ambiguousServices.length === 0 && services.length === 1
      && !multi.sideQuestion && hasBookingSignal) {
    resolvedService = services[0]!;
  }

  // ── Determinar caso de saludo ──────────────────────────────────────────────

  let greetCase: GreetCase = 'none';
  if (resolvedService) {
    if (resolvedStaff && parsedDate)        greetCase = 'full';
    else if (resolvedStaff)                greetCase = 'service_staff';
    else if (parsedDate && parsedTimeStr)  greetCase = 'service_date_time';
    else if (parsedDate)                   greetCase = 'service_date';
    else                                   greetCase = 'service_only';
  }
  // Si hay ambigüedad de servicio → forzar 'none' para ir a QUALIFYING_SERVICE
  if (ambiguousServices.length > 1) greetCase = 'none';

  // ── Construir contexto base ────────────────────────────────────────────────
  // Favoritos como fallback cuando el clasificador no detectó nada

  const baseContext: LifestyleBotContext = {
    customerId:  customerId || undefined,
    serviceId:   resolvedService?.id ?? (favoriteServiceId ?? undefined),
    staffId:     resolvedStaff?.id   ?? (favoriteStaffId   ?? undefined),
    messages:    [],
    ...(resolvedStaff      ? { autoAssign: false } : {}),
    ...(parsedDate         ? { requestedDate: parsedDate, isWalkIn: false } : {}),
    ...(parsedShift        ? { requestedShift: parsedShift } : {}),
    ...(parsedTimeStr      ? { requestedTime: parsedTimeStr } : {}),
    ...(parsedAgendaTime   ? { pendingAgendaTime: parsedAgendaTime } : {}),
    ...(ambiguousServices.length > 1
      ? { ambiguous_service_candidates: ambiguousServices.map((s) => s.id) }
      : {}),
  };

  // ── GAP 1 (S4-BOT-07): side-question pura como primer mensaje ──────────────
  // Si el mensaje es una pregunta sobre el negocio y NO trae datos de reserva
  // (greetCase 'none'), respóndela en vez de soltar un saludo genérico.
  // Determinista por topic; defer → Haiku (classifyIntent) → fallback [DERIVA].

  if (multi.sideQuestion && greetCase === 'none') {
    const sqOpts = { appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '' };
    const route = routeSideQuestion({
      topic:    multi.sideQuestion.topic,
      question: multi.sideQuestion.question,
      business,
      services,
      opts:     sqOpts,
    });

    let answer: string;
    if (route.mode === 'answer') {
      answer = route.text;
    } else {
      const haikuAnswer = await deps.classifier.classifyIntent({
        userMessage:      multi.sideQuestion.question,
        availableOptions: [],
        flowQuestion:     'El cliente hizo una pregunta sobre el negocio.',
        businessContext:  buildBusinessContext(business, services, sqOpts),
        recentHistory:    [],
        anthropicKey,
      }).then((c) => {
        // S5-OBS-01: log no bloqueante del output del clasificador (no altera el flujo).
        logClassifierOutput({
          supabase,
          businessId:    business.id,
          customerPhone: msg.customerPhone,
          state:         'GREETING',
          metadata:      buildSingleClassifierMetadata(c, multi.sideQuestion!.question),
        });
        return c.side_question_answer;
      }).catch(() => null);
      answer = haikuAnswer ?? derivaFallback(business, sqOpts);
    }

    // Cierre adaptativo por nivel del topic (determinista): Nivel 1 invita a
    // agendar; Niveles 2 y 3 no anexan empuje de agenda.
    const refinedTopic = refineTopic(multi.sideQuestion.topic, multi.sideQuestion.question);
    const composed = composeGreetingSideAnswer({
      answer,
      closing:      closingForTopic(refinedTopic),
      isReturning,
      customerName,
      botName:      business.botName,
      businessName: business.name,
      hasHistory:   history.length > 0,
    });
    const responseText = !isReturning
      ? `${composed}\n\n${buildPrivacyNotice()}`
      : composed;

    return {
      newState:   'QUALIFYING_SERVICE',
      newContext: { ...baseContext },
      responseText,
    };
  }

  // ── Determinar estado siguiente y prompts ──────────────────────────────────

  type GreetPlan = {
    nextState:            LifestyleBotState;
    sonnetInstruction:    string;
    deterministicFallback: string;
  };

  let plan: GreetPlan;

  switch (greetCase) {
    case 'full': {
      const dateLabel = dateExpr ?? parsedDate ?? '';
      plan = {
        nextState: 'SHOWING_SLOTS',
        sonnetInstruction:
          `El cliente quiere ${resolvedService!.name} con ${resolvedStaff!.name} para ${dateLabel}. `
          + `Confirma servicio, barbero y dia en una sola linea. No anuncies que vas a revisar horarios — los horarios se presentan a continuacion en el mismo mensaje. `
          + `Maximo 2 lineas. Sin signos de interrogacion al inicio ni exclamaciones al inicio.`,
        deterministicFallback:
          `${resolvedService!.name} con ${resolvedStaff!.name} para ${dateLabel}, anotado.`,
      };
      break;
    }
    case 'service_staff': {
      plan = {
        nextState: 'QUALIFYING_DATETIME',
        sonnetInstruction:
          `El cliente quiere ${resolvedService!.name} con ${resolvedStaff!.name}. `
          + `Confirma servicio y barbero brevemente. Pregunta para que dia quiere su cita. `
          + `Maximo 2 lineas. Sin signos de interrogacion al inicio ni exclamaciones al inicio.`,
        deterministicFallback:
          `${resolvedService!.name} con ${resolvedStaff!.name}, anotado. Para que dia lo quieres?`,
      };
      break;
    }
    case 'service_date_time': {
      const dateLabel3 = dateExpr ?? '';
      // parsedTimeStr es "HH:MM" → convertir a formato legible; si no está parseado
      // usamos el valor raw del clasificador (que ya viene en lenguaje natural).
      const timeLabel  = parsedTimeStr ? formatTimeHuman(parsedTimeStr) : (multi.timeMatch?.value ?? '');
      plan = {
        nextState: 'QUALIFYING_STAFF',
        sonnetInstruction:
          `El cliente quiere ${resolvedService!.name} para ${dateLabel3} a las ${timeLabel}. `
          + `Confirma servicio, fecha y hora brevemente. Pregunta si tiene barbero de preferencia o le asignas uno disponible. `
          + `Maximo 2 lineas. Sin signos de interrogacion al inicio ni exclamaciones al inicio.`,
        deterministicFallback:
          `${resolvedService!.name} para ${dateLabel3} a las ${timeLabel}. Tienes barbero de preferencia o te asigno uno disponible?`,
      };
      break;
    }
    case 'service_date': {
      const dateLabel2 = dateExpr ?? '';
      plan = {
        nextState: 'QUALIFYING_STAFF',
        sonnetInstruction:
          `El cliente quiere ${resolvedService!.name} para ${dateLabel2}. `
          + `Confirma servicio y fecha brevemente. Pregunta si tiene barbero de preferencia o le asignas uno disponible. `
          + `Maximo 2 lineas. Sin signos de interrogacion al inicio ni exclamaciones al inicio.`,
        deterministicFallback:
          `${resolvedService!.name} para ${dateLabel2}. Tienes barbero de preferencia o te asigno uno disponible?`,
      };
      break;
    }
    case 'service_only': {
      plan = {
        nextState: 'QUALIFYING_STAFF',
        sonnetInstruction:
          `El cliente quiere ${resolvedService!.name}. `
          + `Confirma el servicio brevemente. Pregunta si tiene barbero de preferencia o le asignas uno disponible. `
          + `Maximo 2 lineas. Sin signos de interrogacion al inicio ni exclamaciones al inicio.`,
        deterministicFallback:
          `${resolvedService!.name}, con gusto. Tienes barbero de preferencia o te asigno uno disponible?`,
      };
      break;
    }
    default: {
      // 'none' — saludo genérico. Delega en buildDefaultGreetingPlan, que elige
      // entre BIENVENIDA (conversación nueva) y CONTINUACIÓN sin re-saludo
      // (conversación en curso, según el historial). Anti re-saludo: FIX 3.
      const defaultPlan = buildDefaultGreetingPlan({
        isReturning,
        customerName,
        favStaffName,
        favServiceName,
        businessName: business.name,
        botName:      business.botName,
        history,
      });
      plan = {
        nextState:             'QUALIFYING_SERVICE',
        sonnetInstruction:     defaultPlan.sonnetInstruction,
        deterministicFallback: defaultPlan.deterministicFallback,
      };
      break;
    }
  }

  // ── greeting confirma, showingSlots presenta (PIEZA 1 + Hallazgo 2 / S5-BOT-11) ──
  // greetCase 'full' encadena a SHOWING_SLOTS en el router (que une por .join la
  // confirmación de saludo + la presentación de slots). La confirmación de greeting
  // NUNCA debe enumerar horarios: eso es trabajo de showingSlots. Generarla con Sonnet
  // era frágil — a veces listaba/inventaba horarios pese a la instrucción, y colisionaba
  // con la lista real de slots (doble lista). Por eso 'full' es DETERMINISTA, jamás pasa
  // por Sonnet:
  //   - con hora → se suprime ('') — la respuesta honesta de slots YA responde a esa hora
  //     ("A las 9 no tengo… tengo a las 10, 11 o 12"); anteponer confirmación daría 2 voces.
  //   - sin hora → confirmación determinista (deterministicFallback, "X con Y para Z,
  //     anotado.") — el .join la pega a la presentación de Versión C → una sola voz de slots.
  // El cliente nuevo conserva el aviso de privacidad (LFPDPPP Art. 8) — dato legal, no
  // "voz". (qualifyingStaff → SHOWING_SLOTS ya seguía este patrón determinista: '' o
  // "Con {staff}, perfecto.", nunca Sonnet.)
  if (greetCase === 'full') {
    const hasHour      = Boolean(parsedTimeStr || parsedAgendaTime);
    const confirmation = hasHour ? '' : plan.deterministicFallback;
    const privacy      = isReturning ? '' : buildPrivacyNotice();
    const responseText = [confirmation, privacy].filter((s) => s.length > 0).join('\n\n');
    return {
      newState:     plan.nextState,
      newContext:   { ...baseContext },
      responseText,
    };
  }

  // ── Generar responseText vía Claude Sonnet ─────────────────────────────────

  const systemPrompt = buildSystemPrompt(business, undefined, services);
  // FIX 3 — pasar el historial reciente + la instrucción al generador. Así el
  // modelo sabe que la conversación ya está en curso y no re-saluda.
  const generativeMessages = buildGenerativeMessages(history, plan.sonnetInstruction);
  const greetingText = await generateGreetingText(
    anthropicKey,
    systemPrompt,
    generativeMessages,
    deps.model,
    plan.deterministicFallback,
    business.id,
    msg.customerPhone,
    plan.nextState,
  );

  // Para clientes nuevos: append aviso de privacidad al final (LFPDPPP Art. 8).
  // Consentimiento tácito: el cliente sigue interactuando tras el aviso.
  const responseText = !isReturning
    ? `${greetingText}\n\n${buildPrivacyNotice()}`
    : greetingText;

  // ── Ensamblar resultado ────────────────────────────────────────────────────

  // El historial de mensajes lo gestiona handler.ts de forma centralizada después
  // de cada dispatch: acumula [user, assistant] por turno con ventana de 6 turnos.
  // greeting.ts no lo setea — el handler lo construye partiendo de currentContext
  // vacío (conversación nueva o reseteada por inactividad/estado terminal).

  const newContext: LifestyleBotContext = {
    ...baseContext,
  };

  return {
    newState:     plan.nextState,
    newContext,
    responseText,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Aviso de privacidad para clientes nuevos (LFPDPPP Art. 8). Consentimiento tácito. */
function buildPrivacyNotice(): string {
  const privacyUrl = process.env['PRIVACY_POLICY_URL'] ?? 'https://zentriq.mx/aviso-de-privacidad';
  return `Al continuar, aceptas nuestro aviso de privacidad: ${privacyUrl}`;
}

/**
 * Retorna TODOS los servicios que coinciden con el value del clasificador.
 * - 1 resultado → match único, avanzar
 * - 2+ resultados → ambigüedad, pedir clarificación
 * - 0 resultados → no se pudo resolver
 */
function findServicesFromValue(value: string, services: ServiceRow[]): ServiceRow[] {
  const lower = value.trim().toLowerCase();
  const num   = parseInt(lower, 10);
  if (!isNaN(num) && num >= 1 && num <= services.length) {
    const s = services[num - 1];
    return s ? [s] : [];
  }
  const exact = services.find((s) => s.name.toLowerCase() === lower);
  if (exact) return [exact];

  const byNameContains = services.filter((s) => s.name.toLowerCase().includes(lower));
  if (byNameContains.length > 0) return byNameContains;

  const byInputContains = services.filter((s) => lower.includes(s.name.toLowerCase()));
  if (byInputContains.length > 0) return byInputContains;

  return [];
}

function resolveStaffFromValue(value: string, staff: StaffRow[]): StaffRow | null {
  const lower = value.trim().toLowerCase();
  const exact = staff.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;
  const contained = staff.find((s) => lower.includes(s.name.toLowerCase()));
  if (contained) return contained;
  return staff.find((s) => {
    const firstName = s.name.split(' ')[0]?.toLowerCase() ?? '';
    return firstName.length > 2 && lower.includes(firstName);
  }) ?? null;
}

async function generateGreetingText(
  apiKey:         string,
  system:         string,
  messages:       ConvTurn[],
  model:          string,
  fallback:       string,
  businessId:     string,
  customerPhone:  string,
  stateTo:        string,
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: apiKey || undefined });
    const resp = await callClaude({
      client,
      model,
      maxTokens: 160,
      system:    [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      timeoutMs: TIMEOUT_SONNET_MS,
      context:   { businessId, customerPhone, state: 'GREETING' },
    });

    logBot({
      ts:               new Date().toISOString(),
      service:          'bot',
      business_id:      businessId,
      customer_phone:   customerPhone,
      state_from:       'GREETING',
      state_to:         stateTo,
      model_used:       model,
      tokens_input:     resp.usage.input_tokens,
      tokens_cache_read: resp.usage.cache_read_input_tokens ?? 0,
      tokens_output:    resp.usage.output_tokens,
    });

    const block = resp.content[0];
    return block?.type === 'text' && block.text.trim() ? block.text.trim() : fallback;
  } catch {
    return fallback;
  }
}
