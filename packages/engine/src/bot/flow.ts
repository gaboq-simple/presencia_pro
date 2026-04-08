// ─── Conversation Flow — State Machine ───────────────────────────────────────
// Decide el siguiente ConversationStep dado el estado actual y el contexto.
// No produce side effects — función pura.

import type { ClientConfig } from '../types/index.js';
import type { ConversationContext, ConversationStep } from './types.js';

// ─── Office hours check ───────────────────────────────────────────────────────

/**
 * Retorna true si el timestamp dado cae dentro del horario de oficina del cliente.
 */
export function isWithinOfficeHours(config: ClientConfig, now: Date): boolean {
  const { start, end, days } = config.bot.officeHours;

  // getDay() returns 0=Sunday. Convert to 1=Monday..7=Sunday to match config.
  const jsDay = now.getDay();
  const configDay = jsDay === 0 ? 7 : jsDay;

  if (!days.includes(configDay)) return false;

  // Compare HH:mm strings — works because "09:00" < "19:00" lexicographically
  const currentTime = now.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: config.client.timezone,
  });

  return currentTime >= start && currentTime < end;
}

// ─── Specialist qualification needed ─────────────────────────────────────────

/**
 * Retorna true si hay más de un especialista y aún no se ha elegido uno.
 */
function needsSpecialistSelection(config: ClientConfig, context: ConversationContext): boolean {
  return config.specialists.length > 1 && !context.specialistId;
}

// ─── Mode qualification needed ────────────────────────────────────────────────

/**
 * Retorna true si el servicio elegido tiene múltiples modos y aún no se ha elegido uno.
 */
function needsModeSelection(config: ClientConfig, context: ConversationContext): boolean {
  if (context.serviceMode) return false;

  const service = context.serviceId
    ? config.services.find((s) => s.id === context.serviceId)
    : null;

  // If no service selected yet, assume mode selection will be needed
  if (!service) return true;

  // Guard: modes only exist on MedicalService — lifestyle services are always in-local
  if (!('modes' in service)) return false;

  return service.modes.length > 1;
}

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Retorna el siguiente ConversationStep basado en el estado actual,
 * el contexto acumulado y la configuración del cliente.
 *
 * Función pura — no modifica nada, no hace I/O.
 */
export function getNextStep(
  current: ConversationStep,
  context: ConversationContext,
  config: ClientConfig,
  now: Date = new Date(),
): ConversationStep {
  switch (current) {
    case 'GREETING': {
      return isWithinOfficeHours(config, now) ? 'QUALIFYING_VISIT_TYPE' : 'AWAY';
    }

    case 'QUALIFYING_VISIT_TYPE': {
      // Always move to service qualification next
      return 'QUALIFYING_SERVICE';
    }

    case 'QUALIFYING_SERVICE': {
      if (!context.serviceId) return 'QUALIFYING_SERVICE';

      // If multiple specialists and none chosen yet, stay on service step
      // (specialist selection is folded into this step as a sub-question)
      if (needsSpecialistSelection(config, context)) return 'QUALIFYING_SERVICE';

      return needsModeSelection(config, context) ? 'QUALIFYING_MODE' : 'SHOWING_SLOTS';
    }

    case 'QUALIFYING_MODE': {
      if (!context.serviceMode) return 'QUALIFYING_MODE';
      return 'SHOWING_SLOTS';
    }

    case 'SHOWING_SLOTS': {
      if (!context.selectedSlot) return 'SHOWING_SLOTS';
      return 'CONFIRMING_APPOINTMENT';
    }

    case 'CONFIRMING_APPOINTMENT': {
      if (!context.appointmentId) return 'CONFIRMING_APPOINTMENT';
      // Si requiere confirmación explícita del paciente, esperar SÍ/NO antes de continuar
      if (config.scheduling.confirmationRequired) return 'AWAITING_CONFIRMATION';
      return 'SENDING_INTAKE';
    }

    case 'AWAITING_CONFIRMATION': {
      // El handler intercepta el mensaje del paciente directamente — no hay transición automática
      return 'AWAITING_CONFIRMATION';
    }

    case 'SENDING_INTAKE': {
      return 'AWAITING_INTAKE';
    }

    case 'AWAITING_INTAKE': {
      return 'AWAITING_INTAKE';
    }

    case 'AWAY': {
      // Re-evaluate office hours — patient may message again later
      return isWithinOfficeHours(config, now) ? 'QUALIFYING_VISIT_TYPE' : 'AWAY';
    }

    case 'COMPLETED':
    case 'ESCALATED': {
      // Terminal steps — no automatic transition
      return current;
    }
  }
}
