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
import { handleFallback }             from './states/fallback';
import { handleGreeting }              from './states/greeting';
import { handleQualifyingDatetime }    from './states/qualifyingDatetime';
import { handleQualifyingService }     from './states/qualifyingService';
import { handleQualifyingStaff }       from './states/qualifyingStaff';
import { handleShowingSlots }          from './states/presentingSlots';
import { getCatalog }                  from './catalog';
import { interpret }                   from './interpreter';
import { buildSystemPrompt }           from './prompt';
import { answerSideQuestion as buildDerivaAnswer } from './businessContext';
import { formatTimeHumanFromDate }     from './utils';
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

  // ── Confirmación pasiva — prioridad sobre el estado actual ────────────────
  // Si el cliente tiene una cita en las próximas 3h, su mensaje se interpreta
  // como respuesta al recordatorio (sí/no/cancelar) antes de evaluar el flujo
  // conversacional normal.
  const confirmResult = await handleConfirmationResponse(msg, context, deps);
  if (confirmResult !== null) return confirmResult;

  switch (state) {
    case 'GREETING': {
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

    // TODO(MEDIO-9): Cancelación desde GREETING
    // Cuando el usuario está en GREETING y escribe "quiero cancelar mi cita del viernes",
    // classifyMultiIntent no detecta cancelación y el flujo va a QUALIFYING_SERVICE.
    // Flujo propuesto:
    //   1. En handleGreeting (greeting.ts), tras classifyMultiIntent, verificar si el
    //      mensaje contiene keywords de cancelación (reutilizar CANCELLATION_KEYWORDS).
    //   2. Si sí: buscar cita activa (status='confirmed', starts_at > now) del customerId.
    //   3. Si existe: preguntar "Tienes cita de [svc] el [fecha] con [barbero]. Cancelamos?"
    //      y retornar estado AWAITING_CANCEL_CONFIRMATION con appointmentId en contexto.
    //   4. Agregar case 'AWAITING_CANCEL_CONFIRMATION' aquí (actualmente escala a FALLBACK
    //      en línea ~213) para confirmar/cancelar según respuesta del usuario.
    //   5. Si no existe cita activa: continuar flujo normal de agendamiento.

    case 'CONFIRMED': {
      // CONFIRMED ya no es un estado terminal — handler.ts no resetea a GREETING.
      // Orden de detección (importa — modificación debe ir ANTES de containsSideQuestion
      // porque "puedo cambiar la hora?" tiene "?" y sería capturado como side question):
      //   1. isClosingMessage       → cierre cálido + reset a GREETING
      //   2. isModificationIntent   → cancelar cita + GREETING para reagendar
      //   3. isCancellationIntent   → cancelar cita + confirmación + GREETING
      //   4. containsSideQuestion   → Claude responde; mantener CONFIRMED
      //   5. fallthrough            → handleGreeting (nuevo agendamiento)
      if (isClosingMessage(msg.body)) {
        return {
          newState:     'GREETING',
          newContext:   {},
          responseText: 'Gracias a ti! Aqui andamos para lo que necesites.',
        };
      }
      if (isModificationIntent(msg.body)) {
        return handleModificationOrCancellation('modification', msg, context, deps);
      }
      if (isCancellationIntent(msg.body)) {
        return handleModificationOrCancellation('cancellation', msg, context, deps);
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
      return {
        newState:     'AWAY',
        newContext:   context,
        responseText: deps.business.awayMessage,
      };

    case 'FALLBACK':
    case 'ESCALATED':
      return handleFallback(msg, context, deps);

    case 'AWAITING_CANCEL_CONFIRMATION':
      // El bot no cancela citas — escalar directamente
      return handleFallback(msg, { ...context, fallbackAttempts: 2 }, deps);

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
      messages:  [{ role: 'user', content: `${apptCtx} Ahora pregunta: "${question}". Responde en 1-2 lineas. Sin markdown. Sin signos de interrogacion ni exclamaciones al inicio.` }],
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

// ─── Detección de modificación/cancelación en CONFIRMED ───────────────────────

const MODIFICATION_KEYWORDS = [
  'cambiar', 'modificar', 'mover', 'otra hora', 'reagendar',
  'cambio de hora', 'mejor a las', 'prefiero a las', 'a otra hora',
  'diferente hora', 'cambiarla', 'cambiarme', 'moverla', 'moverme',
];

const CANCELLATION_KEYWORDS = [
  'cancelar', 'ya no puedo', 'no voy a ir', 'anular', 'quitar la cita',
  'no puedo ir', 'cancela', 'no voy', 'cancelen', 'cancelame',
];

function isModificationIntent(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return MODIFICATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isCancellationIntent(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return CANCELLATION_KEYWORDS.some((kw) => lower.includes(kw));
}

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

/**
 * Busca la cita activa del usuario (status=confirmed, starts_at > now)
 * y la cancela. Para modificación: transita a GREETING para reagendar.
 * Para cancelación: confirma la cancelación y transita a GREETING.
 *
 * La cancelación es UPDATE (no DELETE) — el registro se conserva para métricas.
 * Envuelto en try/catch — si falla, escala con fallbackMessage.
 */
async function handleModificationOrCancellation(
  type:    'modification' | 'cancellation',
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase } = deps;

  try {
    // ── Obtener customerId (del contexto o query) ─────────────────────────
    let customerId = context.customerId;
    if (!customerId) {
      const { data: customerData } = await supabase
        .from('customers')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone', msg.customerPhone)
        .maybeSingle();
      customerId = (customerData as { id: string } | null)?.id;
    }

    if (!customerId) {
      return {
        newState:     'GREETING',
        newContext:   {},
        responseText: 'No encontre una cita activa. Si quieres agendar una nueva, con gusto te ayudo.',
      };
    }

    // ── Buscar cita confirmada futura ─────────────────────────────────────
    const now = new Date();
    const { data: apptData } = await supabase
      .from('appointments')
      .select(`id, starts_at, staff:staff_id(name)`)
      .eq('business_id', business.id)
      .eq('customer_id', customerId)
      .eq('status', 'confirmed')
      .gt('starts_at', now.toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!apptData) {
      return {
        newState:     'GREETING',
        newContext:   {},
        responseText: 'No encontre una cita activa. Si quieres agendar una nueva, con gusto te ayudo.',
      };
    }

    const appt      = apptData as unknown as { id: string; starts_at: string; staff: Array<{ name: string }> | { name: string } | null };
    const startsAt  = new Date(appt.starts_at);
    const staffRaw  = appt.staff;
    const staffName = (Array.isArray(staffRaw) ? staffRaw[0]?.name : (staffRaw as { name: string } | null)?.name) ?? 'tu barbero';
    const timeStr   = formatTimeHumanFromDate(startsAt, business.timezone);

    // ── Cancelar la cita (UPDATE — no DELETE) ─────────────────────────────
    const { error: cancelError } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id);

    if (cancelError) throw cancelError;

    // ── Respuesta según tipo ──────────────────────────────────────────────
    if (type === 'modification') {
      return {
        newState:     'GREETING',
        newContext:   { customerId },
        responseText: `Listo, cancele tu cita de las ${timeStr} con ${staffName}. Vamos a agendar una nueva. Que servicio necesitas?`,
      };
    }

    return {
      newState:     'GREETING',
      newContext:   { customerId },
      responseText: `Listo, tu cita de las ${timeStr} con ${staffName} queda cancelada. Si necesitas agendar otra, aqui estoy.`,
    };
  } catch {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: deps.business.fallbackMessage,
    };
  }
}
