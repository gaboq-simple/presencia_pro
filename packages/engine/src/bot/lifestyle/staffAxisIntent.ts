// ─── Lifestyle Bot — Detector de eje-barbero (A1, S5-BOT-04) ──────────────────
// Puro y determinista: sin DB, sin red, sin LLM. Estilo availabilityIntent.ts /
// sideQuestion.ts. Decide si el cliente quiere ELEGIR barbero (eje a) o si
// PREGUNTA quién lo atiende de forma ambigua (eje b).
//
// El nombre concreto de un barbero lo resuelve `resolveStaff` en qualifyingStaff;
// este módulo NO lo duplica. Por eso los detectores son token-based ("quién",
// "qué barbero", "puedo elegir") y no intentan reconocer nombres propios.

// Normaliza igual que confirmingAppointment.ts/sideQuestion.ts: minúsculas +
// NFD + strip de diacríticos. Al trabajar sobre ASCII puro, \b es seguro
// (su boundary solo falla ANTES del strip, frente a caracteres acentuados).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Eje (a): frases inequívocas de "quiero elegir barbero" / "qué barberos hay".
const CHOOSE_STAFF_PATTERNS: RegExp[] = [
  /\bque\s+barber[oa]s?\b/,                  // "qué barberos hay/tienen"
  /\bcuales?\s+barber[oa]s?\b/,              // "cuáles barberos"
  /\bquien(?:es)?\s+(hay|tienen|trabajan|atienden|estan|son)\b/, // "quiénes atienden/hay"
  /\bpuedo\s+(elegir|escoger|pedir)\b/,      // "puedo elegir/escoger"
  /\b(elegir|escoger)\s+barber[oa]/,         // "elegir barbero"
  /\bopciones?\s+de\s+barber[oa]/,           // "opciones de barbero"
  /\bcon\s+quien\s+(puedo|me\s+puedo)\b/,    // "con quién puedo"
];

/**
 * Eje (a): el cliente quiere elegir barbero o saber qué barberos hay.
 * NO matchea un nombre concreto (eso es de resolveStaff).
 */
export function wantsToChooseStaff(msg: string): boolean {
  const n = normalize(msg.trim());
  if (!n) return false;
  return CHOOSE_STAFF_PATTERNS.some((re) => re.test(n));
}

// Token de "quién / qué barbero" para el eje (b). Acotado (no substring ávido):
// "quien"/"quienes" como palabra, "con quien", "qué barbero(s)".
const WHO_TOKEN_RE = /\bquien(?:es)?\b|\bcon\s+quien\b|\bque\s+barber[oa]s?\b/;

/**
 * Eje (b): pregunta-sobre-quién ambigua — interrogación (¿/?) + token de
 * "quién"/"qué barbero", SIN señal de elección explícita ni nombre concreto.
 * Ej: "¿con quién sería?", "¿quién me toca?", "¿qué barbero está para las 12?".
 * El "?" por sí solo NO basta: exige el token de barbero.
 */
export function asksWhoOnly(msg: string): boolean {
  const raw = msg.trim();
  if (!raw) return false;
  if (!/[¿?]/.test(raw)) return false;
  const n = normalize(raw);
  return WHO_TOKEN_RE.test(n);
}
