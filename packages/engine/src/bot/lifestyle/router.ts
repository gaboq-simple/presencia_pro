// ─── Lifestyle Bot — State Router ─────────────────────────────────────────────
// Despacha el mensaje al handler correcto según el estado actual.
// Si el estado no es reconocido → FALLBACK.
// Si el handler lanza → FALLBACK (nunca crash).
//
// Nota sobre QUALIFYING_DATETIME:
//   Es un estado de parseo puro. Cuando transiciona a SHOWING_SLOTS
//   con responseText vacío, se encadena inmediatamente con handleShowingSlots
//   para evitar enviar un mensaje vacío al cliente.

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_SONNET_MS } from './claudeClient';
import type { LifestyleBotContext, LifestyleBotState } from '../../types/lifestyle.types';
import { handleConfirmationResponse }  from './states/confirmationResponse';
import { handleQualifyingWaitlist }    from './states/waitlist';
import { handleConfirmingAppointment } from './states/confirmingAppointment';
import { handleAwaitingConfirmation }  from './states/awaitingConfirmation';
import { handleAwaitingBookingName }   from './states/awaitingBookingName';
import { handleConfirmed }             from './states/confirmed';
import { handleFallback, notifyAdminOfEscalation } from './states/fallback';
import { handleGreeting }              from './states/greeting';
import { handleQualifyingDatetime }    from './states/qualifyingDatetime';
import { handleQualifyingService }     from './states/qualifyingService';
import { handleQualifyingStaff }       from './states/qualifyingStaff';
import { handleShowingSlots }          from './states/presentingSlots';
import { startCancelFlow, handleAwaitingCancelConfirmation } from './states/awaitingCancelConfirmation';
import { isModificationIntent, isCancellationIntent, wantsToModifyExistingAppointment } from './cancelIntent';
import { getCatalog }                  from './catalog';
import { interpret }                   from './interpreter';
import { buildSystemPrompt }           from './prompt';
import { answerSideQuestion as buildDerivaAnswer } from './businessContext';
import type { LifestyleIncomingMessage, ServiceRow, StateHandlerDeps, StateHandlerResult } from './types';

// ─── Contador de escape estructural (S5-BOT-12) ───────────────────────────────
// Orden canónico del flujo de agendamiento. Un avance en este orden = progreso.
const CANONICAL_FLOW: readonly LifestyleBotState[] = [
  'GREETING',
  'QUALIFYING_SERVICE',
  'QUALIFYING_STAFF',
  'QUALIFYING_DATETIME',
  'SHOWING_SLOTS',
  'QUALIFYING_WAITLIST',
  'CONFIRMING_APPOINTMENT',
  'AWAITING_CONFIRMATION',
  'AWAITING_BOOKING_NAME',
  'CONFIRMED',
];

// Estados donde el contador de escape aplica: la costura de agendamiento donde
// viven los bucles (ask_who en confirmingAppointment, barbero en awaitingBookingName).
const BOOKING_STATES: ReadonlySet<LifestyleBotState> = new Set([
  'QUALIFYING_SERVICE',
  'QUALIFYING_STAFF',
  'QUALIFYING_DATETIME',
  'SHOWING_SLOTS',
  'QUALIFYING_WAITLIST',
  'CONFIRMING_APPOINTMENT',
  'AWAITING_CONFIRMATION',
  'AWAITING_BOOKING_NAME',
]);

// Estados de un flujo conversacional ACTIVO (mid-flow): el cliente está eligiendo
// servicio/barbero/fecha o negociando/confirmando un slot. Mientras el flujo vive,
// su "sí/no" pertenece al flujo, NO al recordatorio: la confirmación pasiva
// (handleConfirmationResponse) no debe pre-emptarlo. Fuera de este set (GREETING,
// CONFIRMED, terminales) el cliente está en reposo y el pasivo sí interviene.
//
// Conjunto deliberadamente SEPARADO de BOOKING_STATES (alcance del contador de
// escape): mismo contenido hoy, distinto propósito — no se acoplan para que uno
// pueda cambiar sin arrastrar al otro.
const ACTIVE_FLOW_STATES: ReadonlySet<LifestyleBotState> = new Set([
  'QUALIFYING_SERVICE',
  'QUALIFYING_STAFF',
  'QUALIFYING_DATETIME',
  'SHOWING_SLOTS',
  'QUALIFYING_WAITLIST',
  'CONFIRMING_APPOINTMENT',
  'AWAITING_CONFIRMATION',
  'AWAITING_BOOKING_NAME',
  // AUD-02: mientras el bot espera el "sí/no" de "¿cancelo tu cita?", ese sí/no
  // pertenece a ESTA pregunta. Sin esto, el pasivo de recordatorios interceptaría
  // el "sí" (el cliente por definición TIENE una cita futura, posiblemente <3h)
  // y lo leería como confirmación de asistencia — lo contrario de lo pedido.
  'AWAITING_CANCEL_CONFIRMATION',
]);

// Campos de la reserva cuyo llenado (de vacío a valor) cuenta como progreso real.
const PROGRESS_FIELDS = [
  'serviceId',
  'staffId',
  'requestedDate',
  'requestedTime',
  'requestedShift',
  'selectedSlot',
  'bookingName',
] as const;

/**
 * Cap de escape ESTRUCTURAL. Debe ser estrictamente mayor que cualquier cap
 * por-estado (MAX_TOTAL_ATTEMPTS = 5, etc.) para que un estado siempre tenga
 * la oportunidad de escalar por su cuenta antes de que el contador global lo
 * fuerce — el global es la red de seguridad, no el primer recurso.
 * Blindado por test (cap-relationship): STRUCTURAL_CAP > max(caps per-estado).
 */
export const STRUCTURAL_CAP = 6;

function canonicalIndex(state: LifestyleBotState): number {
  return CANONICAL_FLOW.indexOf(state);
}

function hasNewFieldFilled(prev: LifestyleBotContext, next: LifestyleBotContext): boolean {
  return PROGRESS_FIELDS.some((field) => {
    const before = prev[field];
    const after  = next[field];
    const wasEmpty   = before === undefined || before === null;
    const nowFilled  = after !== undefined && after !== null;
    return wasEmpty && nowFilled;
  });
}

export async function dispatch(
  state: LifestyleBotState,
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  // ── Intérprete de turno único (R2, Pieza B) ─────────────────────────────────
  // Interpreta el mensaje del turno UNA sola vez, antes del switch de estado, y
  // se inyecta inmutable en `deps`. Determinista (cero LLM). El encadenamiento de
  // estados dentro de routeToHandler reusa estos mismos `deps` → interpret() NO
  // se recomputa por eslabón. En R2 ningún handler lo consume aún (estrangulamiento
  // gradual: la infra primero, los consumidores en Pieza C).
  const interpretation = interpret({
    message:  msg.body,
    now:      msg.timestamp,
    timezone: deps.business.timezone,
  });
  const handlerDeps: StateHandlerDeps = { ...deps, interpretation };

  let result: StateHandlerResult;
  try {
    result = await routeToHandler(state, msg, context, handlerDeps);
  } catch {
    // Nunca crash — captura cualquier error de handler y transiciona a FALLBACK
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: deps.business.fallbackMessage,
    };
  }

  result = applyStructuralCap(state, context, result);

  // ── Notificación atómica de escalado (AUD-03) ───────────────────────────────
  // Cualquier camino que transiciona a ESCALATED (fallback ×2, rechazo ×4, cap
  // estructural) notifica al admin EN ESTE MISMO TURNO — la promesa "te comunico
  // con el equipo" y el aviso son atómicos. Dedup con escalation_notified para
  // que los mensajes sostenidos en ESCALATED pegajoso no re-notifiquen.
  if (result.newState === 'ESCALATED' && state !== 'ESCALATED' && !context.escalation_notified) {
    await notifyAdminOfEscalation(msg, handlerDeps);   // best-effort, nunca lanza
    result = { ...result, newContext: { ...result.newContext, escalation_notified: true } };
  }

  return result;
}

function applyStructuralCap(
  state:   LifestyleBotState,
  context: LifestyleBotContext,
  result:  StateHandlerResult,
): StateHandlerResult {

  // ── Contador de escape estructural (S5-BOT-12) ──────────────────────────────
  // Solo aplica cuando el turno se RECIBIÓ dentro de la costura de agendamiento.
  // El progreso lo computa este wrapper por DELTA (no la cooperación de los
  // handlers): forwardMove (avance en el orden canónico) o newFieldFilled (campo
  // de la reserva recién llenado). Falla seguro hacia el escalado: ninguna rama
  // de clarify puede resetearlo porque no lo conoce.
  if (!BOOKING_STATES.has(state)) return result;

  const forwardMove    = canonicalIndex(result.newState) > canonicalIndex(state);
  const newFieldFilled = hasNewFieldFilled(context, result.newContext);
  const leftBookingFlow = !BOOKING_STATES.has(result.newState);

  // Progreso real, o el flujo ya salió de la costura (CONFIRMED/FALLBACK/…) → reset.
  if (forwardMove || newFieldFilled || leftBookingFlow) {
    return { ...result, newContext: { ...result.newContext, no_progress_streak: 0 } };
  }

  // Sin progreso y aún dentro del flujo → incrementar.
  const streak = (context.no_progress_streak ?? 0) + 1;
  if (streak >= STRUCTURAL_CAP) {
    return {
      newState:     'ESCALATED',
      newContext:   { ...result.newContext, no_progress_streak: streak },
      responseText: result.responseText,
    };
  }
  return { ...result, newContext: { ...result.newContext, no_progress_streak: streak } };
}

async function routeToHandler(
  state: LifestyleBotState,
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  // ── Intent ARCO — prioridad absoluta sobre cualquier estado ───────────────
  // Si el cliente pregunta por sus datos personales o derechos ARCO,
  // responde con el link al formulario sin interrumpir el flujo posterior.
  if (isArcoIntent(msg.body)) {
    const arcoUrl = process.env['ARCO_URL'] ?? 'https://zentriq.mx/arco';
    return {
      newState:   state,   // mantiene el estado actual — no interrumpe el flow
      newContext: context,
      responseText:
        `Puedes ejercer tus derechos ARCO (acceso, rectificación, cancelación u oposición de tus datos) en ${arcoUrl} o escribiéndonos a contacto@zentriq.mx. Tienes derecho a solicitar qué datos almacenamos, corregirlos, eliminarlos o limitar su uso. Tu solicitud será atendida en máximo 20 días hábiles.`,
    };
  }

  // ── Confirmación pasiva — solo en REPOSO, nunca sobre un flujo activo ──────
  // Si el cliente tiene una cita en las próximas 3h, su mensaje PUEDE ser
  // respuesta a un recordatorio (sí/no/voy tarde). Pero si está mid-flow
  // (eligiendo/negociando un slot), ese "sí" es para el flujo: el flujo
  // conversacional SIEMPRE gana. Solo se consulta el pasivo cuando el estado
  // está en reposo (GREETING/CONFIRMED/terminal), no en ACTIVE_FLOW_STATES.
  // (Bug R3: sin esta guarda, "sí" tras negociar 17:00 confirmaba la cita
  // preexistente de las 10:00 — "dice 5pm, agenda 10".)
  if (!ACTIVE_FLOW_STATES.has(state)) {
    const confirmResult = await handleConfirmationResponse(msg, context, deps);
    if (confirmResult !== null) return confirmResult;
  }

  switch (state) {
    case 'GREETING': {
      // ── AUD-02 (ex TODO MEDIO-9): cancelar/mover una cita EXISTENTE ────────
      // "quiero cancelar mi cita del viernes" al día siguiente de agendar llega
      // aquí (la conversación ya se reseteó). Sin esta intercepción caía al
      // flujo de reserva y el bot intentaba VENDER una cita nueva. Corre DESPUÉS
      // del pasivo de recordatorios (arriba): para citas a <3h el pasivo es más
      // específico y conserva prioridad. Modificación se checa primero (mismo
      // orden que CONFIRMED): "ya no puedo, cambia mi cita" es mover, no cancelar.
      const cancelKind = wantsToModifyExistingAppointment(msg.body)
        ? 'modification' as const
        : isCancellationIntent(msg.body)
          ? 'cancellation' as const
          : null;
      if (cancelKind) {
        return startCancelFlow(cancelKind, msg, context, deps);
      }

      // Si greeting detectó toda la info y va directo a SHOWING_SLOTS,
      // encadena inmediatamente para combinar confirmación + slots en un solo mensaje.
      const greetResult = await handleGreeting(msg, context, deps);
      if (greetResult.newState === 'SHOWING_SLOTS') {
        const slotsResult = await handleShowingSlots(msg, greetResult.newContext, deps);
        const combined = [greetResult.responseText, slotsResult.responseText]
          .filter((s) => s.trim().length > 0)
          .join(' ');
        return { ...slotsResult, responseText: combined };
      }
      return greetResult;
    }

    case 'QUALIFYING_SERVICE':
      return handleQualifyingService(msg, context, deps);

    case 'QUALIFYING_STAFF': {
      // Si el contexto ya tiene requestedDate (pre-filled desde greeting),
      // QUALIFYING_STAFF puede resolver directo a SHOWING_SLOTS — encadenar.
      const staffResult = await handleQualifyingStaff(msg, context, deps);
      if (staffResult.newState === 'SHOWING_SLOTS') {
        const slotsResult = await handleShowingSlots(msg, staffResult.newContext, deps);
        const combined = [staffResult.responseText, slotsResult.responseText]
          .filter((s) => s.trim().length > 0)
          .join(' ');
        return { ...slotsResult, responseText: combined };
      }
      return staffResult;
    }

    case 'QUALIFYING_DATETIME': {
      // Si resuelve a SHOWING_SLOTS encadena sin round-trip
      const dtResult = await handleQualifyingDatetime(msg, context, deps);
      if (dtResult.newState === 'SHOWING_SLOTS') {
        return handleShowingSlots(msg, dtResult.newContext, deps);
      }
      return dtResult;
    }

    case 'SHOWING_SLOTS':
      return handleShowingSlots(msg, context, deps);

    case 'QUALIFYING_WAITLIST':
      return handleQualifyingWaitlist(msg, context, deps);

    case 'CONFIRMING_APPOINTMENT': {
      const confirmingResult = await handleConfirmingAppointment(msg, context, deps);
      // Si el cliente pidió una fecha diferente, encadenar directamente con
      // QUALIFYING_DATETIME para parsear el mismo mensaje sin round-trip.
      if (confirmingResult.newState === 'QUALIFYING_DATETIME') {
        const dtResult = await handleQualifyingDatetime(msg, confirmingResult.newContext, deps);
        if (dtResult.newState === 'SHOWING_SLOTS') {
          return handleShowingSlots(msg, dtResult.newContext, deps);
        }
        return dtResult;
      }
      return confirmingResult;
    }

    case 'AWAITING_CONFIRMATION': {
      const result = await handleAwaitingConfirmation(msg, context, deps);
      // Si confirma, encadenar directo con el handler de CONFIRMED (flujo legacy)
      if (result.newState === 'CONFIRMED') {
        const confirmedResult = await handleConfirmed(msg, result.newContext, deps);
        // BUG 3 fix: si awaitingConfirmation dejó una side answer en responseText,
        // adjuntarla después del mensaje de confirmación principal.
        if (result.responseText.trim()) {
          return {
            ...confirmedResult,
            responseText: [confirmedResult.responseText, result.responseText]
              .filter((s) => s.trim().length > 0)
              .join('\n\n'),
          };
        }
        return confirmedResult;
      }
      return result;
    }

    case 'AWAITING_BOOKING_NAME': {
      const result = await handleAwaitingBookingName(msg, context, deps);
      // Si el nombre fue confirmado, encadenar con CONFIRMED para crear la cita
      if (result.newState === 'CONFIRMED') {
        const confirmedResult = await handleConfirmed(msg, result.newContext, deps);
        // Si awaitingBookingName dejó una side answer (precio/duración), adjuntarla
        if (result.responseText.trim()) {
          return {
            ...confirmedResult,
            responseText: [confirmedResult.responseText, result.responseText]
              .filter((s) => s.trim().length > 0)
              .join('\n\n'),
          };
        }
        return confirmedResult;
      }
      // S5-BOT-08: corrección de día delegada → handleConfirmingAppointment
      // devolvió date_redirect (QUALIFYING_DATETIME). Encadenar igual que el
      // case CONFIRMING_APPOINTMENT para parsear el mismo mensaje sin round-trip.
      if (result.newState === 'QUALIFYING_DATETIME') {
        const dtResult = await handleQualifyingDatetime(msg, result.newContext, deps);
        if (dtResult.newState === 'SHOWING_SLOTS') {
          return handleShowingSlots(msg, dtResult.newContext, deps);
        }
        return dtResult;
      }
      return result;
    }

    case 'CONFIRMED': {
      // CONFIRMED ya no es un estado terminal — handler.ts no resetea a GREETING.
      // Orden de detección (importa — modificación debe ir ANTES de containsSideQuestion
      // porque "puedo cambiar la hora?" tiene "?" y sería capturado como side question):
      //   1. isClosingMessage       → cierre cálido + reset a GREETING
      //   2. isModificationIntent   → preguntar antes de mover (AUD-04)
      //   3. isCancellationIntent   → preguntar antes de cancelar (AUD-04)
      //   4. containsSideQuestion   → Claude responde; mantener CONFIRMED
      //   5. fallthrough            → handleGreeting (nuevo agendamiento)
      if (isClosingMessage(msg.body)) {
        return {
          newState:     'GREETING',
          newContext:   {},
          responseText: '¡Gracias a ti! Aquí andamos para lo que necesites.',
        };
      }
      // AUD-04: mismo flujo con confirmación que GREETING (AUD-02). Antes,
      // "puedo cambiar la hora?" ejecutaba el UPDATE a cancelled DE INMEDIATO
      // — acción destructiva sin confirmar (si el cliente solo preguntaba, o
      // ningún horario nuevo le servía, ya había perdido su slot) — y
      // reiniciaba el flujo desde cero re-preguntando el servicio.
      if (isModificationIntent(msg.body)) {
        return startCancelFlow('modification', msg, context, deps);
      }
      if (isCancellationIntent(msg.body)) {
        return startCancelFlow('cancellation', msg, context, deps);
      }
      if (containsSideQuestion(msg.body)) {
        const catalog = await getCatalog(deps.business.id, deps.supabase);
        const answer  = await answerSideQuestion(msg.body, context, catalog, deps);
        return {
          newState:     'CONFIRMED',
          newContext:   context,
          responseText: answer,
        };
      }
      return handleGreeting(msg, {}, deps);
    }

    case 'COMPLETED':
      // COMPLETED sigue siendo terminal — handler.ts ya resetea a GREETING antes de llegar aquí.
      return handleGreeting(msg, {}, deps);

    case 'AWAY':
      // AUD-07a: el muro de fuera-de-horario murió (el aviso ahora es un
      // preámbulo del handler). Nada transiciona a AWAY ya; este case solo
      // recupera conversaciones legacy que quedaron atoradas en ese estado.
      return handleGreeting(msg, {}, deps);

    case 'FALLBACK':
      return handleFallback(msg, context, deps);

    case 'ESCALATED': {
      // AUD-03: ESCALATED pegajoso (ya no es terminal). El bot prometió "te
      // comunico con el equipo" — sostener la promesa en vez de re-saludar.
      // 1er mensaje del cliente tras la escalada: acuse de espera (sin
      // re-notificar — dispatch dedupea con escalation_notified).
      // 2º mensaje sin respuesta humana: el bot retoma vía GREETING para no
      // dejar al cliente colgado indefinidamente (preserva solo customerId).
      // Si el staff toma control antes, el handoff gate intercepta aguas
      // arriba y este case nunca corre. Red de seguridad: reset >24h.
      const holds = context.escalation_holds ?? 0;
      if (holds < 1) {
        return {
          newState:     'ESCALATED',
          newContext:   { ...context, escalation_holds: holds + 1 },
          responseText:
            'El equipo ya está enterado y te contactan en breve. Gracias por tu paciencia. ' +
            'Si mientras tanto quieres que te siga atendiendo yo, dime qué necesitas.',
        };
      }
      const resumed = await routeToHandler(
        'GREETING',
        msg,
        { ...(context.customerId ? { customerId: context.customerId } : {}) },
        deps,
      );
      return {
        ...resumed,
        responseText: ['Mientras el equipo te contacta, te sigo atendiendo.', resumed.responseText]
          .filter((s) => s.trim().length > 0)
          .join('\n'),
      };
    }

    case 'AWAITING_CANCEL_CONFIRMATION':
      // AUD-02: el cliente respondió a "¿cancelo/muevo tu cita?" — el handler
      // cancela solo ante un SÍ explícito; ante NO o ambigüedad la cita queda.
      return handleAwaitingCancelConfirmation(msg, context, deps);

    default: {
      // Exhaustiveness check — TypeScript garantiza que nunca llega aquí
      const _exhaustive: never = state;
      void _exhaustive;
      return handleFallback(msg, context, deps);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detecta si el mensaje contiene una pregunta o consulta de información
 * (precio, duración, dirección, horarios, etc.).
 * Determinista — sin Claude. Se usa en estado CONFIRMED antes de resetear.
 */
function containsSideQuestion(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return (
    lower.includes('?') ||
    /\b(cuanto|cuánto|cuántos|cuantos|precio|costo|cuesta|vale|dura|duracion|duración|donde|dónde|direccion|dirección|horario|abren|cierran|incluye|que incluye|qué incluye)\b/.test(lower)
  );
}

/**
 * Responde una side question en estado CONFIRMED usando Claude con el system
 * prompt completo (incluye catálogo). Cubre precio, duración, dirección,
 * horarios y cualquier otra consulta de información del negocio.
 * Mantiene el contexto de la cita para dar respuestas más precisas.
 */
async function answerSideQuestion(
  question: string,
  context:  LifestyleBotContext,
  catalog:  ServiceRow[],
  deps:     StateHandlerDeps,
): Promise<string> {
  // Fallback determinista [DERIVA]: comparte el link al minisite si existe,
  // o deriva al equipo. Cubre topic=other y datos ausentes sin inventar info.
  const fallback = buildDerivaAnswer('other', deps.business, catalog, {
    appUrl: process.env['NEXT_PUBLIC_APP_URL'] ?? '',
  });
  try {
    const client = new Anthropic({ apiKey: deps.anthropicKey });
    const system = buildSystemPrompt(deps.business, context, catalog);

    // Dar contexto del servicio agendado — permite responder "cuánto dura" con precisión
    const svc     = context.serviceId ? catalog.find((s) => s.id === context.serviceId) : undefined;
    const apptCtx = svc
      ? `El cliente ya tiene una cita confirmada de ${svc.name} ($${svc.price} ${svc.currency}, ${svc.duration_minutes} min).`
      : 'El cliente ya tiene una cita confirmada.';

    const resp = await callClaude({
      client,
      model:     deps.model,
      maxTokens: 120,
      system:    [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages:  [{ role: 'user', content: `${apptCtx} Ahora pregunta: "${question}". Responde en 1-2 líneas. Sin markdown. Ortografía correcta: acentos y signos de apertura (¿ ¡).` }],
      timeoutMs: TIMEOUT_SONNET_MS,
      context:   { businessId: deps.business.id, customerPhone: '', state: 'CONFIRMED' },
    });

    const block = resp.content[0];
    return block?.type === 'text' && block.text.trim() ? block.text.trim() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Detecta mensajes de agradecimiento o despedida post-confirmación.
 * Determinista — sin Claude. Solo keywords simples en español e inglés.
 */
const CLOSING_KEYWORDS = [
  'gracias', 'grax', 'grácias',
  'perfecto', 'genial', 'excelente', 'de lujo',
  'nos vemos', 'hasta luego', 'hasta pronto', 'hasta entonces',
  'bye', 'chao', 'adios', 'adiós',
  'listo', 'sale', 'va', 'ok', 'okey',
  'de nada', 'claro que si',
  'que bien', 'muy bien',
];

function isClosingMessage(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return CLOSING_KEYWORDS.some(
    (kw) => lower === kw || new RegExp('(?:^|\\s)' + kw + '(?:\\s|$)').test(lower),
  );
}

// ─── Detección de modificación/cancelación ────────────────────────────────────
// Los detectores viven en cancelIntent.ts (módulo puro, AUD-02): los comparten
// el estado CONFIRMED, la intercepción en GREETING y el fast-path de
// qualifyingService.

// ─── Detección de intent ARCO (derechos sobre datos personales) ───────────────

const ARCO_KEYWORDS = [
  'mis datos', 'mis derechos', 'quiero mis datos', 'borrar mis datos',
  'eliminar mis datos', 'derechos arco', 'datos personales', 'privacidad',
  'derecho de acceso', 'rectificacion', 'cancelacion de datos', 'oposicion',
  'ley de datos', 'lfpdppp', 'aviso de privacidad',
];

function isArcoIntent(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return ARCO_KEYWORDS.some((kw) => lower.includes(kw));
}

