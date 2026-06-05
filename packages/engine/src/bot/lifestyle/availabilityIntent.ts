// ─── Lifestyle Bot — Detector de pregunta de disponibilidad (FASE B) ──────────
// Bot propositivo: cuando el cliente PREGUNTA por horarios/disponibilidad
// ("¿qué horario hay mañana?", "¿a qué hora tienes?"), el bot debe CONSULTAR la
// agenda y OFRECER slots reales en lenguaje natural, en vez de seguir preguntando.
//
// Detector puro y determinista: sin red, sin LLM. Se usa para decidir el ruteo
// hacia SHOWING_SLOTS con auto-asignación ("el que sea"). NO resuelve barbero
// específico — eso es de otro sprint.

const AVAILABILITY_PATTERNS: RegExp[] = [
  /\bqu[eé]\s+horarios?\b/,                          // "qué horario(s) hay/tienes"
  /\bqu[eé]\s+horas?\b/,                             // "qué hora(s) hay/tienes"
  /\ba\s+qu[eé]\s+horas?\b/,                         // "a qué hora(s) tienes"
  /\bqu[eé]\s+disponibilidad\b/,                     // "qué disponibilidad"
  /\b(tienes|tienen|hay)\s+disponibilidad\b/,        // "tienes/hay disponibilidad"
  /\bhorarios?\s+disponibles?\b/,                    // "horarios disponibles"
  /\bcu[aá]ndo\s+(tienes|tienen|hay|puedo|se\s+puede|podr[ií]a)\b/, // "cuándo tienes/hay/puedo"
  /\bqu[eé]\s+espacios?\b/,                          // "qué espacios hay"
  /\bqu[eé]\s+(tienes|hay)\s+disponible/,            // "qué tienes disponible"
  /\bqu[eé]\s+d[ií]as?\s+(tienes|hay|tienen)\b/,     // "qué días tienes/hay"
];

/**
 * Retorna true si el texto es una PREGUNTA de disponibilidad por horario/fecha.
 * No matchea peticiones directas tipo "quiero un corte mañana" (esas siguen el
 * flujo normal de calificación).
 */
export function isAvailabilityQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  return AVAILABILITY_PATTERNS.some((re) => re.test(lower));
}
