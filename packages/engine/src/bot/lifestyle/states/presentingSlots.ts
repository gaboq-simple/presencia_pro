// ─── State: SHOWING_SLOTS (PRESENTING_SLOTS) ──────────────────────────────────
// Calcula y presenta hasta 3 slots disponibles al cliente.
//
// Auto-assign (context.autoAssign === true):
//   1. Deduplicar slots por hora exacta (mismo HH:MM → mismo turno).
//   2. Si solo queda 1 hora única → elegir el primer barbero disponible
//      y saltar a AWAITING_CONFIRMATION directamente (nunca mostrar opciones).
//   3. Si hay varias horas → mostrar horas como opciones SIN nombres de barbero.
//      El barbero ya está pre-asignado en cada pendingSlot (el primero por hora).
//
// Walk-in: presenta slot único más cercano (NOW() + buffer).
// Barbero específico sin disponibilidad:
//   1. Primero ofrece otros horarios del mismo barbero.
//   2. Si no acepta, el handler de CONFIRMING_APPOINTMENT puede ofrecer otros barberos.

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_HAIKU_MS } from '../claudeClient';
import type { LifestyleBotContext, LifestylePendingSlot } from '../../../types/lifestyle.types';
import { getCatalog, getStaffForService } from '../catalog';
import { logBot } from '../../../utils/logger';
import { buildSystemPrompt } from '../prompt';
import { getAvailableSlots, findSlotsInNextDays, SchedulingQueryError } from '../scheduling';
import { formatTimeHumanFromDate, formatTimeHuman, buildBookingNameQuestion, detectsServiceCorrection } from '../utils';
import { utcToLocalDateStr, utcToLocalMinutes, noonUTCDate, weekdayFromDateStr } from '../tzUtils';
import type { LifestyleIncomingMessage, SlotCandidate, StateHandlerDeps, StateHandlerResult } from '../types';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Mensaje al usuario cuando los queries de disponibilidad fallan
const SCHEDULING_ERROR_MESSAGE =
  'No pude verificar la disponibilidad en este momento. ' +
  'Intenta de nuevo en unos minutos o escribenos directamente.';

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export async function handleShowingSlots(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase, anthropicKey } = deps;

  // ── Corrección de servicio mid-flow ────────────────────────────────────────

  if (detectsServiceCorrection(msg.body.trim().toLowerCase())) {
    return {
      newState: 'QUALIFYING_SERVICE',
      newContext: {
        ...context,
        serviceId:                    undefined,
        staffId:                      undefined,
        requestedDate:                undefined,
        requestedTime:                undefined,
        requestedShift:               undefined,
        pendingSlots:                 undefined,
        ambiguous_service_candidates: undefined,
        clarification_attempts:       0,
      },
      responseText: 'Sin problema. Cual servicio te interesa?',
    };
  }

  if (!context.serviceId || !context.requestedDate) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: 'Que servicio te interesa?',
    };
  }

  // Cargar datos del servicio para obtener duration_minutes
  const catalog = await getCatalog(business.id, supabase);
  const service = catalog.find((s) => s.id === context.serviceId);
  if (!service) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context, serviceId: undefined },
      responseText: 'No encontre ese servicio. Cual quieres elegir?',
    };
  }

  // Staff disponible para el servicio
  const staffForService = await getStaffForService(business.id, context.serviceId, supabase);
  if (staffForService.length === 0) {
    return {
      newState:     'FALLBACK',
      newContext:   context,
      responseText: `Lo siento, por el momento no hay staff disponible para ${service.name}. Te comunicamos con el equipo.`,
    };
  }

  // noonUTCDate: noon UTC del día local → getDay()/getDate() devuelven weekday/día correcto
  const requestedDate = noonUTCDate(context.requestedDate);

  // ── Retry limit para errores de disponibilidad ────────────────────────────
  // clarification_attempts se reutiliza como contador de reintentos de scheduling.
  // 1er fallo → SHOWING_SLOTS (mismo estado, el usuario puede reintentar escribiendo).
  // 2do fallo → FALLBACK (escalar a humano).
  const schedulingRetries = context.clarification_attempts ?? 0;

  let slots: SlotCandidate[];
  try {
    slots = await getAvailableSlots({
      businessId:          business.id,
      serviceId:           context.serviceId,
      durationMinutes:     service.duration_minutes,
      requestedDate,
      shift:               context.requestedShift ?? null,
      preferredStaffId:    context.autoAssign ? null : (context.staffId ?? null),
      isWalkIn:            context.isWalkIn ?? false,
      walkInBufferMinutes: business.walkInBufferMinutes,
      staffToQuery:        staffForService,
      supabase,
      tz:                  business.timezone,
      requestedTime:       context.requestedTime ?? undefined,
    });
  } catch (err) {
    if (err instanceof SchedulingQueryError) {
      if (schedulingRetries >= 1) {
        // Segundo fallo consecutivo → escalar a FALLBACK
        return {
          newState:     'FALLBACK',
          newContext:   { ...context, clarification_attempts: 0 },
          responseText: deps.business.fallbackMessage,
        };
      }
      // Primer fallo → informar y quedarse en SHOWING_SLOTS para reintentar
      return {
        newState:     'SHOWING_SLOTS',
        newContext:   { ...context, clarification_attempts: schedulingRetries + 1 },
        responseText: SCHEDULING_ERROR_MESSAGE,
      };
    }
    throw err;
  }

  // Query exitoso — resetear contador de reintentos de scheduling
  const contextAfterSlots: typeof context = { ...context, clarification_attempts: 0 };

  if (slots.length === 0) {
    // Sin disponibilidad para el barbero preferido → ofrecer auto-assign
    if (context.staffId && !context.autoAssign) {
      const staffName = staffForService.find((s) => s.id === context.staffId)?.name ?? 'ese barbero';
      return {
        newState:     'SHOWING_SLOTS',
        newContext:   { ...contextAfterSlots, staffId: undefined, autoAssign: true },
        responseText: `${staffName} no tiene disponibilidad para ese dia. Buscando con otro barbero disponible...`,
      };
    }

    // Buscar slots en los próximos 5 días calendario (~3-4 días hábiles)
    let alt: { date: Date; slots: SlotCandidate[] } | null;
    try {
      alt = await findSlotsInNextDays(requestedDate, 5, {
        businessId:          business.id,
        serviceId:           context.serviceId,
        durationMinutes:     service.duration_minutes,
        walkInBufferMinutes: business.walkInBufferMinutes,
        staffToQuery:        staffForService,
        supabase,
        tz:                  business.timezone,
      });
    } catch (err) {
      if (err instanceof SchedulingQueryError) {
        if (schedulingRetries >= 1) {
          return {
            newState:     'FALLBACK',
            newContext:   { ...context, clarification_attempts: 0 },
            responseText: deps.business.fallbackMessage,
          };
        }
        return {
          newState:     'SHOWING_SLOTS',
          newContext:   { ...context, clarification_attempts: schedulingRetries + 1 },
          responseText: SCHEDULING_ERROR_MESSAGE,
        };
      }
      throw err;
    }

    if (alt) {
      const pendingSlots: LifestylePendingSlot[] = alt.slots.map((slot, i) => ({
        index:     i + 1,
        staffId:   slot.staffId,
        staffName: slot.staffName,
        startsAt:  slot.startsAt.toISOString(),
        endsAt:    slot.endsAt.toISOString(),
      }));
      const altDateStr = utcToLocalDateStr(alt.date, business.timezone);
      const newCtx: LifestyleBotContext = {
        ...contextAfterSlots,
        requestedDate:  altDateStr,
        requestedShift: null,
        pendingSlots,
      };
      const staffName = contextAfterSlots.autoAssign
        ? null
        : (staffForService.find((s) => s.id === contextAfterSlots.staffId)?.name ?? null);
      const responseText = await generateSlotsMessage({
        slots:             alt.slots,
        isWalkIn:          false,
        isReturning:       !!contextAfterSlots.customerId,
        serviceName:       service.name,
        staffName,
        autoAssign:        contextAfterSlots.autoAssign ?? false,
        anthropicKey,
        system:            buildSystemPrompt(business),
        businessId:        business.id,
        customerPhone:     msg.customerPhone,
        tz:                business.timezone,
        originalDateLabel: formatDateLabel(requestedDate, business.timezone),
        altDateLabel:      formatDateLabel(alt.date, business.timezone),
      });
      return { newState: 'CONFIRMING_APPOINTMENT', newContext: newCtx, responseText };
    }

    return {
      newState:     'QUALIFYING_WAITLIST',
      newContext:   { ...contextAfterSlots },
      responseText:
        'No tenemos horarios disponibles para tu preferencia en los proximos dias\n' +
        'Quieres quedar en lista de espera? Si se libera un lugar te avisamos de inmediato.',
    };
  }

  // ── Auto-assign: deduplicar por hora exacta ───────────────────────────────
  // Con autoAssign=true, getAvailableSlots devuelve todos los barberos
  // disponibles. Agrupamos por hora (HH:MM) y nos quedamos con el primero
  // de cada grupo para que el usuario elija HORA, no barbero.

  let displaySlots = slots;
  if (context.autoAssign) {
    const seen = new Set<string>();
    displaySlots = slots.filter((s) => {
      const localMin = utcToLocalMinutes(s.startsAt, business.timezone);
      const key = `${String(Math.floor(localMin / 60)).padStart(2, '0')}:${String(localMin % 60).padStart(2, '0')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  }

  // ── Verificar si la hora exacta solicitada tiene slot disponible ─────────
  // Si el usuario pidió "a las 5" (requestedTime = "17:00") y ninguno de los
  // slots presentados cae dentro de ±5 min, se comunica explícitamente que
  // esa hora no tiene disponibilidad antes de ofrecer las alternativas.
  let exactMatchMissed = false;
  let requestedTimeLabel: string | undefined;
  if (context.requestedTime) {
    const [rh, rm] = context.requestedTime.split(':').map(Number);
    const targetMin = (rh ?? 0) * 60 + (rm ?? 0);
    const hasExact = displaySlots.some((s) => {
      const slotMin = utcToLocalMinutes(s.startsAt, business.timezone);
      return Math.abs(slotMin - targetMin) <= 5;
    });
    if (!hasExact) {
      exactMatchMissed = true;
      requestedTimeLabel = formatTimeHuman(context.requestedTime);
    }
  }

  // ── Un solo horario único (autoAssign) → AWAITING_BOOKING_NAME ───────────
  if (context.autoAssign && displaySlots.length === 1) {
    const chosen        = displaySlots[0]!;
    const chosenDateStr = utcToLocalDateStr(chosen.startsAt, business.timezone);
    const dayName       = DAYS_ES[weekdayFromDateStr(chosenDateStr)]!;
    const dayNum        = parseInt(chosenDateStr.split('-')[2]!, 10);
    const monthName     = MONTHS_ES[parseInt(chosenDateStr.split('-')[1]!, 10) - 1]!;
    const timeStr       = formatTimeHumanFromDate(chosen.startsAt, business.timezone);

    const { nameQuestion, pendingBookingName } = buildBookingNameQuestion(msg.customerName);

    const newContext: LifestyleBotContext = {
      ...contextAfterSlots,
      staffId:            chosen.staffId,
      selectedSlot:       chosen.startsAt.toISOString(),
      pendingSlots:       [],
      pendingBookingName,
    };

    const confirmText = exactMatchMissed && requestedTimeLabel
      ? `A las ${requestedTimeLabel} no tengo disponible. Lo mas cercano que hay es el ${dayName} ${dayNum} de ${monthName} a las ${timeStr} con ${chosen.staffName}. ${nameQuestion}`
      : `Te asigno con ${chosen.staffName} el ${dayName} ${dayNum} de ${monthName} a las ${timeStr}. ${nameQuestion}`;

    return {
      newState:     'AWAITING_BOOKING_NAME',
      newContext,
      responseText: confirmText,
    };
  }

  // ── Construir pendingSlots ────────────────────────────────────────────────

  const pendingSlots: LifestylePendingSlot[] = displaySlots.map((slot, i) => ({
    index:     i + 1,
    staffId:   slot.staffId,
    staffName: slot.staffName,
    startsAt:  slot.startsAt.toISOString(),
    endsAt:    slot.endsAt.toISOString(),
  }));

  const newContext: LifestyleBotContext = {
    ...contextAfterSlots,
    pendingSlots,
  };

  // ── Formatear respuesta via Claude ───────────────────────────────────────

  const staffName = context.autoAssign
    ? null
    : (staffForService.find((s) => s.id === context.staffId)?.name ?? null);

  const responseText = await generateSlotsMessage({
    slots:              displaySlots,
    isWalkIn:           context.isWalkIn ?? false,
    isReturning:        !!context.customerId,
    serviceName:        service.name,
    staffName,
    autoAssign:         context.autoAssign ?? false,
    anthropicKey,
    system:             buildSystemPrompt(business),
    businessId:         business.id,
    customerPhone:      msg.customerPhone,
    tz:                 business.timezone,
    exactMatchMissed,
    requestedTimeLabel,
  });

  return {
    newState:     'CONFIRMING_APPOINTMENT',
    newContext,
    responseText,
  };
}

// ─── Presentación de slots via Claude ────────────────────────────────────────

async function generateSlotsMessage(params: {
  slots:               SlotCandidate[];
  isWalkIn:            boolean;
  isReturning:         boolean;
  serviceName:         string;
  staffName:           string | null;
  autoAssign:          boolean;
  anthropicKey:        string;
  system:              string;
  businessId:          string;
  customerPhone:       string;
  tz:                  string;
  originalDateLabel?:  string;
  altDateLabel?:       string;
  exactMatchMissed?:   boolean;
  requestedTimeLabel?: string;
}): Promise<string> {
  const {
    slots, isWalkIn, isReturning, serviceName, staffName, autoAssign,
    anthropicKey, system, businessId, customerPhone, tz,
    originalDateLabel, altDateLabel, exactMatchMissed, requestedTimeLabel,
  } = params;

  const isAltDate = !!(originalDateLabel && altDateLabel);
  const fallback  = isAltDate
    ? buildAltDateFallback(slots, originalDateLabel!, altDateLabel!, autoAssign, tz)
    : buildSlotsMessage(slots, isWalkIn, autoAssign, tz, exactMatchMissed, requestedTimeLabel);

  // El slotsText omite el nombre del barbero cuando autoAssign=true
  const slotsText = slots
    .map((s, i) => {
      const localDs   = utcToLocalDateStr(s.startsAt, tz);
      const dayName   = DAYS_ES[weekdayFromDateStr(localDs)]!;
      const dayNum    = parseInt(localDs.split('-')[2]!, 10);
      const monthName = MONTHS_ES[parseInt(localDs.split('-')[1]!, 10) - 1]!;
      const time      = formatTimeHumanFromDate(s.startsAt, tz);
      const staffPart = autoAssign ? '' : ` con ${s.staffName}`;
      return `Slot ${i + 1}: ${dayName} ${dayNum} de ${monthName} a las ${time}${staffPart}`;
    })
    .join('\n');

  const barberoLine = autoAssign
    ? '- Barbero: se asignara automaticamente segun disponibilidad (no menciones nombre especifico de barbero)'
    : `- Barbero: ${staffName ?? 'cualquier barbero disponible (auto-asignado)'}`;

  // Nota de hora exacta no disponible — instrucción explícita a Claude
  const exactTimeNote = exactMatchMissed && requestedTimeLabel
    ? [
        `- IMPORTANTE: El cliente pidio una cita "a las ${requestedTimeLabel}" pero ese horario exacto NO esta disponible.`,
        `  Comunica esto PRIMERO de forma directa, sin disculpas. Ejemplo para 2 alternativas: "A las ${requestedTimeLabel} no tengo disponible. Lo mas cercano es a las [hora1] o a las [hora2]. Cual prefieres?" Ejemplo para 1 alternativa: "A las ${requestedTimeLabel} no tengo disponible, pero tengo a las [hora]. Te queda bien?"`,
      ].join('\n')
    : null;

  const userMessage = [
    `Contexto:`,
    `- Cliente: ${isReturning ? 'recurrente (ya ha visitado antes)' : 'nuevo'}`,
    `- Servicio: ${serviceName}`,
    barberoLine,
    isWalkIn ? '- Es un walk-in (cliente en el local ahora mismo)' : null,
    isAltDate
      ? `- Nota: el cliente pidio "${originalDateLabel}" pero no hay disponibilidad ese dia. Los horarios que vas a presentar son para "${altDateLabel}". Aclara el cambio de fecha de forma directa al inicio del mensaje, sin disculpas excesivas.`
      : null,
    exactTimeNote,
    '',
    'Horarios disponibles:',
    slotsText,
    '',
    autoAssign
      ? 'Presenta estos horarios de forma natural. El barbero sera asignado automaticamente — no menciones su nombre. Termina con una pregunta abierta para que el cliente elija el horario. Sin signos de interrogacion al inicio ni exclamaciones al inicio.'
      : 'Presenta estos horarios de forma natural y calida, sin listarlos como formulario. Termina con una pregunta abierta para que el cliente elija, sin mencionar el numero total de opciones.',
  ].filter((l) => l !== null).join('\n');

  try {
    const client = new Anthropic({ apiKey: anthropicKey || undefined });
    const resp   = await callClaude({
      client,
      model:     HAIKU_MODEL,
      maxTokens: 200,
      system:    [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages:  [{ role: 'user', content: userMessage }],
      timeoutMs: TIMEOUT_HAIKU_MS,
      context:   { businessId, customerPhone, state: 'SHOWING_SLOTS' },
    });

    logBot({
      ts:               new Date().toISOString(),
      service:          'bot',
      business_id:      businessId,
      customer_phone:   customerPhone,
      state_from:       'SHOWING_SLOTS',
      state_to:         'CONFIRMING_APPOINTMENT',
      model_used:       HAIKU_MODEL,
      tokens_input:     resp.usage.input_tokens,
      tokens_cache_read: resp.usage.cache_read_input_tokens ?? 0,
      tokens_output:    resp.usage.output_tokens,
    });

    const block = resp.content[0];
    return block?.type === 'text' ? block.text.trim() : fallback;
  } catch {
    return fallback;
  }
}

// ─── Formato de slots (fallback determinista) ─────────────────────────────────

export function buildSlotsMessage(
  slots:               SlotCandidate[],
  isWalkIn:            boolean,
  autoAssign:          boolean,
  tz:                  string,
  exactMatchMissed?:   boolean,
  requestedTimeLabel?: string,
): string {
  if (isWalkIn && slots.length === 1) {
    const slot      = slots[0]!;
    const time      = formatTimeHumanFromDate(slot.startsAt, tz);
    const staffPart = autoAssign ? '' : ` con ${slot.staffName}`;
    return `Tenemos disponibilidad ahora mismo${staffPart} a las ${time}. Confirmamos? (si/no)`;
  }

  // Hora exacta pedida no disponible → comunicar antes de listar alternativas
  if (exactMatchMissed && requestedTimeLabel) {
    const altTimes = slots.map((s) => `las ${formatTimeHumanFromDate(s.startsAt, tz)}`);
    if (altTimes.length === 1) {
      return `A las ${requestedTimeLabel} no tengo disponible, pero tengo a ${altTimes[0]}. Te queda bien?`;
    }
    const timesStr = altTimes.slice(0, -1).join(', a ') + ` o a ${altTimes[altTimes.length - 1]}`;
    return `A las ${requestedTimeLabel} no tengo disponible. Lo mas cercano es a ${timesStr}. Cual prefieres?`;
  }

  const lines = slots.map((slot, i) => {
    const localDs   = utcToLocalDateStr(slot.startsAt, tz);
    const dayName   = DAYS_ES[weekdayFromDateStr(localDs)]!;
    const dayNum    = parseInt(localDs.split('-')[2]!, 10);
    const monthName = MONTHS_ES[parseInt(localDs.split('-')[1]!, 10) - 1]!;
    const time      = formatTimeHumanFromDate(slot.startsAt, tz);
    const staffPart = autoAssign ? '' : ` con ${slot.staffName}`;
    return `${i + 1}. ${dayName} ${dayNum} de ${monthName} a las ${time}${staffPart}`;
  });

  const opts = slots.length === 1
    ? '1'
    : slots.slice(0, -1).map((_, i) => String(i + 1)).join(', ') + ` o ${slots.length}`;
  return `Estos son los horarios disponibles:\n\n${lines.join('\n')}\n\nCual prefieres? (${opts})`;
}

/** Formatea un Date (noon UTC) a "Miercoles 7 de mayo" para mensajes al usuario. */
function formatDateLabel(d: Date, tz: string): string {
  const localDs  = utcToLocalDateStr(d, tz);
  const dayOfWeek = weekdayFromDateStr(localDs);
  const dayNum    = parseInt(localDs.split('-')[2]!, 10);
  const monthIdx  = parseInt(localDs.split('-')[1]!, 10) - 1;
  return `${DAYS_ES[dayOfWeek]} ${dayNum} de ${MONTHS_ES[monthIdx]}`;
}

/** Fallback determinista cuando se ofrecen slots de una fecha alternativa. */
function buildAltDateFallback(
  slots:             SlotCandidate[],
  originalDateLabel: string,
  altDateLabel:      string,
  autoAssign:        boolean,
  tz:                string,
): string {
  const times    = slots.map((s) => `las ${formatTimeHumanFromDate(s.startsAt, tz)}`);
  const timesStr = times.length === 1
    ? `a ${times[0]}`
    : times.slice(0, -1).join(', a ') + ` o a ${times[times.length - 1]}`;
  const staffNote = autoAssign ? '' : ` con ${slots[0]!.staffName}`;
  return `Para ${originalDateLabel} no tengo espacio, pero el ${altDateLabel} si hay lugar — ${timesStr}${staffNote}. Te queda alguno?`;
}
