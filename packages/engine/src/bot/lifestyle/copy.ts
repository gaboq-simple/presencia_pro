// ─── Lifestyle Bot — Copy compartido (AUD-06) ─────────────────────────────────
// Fuente ÚNICA para los mensajes y vocabularios que estaban duplicados entre
// estados y que ya habían empezado a divergir (el cliente recibía "va" aceptado
// en un paso y rechazado en el siguiente). Convención de estilo: ver STYLE.md.
//
// Regla: si un string de cliente o una lista de keywords aparece en 2+ archivos,
// vive aquí. Los estados agregan SOLO sus extras específicos de contexto.

import { getCatalog } from './catalog';
import { logBotError } from './utils/logger';
import type { StateHandlerDeps } from './types';

// ─── Mensajes compartidos ─────────────────────────────────────────────────────

/** Escalamiento a humano tras intentos fallidos (antes ×3 copias idénticas). */
export const ESCALATION_TO_TEAM_MESSAGE =
  'Parece que no estamos conectando. Déjame pasarte con alguien del equipo para ayudarte mejor.';

/** Falla al consultar disponibilidad (antes ×2 copias idénticas). */
export const SCHEDULING_ERROR_MESSAGE =
  'No pude verificar la disponibilidad en este momento. ' +
  'Intenta de nuevo en unos minutos o escríbenos directamente.';

/**
 * AUD-07b: fallo TÉCNICO (timeout/API/parse) — honesto, sin culpar al cliente
 * ("no te entendí" era mentira cuando el que falló fue el sistema) y sin
 * gastar intentos de clarificación.
 */
export const TECHNICAL_HICCUP_MESSAGE =
  'Perdona, tuve un problema técnico al procesar tu mensaje. ¿Me lo mandas de nuevo?';

/** AUD-07b: 3 fallos técnicos seguidos → escalar con la verdad (dispatch notifica al admin). */
export const TECHNICAL_ESCALATION_MESSAGE =
  'Sigo con problemas técnicos — enseguida le aviso al equipo para que te atiendan personalmente.';

/** Reset a elegir servicio tras una corrección (antes ×4 copias). */
export const SERVICE_QUESTION_RESET = 'Sin problema. ¿Cuál servicio te interesa?';

/** Pregunta de fecha del flujo (antes duplicada en qualifyingStaff/qualifyingDatetime). */
export const DATE_QUESTION_MESSAGE =
  '¿Para qué día prefieres tu cita? Puedes decirme una fecha o si prefieres mañana o tarde.';

// ─── Fechas en español ────────────────────────────────────────────────────────
// Antes: 4 copias (confirmed, confirmingAppointment, presentingSlots,
// awaitingCancelConfirmation) con casing inconsistente. Canónico: minúsculas
// con acento — van a media frase ("el miércoles 22 de julio"). Si un consumo
// necesita mayúscula inicial, capitaliza en el punto de uso.

export const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// ─── Vocabulario afirmativo/negativo BASE ─────────────────────────────────────
// El núcleo que debe funcionar IGUAL en todos los pasos de confirmación
// (slot, nombre, waitlist). Origen del bug: "va" confirmaba el horario pero
// fallaba en "¿la cita queda a nombre de X?" porque cada estado tenía su lista.
// Cada estado puede AGREGAR extras de contexto ("anótame" al confirmar cita,
// "incorrecto" al validar nombre), nunca recortar la base.

export const AFFIRMATIVE_BASE_KEYWORDS = [
  'sí', 'si', 'yes', 'simon', 'claro', 'ok', 'okay', 'dale', 'va', 'sale',
  'vale', 'listo', 'perfecto', 'de acuerdo',
];

export const NEGATIVE_BASE_KEYWORDS = [
  'no', 'nope', 'negativo',
];

// ─── Cierres/cortesías ────────────────────────────────────────────────────────
// Antes privados de router.ts (estado CONFIRMED). AUD-07e los comparte con
// qualifyingService: una cortesía tras una side-question contestada NO es
// intención de reserva.

export const CLOSING_KEYWORDS = [
  'gracias', 'grax', 'grácias',
  'perfecto', 'genial', 'excelente', 'de lujo',
  'nos vemos', 'hasta luego', 'hasta pronto', 'hasta entonces',
  'bye', 'chao', 'adios', 'adiós',
  'listo', 'sale', 'va', 'ok', 'okey',
  'de nada', 'claro que si',
  'que bien', 'muy bien',
];

/**
 * Cierre/cortesía REAL: mensaje corto (≤3 palabras — mismo principio que
 * isAffirmation: token corto exige mensaje corto; AUD-07c) que matchea un
 * keyword de despedida/agradecimiento.
 */
export function isClosingMessage(body: string): boolean {
  const lower = body.trim().toLowerCase();
  if (lower.split(/\s+/).length > 3) return false;
  return CLOSING_KEYWORDS.some(
    (kw) => lower === kw || new RegExp('(?:^|\\s)' + kw + '(?:\\s|$)').test(lower),
  );
}

// ─── Respuesta de precio/duración del servicio ────────────────────────────────
// Antes: función copiada carácter por carácter en awaitingConfirmation y
// awaitingBookingName (incluyendo la falta de acento en "duración").

/**
 * Respuesta corta de costo/duración para side questions durante el cierre
 * (el cliente pregunta el precio cuando se le pide el nombre, etc.).
 * Drop-in de las dos copias idénticas que vivían en awaitingConfirmation y
 * awaitingBookingName.
 */
export async function buildSideAnswerFromService(
  serviceId: string,
  deps:       StateHandlerDeps,
): Promise<string | null> {
  try {
    const catalog = await getCatalog(deps.business.id, deps.supabase);
    const service = catalog.find((s) => s.id === serviceId);
    if (!service) return null;

    const priceStr = service.price > 0
      ? `$${service.price.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${service.currency}`
      : 'sin costo adicional';

    return `El costo es ${priceStr} y la duración es de ${service.duration_minutes} min.`;
  } catch (err) {
    logBotError({ context: 'copy.buildSideAnswerFromService', error: err, businessId: deps.business.id });
    return null;
  }
}
