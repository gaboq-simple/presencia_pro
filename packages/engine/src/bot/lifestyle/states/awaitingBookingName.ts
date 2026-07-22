// ─── State: AWAITING_BOOKING_NAME ─────────────────────────────────────────────
// El cliente recibe el slot asignado + la pregunta de nombre en UN SOLO mensaje
// (enviado por el estado anterior: presentingSlots o confirmingAppointment).
//
// Dos sub-casos según context.pendingBookingName:
//
// A) Pre-llenado (pendingBookingName existe — nombre del perfil WhatsApp es real):
//    Bot preguntó: "La cita queda a nombre de X, correcto? O dime otro nombre..."
//      "si"     → bookingName = pendingBookingName → CONFIRMED
//      "no"     → limpiar pendingBookingName, pedir nombre directo
//      nombre real (≤ 4 palabras, < 40 chars, sin keywords de flujo, sin ?) → CONFIRMED
//      otro     → pedir clarificación ("No capté bien el nombre...")
//
// B) Directo (sin pendingBookingName — nombre ambiguo o apodo):
//    Bot preguntó: "A nombre de quien queda la cita?"
//      nombre real → bookingName = msg.body.trim() → CONFIRMED
//      no parece nombre → retry hasta MAX_RETRIES, luego FALLBACK
//
// En ambos casos CONFIRMED viene sin responseText — el router encadena
// handleConfirmed que genera el mensaje final con el nombre.

import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { getCatalog } from '../catalog';
import { logBotError } from '../utils/logger';
import { handleConfirmingAppointment, detectsSummaryCorrection } from './confirmingAppointment';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';
import { AFFIRMATIVE_BASE_KEYWORDS, NEGATIVE_BASE_KEYWORDS, buildSideAnswerFromService } from '../copy';

// Exportado para el test de relación de caps (S5-BOT-12).
export const MAX_RETRIES = 2;

// Base compartida (copy.ts) + extras de ESTE contexto (validar el nombre).
const YES_KEYWORDS = [
  ...AFFIRMATIVE_BASE_KEYWORDS,
  'correcto', 'exacto', 'así es', 'asi es', 'efectivamente', 'afirmativo',
];

const NO_KEYWORDS = [
  ...NEGATIVE_BASE_KEYWORDS,
  'incorrecto', 'error', 'otro', 'diferente',
];

// ─── YES helper ───────────────────────────────────────────────────────────────
// Acepta cualquier delimitador no-alfanumérico después del keyword (coma, punto,
// signo de exclamación, espacio). Evita falsos positivos como "sigo" o "sigo".

function startsOrEqualsYes(lower: string): boolean {
  return YES_KEYWORDS.some((kw) => {
    if (lower === kw) return true;
    if (!lower.startsWith(kw)) return false;
    const next = lower[kw.length]!;
    return !/[a-záéíóúüñ]/i.test(next);
  });
}

// ─── Heurística: ¿parece un nombre real? ─────────────────────────────────────
// Reglas:
//   1. Sin signo de interrogación
//   2. Menos de 40 caracteres
//   3. 1–4 palabras
//   4. Ninguna palabra coincide con keyword de flujo (confirmación, negación,
//      preguntas de precio/duración)
//
// Ejemplos válidos  : "María José", "Carlos", "el niño", "Juan Pablo García"
// Ejemplos inválidos: "Si, o no sabes…", "cuánto cuesta?", "mejor otro día"

// FLOW_KEYWORDS cubre palabras que no deben confundirse con un nombre.
// Excluye 'simon' a propósito: "Simon García" es un booking_name válido;
// 'simon' como afirmativo se detecta antes vía startsOrEqualsYes.
const FLOW_KEYWORDS = new Set([
  'sí', 'si', 'yes', 'claro', 'correcto', 'exacto', 'ok', 'dale',
  'así es', 'asi es', 'efectivamente', 'afirmativo',
  ...NO_KEYWORDS,
  'cuánto', 'cuanto', 'cuántos', 'cuantos', 'precio', 'costo', 'cuesta',
  'vale', 'dura', 'sería', 'seria', 'incluye', 'mejor', 'quiero', 'sabes',
]);

function looksLikeName(body: string): boolean {
  if (body.includes('?')) return false;
  if (body.length >= 40) return false;
  const words = body.trim().split(/\s+/);
  if (words.length > 4) return false;
  const clean = words.map((w) => w.replace(/[^a-záéíóúüñ]/gi, '').toLowerCase());
  return !clean.some((w) => w.length > 0 && FLOW_KEYWORDS.has(w));
}

// ─── Detección de preguntas laterales ────────────────────────────────────────

function containsQuestion(lower: string): boolean {
  return lower.includes('?') ||
    /\b(cuanto|cuánto|cuántos|cuantos|precio|costo|cuesta|vale|dura|duracion|duración|incluye|qué incluye|que incluye)\b/.test(lower);
}

// ─── Extracción de nombre alterno ─────────────────────────────────────────────
// Cuando el usuario dice "Si, pero a nombre de [nombre]" u otros patrones,
// extrae el nombre alternativo para usarlo en lugar del pre-llenado.

const ALT_NAME_PATTERNS: Array<RegExp> = [
  /^pero\s+a\s+nombre\s+de[l]?\s+(.+)/i,           // "pero a nombre de/del X"
  /^pero\s+para\s+(.+)/i,                           // "pero para X" (o posesivo sin nombre → isJustPossessive lo filtra)
  /^pero\s+pon(?:la|lo)\s+a\s+nombre\s+de\s+(.+)/i,// "pero ponla/ponlo a nombre de X"
  /^la\s+cita\s+es\s+para\s+(.+)/i,                // "la cita es para X"
  /^la\s+cita\s+queda\s+(?:a\s+nombre\s+de|para)\s+(.+)/i, // "la cita queda a nombre de/para X"
  /^a\s+nombre\s+de[l]?\s+(.+)/i,                  // "a nombre de/del X" (sin "pero")
];

/**
 * Extrae el contenido del mensaje tras el YES keyword y cualquier
 * puntuación/espacio siguiente.
 */
function extractRestAfterYes(lower: string): string {
  for (const kw of YES_KEYWORDS) {
    if (lower === kw) return '';
    if (lower.startsWith(kw)) {
      const next = lower[kw.length]!;
      if (!/[a-záéíóúüñ]/i.test(next)) {
        return lower.slice(kw.length).replace(/^[,!.\s]+/, '').trim();
      }
    }
  }
  return '';
}

/**
 * Retorna el nombre alternativo si el resto del mensaje coincide con uno de los
 * patrones conocidos. Retorna null si:
 *   - No hay patrón que aplique.
 *   - El candidato extraído es solo un posesivo sin nombre real ("mi esposa", "su hijo").
 */
function extractAlternateName(rest: string): string | null {
  if (!rest) return null;
  for (const pattern of ALT_NAME_PATTERNS) {
    const m = rest.match(pattern);
    if (m && m[1]?.trim()) {
      const candidate = cleanBookingName(m[1].trim());
      if (isJustPossessive(candidate)) return null;
      return candidate;
    }
  }
  return null;
}

/**
 * Retorna true cuando el candidato extraído es solo un posesivo sin nombre
 * real a continuación: "mi esposa", "su hijo", "nuestra hija", etc.
 * En ese caso el bot debe pedir el nombre en lugar de usar la frase posesiva.
 */
function isJustPossessive(name: string): boolean {
  return /^(?:mi|su|nuestro|nuestra)\s+\w+$/i.test(name.trim());
}

/**
 * Detecta si el resto del mensaje (tras el YES) indica que el usuario quiere
 * un nombre alterno, aunque no se haya podido extraer un nombre concreto.
 * Cubre casos como "pero para mi esposa" o "para ella" (sin nombre explícito).
 */
function restIndicatesAlternateName(rest: string): boolean {
  return /\b(a\s+nombre\s+de[l]?|nombre\s+de[l]?|pero\s+para|pon(?:la|lo)\s+a\s+nombre|para\s+mi|para\s+su|para\s+ella|para\s+el\b)\b/i.test(rest);
}

// ─── Side answer desde catálogo ───────────────────────────────────────────────

// buildSideAnswerFromService vive en copy.ts (AUD-06 — antes copia local).

export async function handleAwaitingBookingName(
  msg:   LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:  StateHandlerDeps,
): Promise<StateHandlerResult> {
  const body    = msg.body.trim();
  const lower   = body.toLowerCase();
  const retries = context.clarification_attempts ?? 0;

  // ── Caso A: nombre pre-llenado esperando confirmación ────────────────────

  if (context.pendingBookingName) {
    // "si" / "si," / "si!" → confirmar nombre (pre-llenado o alterno detectado)
    if (startsOrEqualsYes(lower)) {
      const rest          = extractRestAfterYes(lower);
      const alternateName = extractAlternateName(rest);

      // Si el resto del mensaje indica que quiere un nombre alterno pero no
      // se pudo extraer (posesivo sin nombre: "pero para mi esposa") → preguntar.
      if (rest && alternateName === null && restIndicatesAlternateName(rest)) {
        return {
          newState:     'AWAITING_BOOKING_NAME',
          newContext:   { ...context, pendingBookingName: null, clarification_attempts: 0 },
          responseText: 'Entendido. ¿A nombre de quién quieres que quede la cita?',
        };
      }

      const nameToUse = alternateName ?? context.pendingBookingName;

      // Si además hay una pregunta de precio/duración, responderla en el mismo mensaje
      if (containsQuestion(lower) && context.serviceId) {
        const sideAnswer = await buildSideAnswerFromService(context.serviceId, deps);
        if (sideAnswer) {
          return buildConfirmedResult(context, nameToUse, sideAnswer);
        }
      }
      return buildConfirmedResult(context, nameToUse);
    }

    // ── S5-BOT-08: corrección del resumen (hora/día/barbero/cancelar) ────────
    // Corre DESPUÉS del "sí" (un sí es confirmación, no corrección) y ANTES del
    // branch NO y de la captura de nombre. Gana al branch NO solo cuando el "no"
    // trae payload de corrección ("no, a las 6"); "no" pelado cae al branch NO.
    const correctionA = detectsSummaryCorrection(body, context.pendingSlots ?? [], msg.timestamp, deps.business.timezone);
    if (correctionA.kind !== 'none') {
      return handleSummaryCorrection(correctionA.kind, msg, context, deps);
    }

    // "no" → preguntar directamente
    if (NO_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw))) {
      return {
        newState:     'AWAITING_BOOKING_NAME',
        newContext:   { ...context, pendingBookingName: null, clarification_attempts: 0 },
        responseText: 'Sin problema. ¿A nombre de quién queda la cita?',
      };
    }

    // Nombre alternativo — solo si el mensaje parece un nombre real
    if (looksLikeName(body)) {
      return buildConfirmedResult(context, body);
    }

    // No parece nombre (mensaje largo, con ?, con keywords) → clarificación
    return {
      newState:     'AWAITING_BOOKING_NAME',
      newContext:   { ...context, clarification_attempts: retries + 1 },
      responseText: 'No capté bien el nombre. ¿A nombre de quién queda la cita?',
    };
  }

  // ── Caso B: input directo de nombre ──────────────────────────────────────

  // S5-BOT-08: corrección del resumen también en input directo (sin pre-llenado).
  const correctionB = detectsSummaryCorrection(body, context.pendingSlots ?? [], msg.timestamp, deps.business.timezone);
  if (correctionB.kind !== 'none') {
    return handleSummaryCorrection(correctionB.kind, msg, context, deps);
  }

  if (looksLikeName(body)) {
    return buildConfirmedResult(context, body);
  }

  // ── Input no reconocido como nombre — retry ───────────────────────────────

  if (retries >= MAX_RETRIES - 1) {
    return {
      newState:     'FALLBACK',
      newContext:   { ...context, clarification_attempts: 0 },
      responseText: deps.business.fallbackMessage,
    };
  }

  return {
    newState:     'AWAITING_BOOKING_NAME',
    newContext:   { ...context, pendingBookingName: null, clarification_attempts: retries + 1 },
    responseText: 'No capté bien el nombre. ¿A nombre de quién queda la cita?',
  };
}

// ─── S5-BOT-08: ruteo de la corrección del resumen ───────────────────────────
// Invariante: corregir un eje nunca borra los otros. Los ejes ya elegidos
// (serviceId/requestedDate/staffId/autoAssign/pendingSlots) viven en `context`
// (buildConfirmationResult entró aquí con ...context) → se preservan.
//   - hora/día: restaurar CONFIRMING_APPOINTMENT y delegar el MISMO msg a
//     handleConfirmingAppointment en el mismo turno → reusa routeSlotSelection
//     (select/offer_nearest/ask_hour/date_redirect) sin duplicar. El router
//     encadena date_redirect → QUALIFYING_DATETIME → SHOWING_SLOTS.
//   - cancelar: la cita aún NO existe en BD (se crea en CONFIRMED) → solo reset
//     de contexto, sin DELETE/UPDATE.
//   - barbero: DIFERIDO a A2; solo se detecta para no mis-guardar como nombre.
// Coexistencia S5-BOT-03: corrección = avance → resetea clarification_attempts;
// NUNCA toca rejection_attempts.
async function handleSummaryCorrection(
  kind:    'hour' | 'date' | 'barber' | 'cancel',
  msg:     LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps:    StateHandlerDeps,
): Promise<StateHandlerResult> {
  if (kind === 'cancel') {
    return {
      newState:     'GREETING',
      newContext:   { customerId: context.customerId },
      responseText: 'Sin problema, dejamos el agendamiento por ahora. Aquí estoy cuando quieras agendar.',
    };
  }

  if (kind === 'barber') {
    // Copy honesto (S5-BOT-08b): la opción (c) NO conmuta de barbero (eso es A2),
    // así que no prometemos un reagendamiento. Ofrecemos las dos salidas reales —
    // confirmar con el barbero actual o reiniciar para elegir otro — con el nombre
    // del barbero vigente interpolado desde pendingSlots.
    const barberoActual = context.pendingSlots?.[0]?.staffName ?? 'el barbero asignado';
    return {
      newState:     'AWAITING_BOOKING_NAME',
      newContext:   { ...context, clarification_attempts: 0 },
      responseText: `Por ahora no puedo cambiar de barbero en este paso. ¿Confirmo tu cita con ${barberoActual}, o prefieres empezar de nuevo para elegir a otro?`,
    };
  }

  // hora / día: restaurar CONFIRMING_APPOINTMENT preservando los ejes; limpiar
  // lo del cierre y las banderas de slot. NO tocar rejection_attempts.
  const restored: LifestyleBotContext = {
    ...context,
    pendingBookingName:     null,
    selectedSlot:           undefined,
    nearestOfferSlot:       null,
    pendingDigitDisambig:   null,
    clarification_attempts: 0,
  };
  return handleConfirmingAppointment(msg, restored, deps);
}

// ─── Builder ──────────────────────────────────────────────────────────────────

function buildConfirmedResult(
  context:    LifestyleBotContext,
  rawName:    string,
  sideAnswer?: string,
): StateHandlerResult {
  return {
    newState:   'CONFIRMED',
    newContext: {
      ...context,
      bookingName:            cleanBookingName(rawName),
      pendingBookingName:     null,
      clarification_attempts: 0,
    },
    // sideAnswer se concatena por el router después de handleConfirmed
    responseText: sideAnswer ?? '',
  };
}

// ─── Limpieza de nombre ────────────────────────────────────────────────────────
// Remueve prefijos contextuales comunes antes de guardar el booking_name.
// Ejemplos:
//   "la cita queda para Jimena Montoya" → "Jimena Montoya"
//   "a nombre de Carlos"               → "Carlos"
//   "para el niño"                     → "el niño"
//
// Orden: de más largo a más corto para evitar match prematuro de prefijos cortos.
// Si tras limpiar queda vacío, se devuelve el texto original.

const NAME_PREFIXES = [
  'la cita que quede para el nombre de',
  'la cita que quede a nombre de',
  'la cita que quede para',
  'la cita queda a nombre de',
  'la cita queda para',
  'ponla a nombre de',
  'queda a nombre de',
  'sería para',
  'seria para',
  'el nombre de',
  'el nombre es',
  'el nombre',
  'a nombre de',
  'es para',
  'para',
];

function cleanBookingName(text: string): string {
  const trimmed = text.trim();
  const lower   = trimmed.toLowerCase();

  for (const prefix of NAME_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const cleaned = trimmed.slice(prefix.length).trim();
      return cleaned.length > 0 ? stripPossessivePrefix(cleaned) : trimmed;
    }
  }

  return stripPossessivePrefix(trimmed);
}

/**
 * Remueve prefijos posesivos tipo "mi esposa", "mi esposo", "mi hijo", etc.
 * antes del nombre real.
 * "mi esposa María López" → "María López"
 * "mi amigo Carlos"      → "Carlos"
 * "Carlos"               → "Carlos"   (sin cambio)
 */
function stripPossessivePrefix(text: string): string {
  const m = text.match(/^mi\s+\w+\s+(.+)/i);
  if (m && m[1]?.trim()) return m[1].trim();
  return text;
}
