// ─── Lifestyle Bot — Shared Utilities ─────────────────────────────────────────

import type { LifestyleBotContext } from '../../types/lifestyle.types';

// ─── Reinicio de la selección de reserva (S5-BOT-10) ──────────────────────────

/**
 * Subconjunto del contexto que borra la SELECCIÓN de reserva del cliente
 * (servicio + barbero + fecha/turno + slots) y resetea los contadores.
 *
 * Punto único de verdad del ciclo de vida de `requestedStaffId`: la intención
 * de barbero vive y muere junto con serviceId/staffId. En vez de 5 resets
 * dispersos, los handlers que reinician el flujo (corrección de servicio en
 * SHOWING_SLOTS / CONFIRMING_APPOINTMENT) hacen spread de este helper. El reset
 * por inactividad/estado terminal (handler.ts → context={}) ya lo cubre por
 * borrado total. Invariante: requestedStaffId NUNCA sobrevive una corrección
 * de servicio ni un /reset.
 */
export function clearBookingSelection(): Partial<LifestyleBotContext> {
  return {
    serviceId:                    undefined,
    staffId:                      undefined,
    requestedStaffId:             undefined,
    requestedDate:                undefined,
    requestedTime:                undefined,
    requestedShift:               undefined,
    pendingAgendaTime:            undefined,
    pendingSlots:                 undefined,
    nearestOfferSlot:             null,
    ambiguous_service_candidates: undefined,
    clarification_attempts:       0,
    rejection_attempts:           0,
  };
}

// ─── Detección de corrección de servicio ──────────────────────────────────────

const SERVICE_CORRECTION_KEYWORDS = [
  'cambiar servicio',
  'otro servicio',
  'me equivoqué',
  'me equivoque',
  'no quiero eso',
  'no es ese',
  'no ese servicio',
  'quiero otro servicio',
  'equivoqué el servicio',
  'equivoque el servicio',
];

/**
 * Detecta si el cliente quiere corregir el servicio seleccionado.
 * Determinista — sin Claude. Se llama al inicio de los handlers
 * QUALIFYING_STAFF, QUALIFYING_DATETIME, SHOWING_SLOTS y CONFIRMING_APPOINTMENT.
 */
export function detectsServiceCorrection(lower: string): boolean {
  return SERVICE_CORRECTION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Evalúa si un nombre de perfil de WhatsApp parece un nombre real.
 * Heurística conservadora: prefiere preguntar antes que asumir mal.
 *
 * Retorna true si:
 *   - Tiene 2+ palabras separadas por espacio
 *   - Sin emojis
 *   - Solo letras (incluyendo acentos y ñ), espacios, guiones y apóstrofes
 */
export function isLikelyRealName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.split(/\s+/).length < 2) return false;
  if (/\p{Emoji}/u.test(trimmed)) return false;
  if (!/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s'\-]+$/.test(trimmed)) return false;
  return true;
}

/**
 * Construye la pregunta de nombre para el mensaje de confirmación de cita.
 * Si el nombre de WhatsApp parece real, lo pre-llena y pide confirmación.
 * Si no, pregunta directamente.
 *
 * Devuelve:
 *   - nameQuestion: texto a anexar al mensaje de confirmación de slot
 *   - pendingBookingName: nombre pre-llenado (null si se pregunta directamente)
 */
export function buildBookingNameQuestion(customerName: string | null): {
  nameQuestion: string;
  pendingBookingName: string | null;
} {
  if (customerName && isLikelyRealName(customerName)) {
    return {
      nameQuestion:       `La cita queda a nombre de ${customerName}, correcto? O dime otro nombre si es para alguien mas.`,
      pendingBookingName: customerName,
    };
  }
  return {
    nameQuestion:       'A nombre de quien queda la cita?',
    pendingBookingName: null,
  };
}

/**
 * Convierte una hora "HH:MM" a texto legible en español sin formato 24h.
 *
 * Ejemplos:
 *   "17:00" → "5 de la tarde"
 *   "10:00" → "10 de la mañana"
 *   "13:30" → "1:30 de la tarde"
 *   "09:00" → "9 de la mañana"
 *   "20:00" → "8 de la noche"
 *
 * Rangos:
 *   06:00 – 11:59 → de la mañana
 *   12:00 – 19:59 → de la tarde
 *   20:00 – 23:59 / 00:00 – 05:59 → de la noche
 *
 * Reglas:
 *   - Sin ceros a la izquierda (9, no 09)
 *   - Sin minutos cuando son :00 (5 de la tarde, no 5:00 de la tarde)
 */
export function formatTimeHuman(time: string): string {
  const h = parseInt(time.split(':')[0] ?? '0', 10);

  let period: string;
  if (h >= 6 && h < 12) {
    period = 'de la mañana';
  } else if (h >= 12 && h < 20) {
    period = 'de la tarde';
  } else {
    period = 'de la noche';
  }

  return `${formatTimeCompact(time)} ${period}`;
}

/**
 * Igual que formatTimeHuman pero COMPACTO: solo la hora en 12h, SIN marcador de franja
 * ("5", "1:30", "7:30"). Para ejemplos donde la franja ya se comunicó aparte (Versión C).
 * Sin ceros a la izquierda; sin minutos cuando son :00.
 */
export function formatTimeCompact(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const minutePart = m > 0 ? `:${String(m).padStart(2, '0')}` : '';
  return `${h12}${minutePart}`;
}

// Extrae la hora local "HH:MM" de un Date UTC en el timezone del negocio.
function localHHMMFromDate(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
  const parts = fmt.formatToParts(d);
  const get   = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return parseInt(part?.value ?? '0', 10);
  };
  let h = get('hour');
  if (h === 24) h = 0;
  const m = get('minute');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convierte un Date UTC a hora en el timezone del negocio y la formatea CON marcador de
 * franja (formatTimeHuman): "5 de la tarde".
 *
 * @param d   Date UTC (ej: slot.startsAt desde Supabase o scheduling)
 * @param tz  IANA timezone del negocio (ej: 'America/Mexico_City')
 */
export function formatTimeHumanFromDate(d: Date, tz: string): string {
  return formatTimeHuman(localHHMMFromDate(d, tz));
}

/**
 * Igual que formatTimeHumanFromDate pero COMPACTO (sin marcador de franja): "5", "1:30".
 * Para los ejemplos de la Versión C donde la franja ya se comunicó en la señal de amplitud.
 */
export function formatTimeCompactFromDate(d: Date, tz: string): string {
  return formatTimeCompact(localHHMMFromDate(d, tz));
}
