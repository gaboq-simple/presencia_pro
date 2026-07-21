// ─── Lifestyle Bot — Detección de intención de cancelar/modificar ─────────────
// Módulo PURO (sin DB/red/LLM), estilo sideQuestion/availabilityIntent.
//
// Historia: estas listas vivían privadas en router.ts y solo servían al estado
// CONFIRMED (misma conversación, <24h). AUD-02 las extrae para que también las
// consuma la intercepción en GREETING (cancelar "al día siguiente", cuando la
// conversación ya se reseteó) y el fast-path de servicio único de
// qualifyingService (que consumía "cancelar mi cita" como avance de reserva).

const MODIFICATION_KEYWORDS = [
  'cambiar', 'modificar', 'mover', 'otra hora', 'reagendar',
  'cambio de hora', 'mejor a las', 'prefiero a las', 'a otra hora',
  'diferente hora', 'cambiarla', 'cambiarme', 'moverla', 'moverme',
];

const CANCELLATION_KEYWORDS = [
  'cancelar', 'ya no puedo', 'no voy a ir', 'anular', 'quitar la cita',
  'no puedo ir', 'cancela', 'no voy', 'cancelen', 'cancelame',
];

export function isModificationIntent(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return MODIFICATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isCancellationIntent(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return CANCELLATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Variante de precisión para GREETING: además del keyword de modificación,
 * exige que el mensaje mencione "cita". En CONFIRMED el contexto desambigua
 * ("cambiar" solo puede referirse a la cita recién agendada), pero en GREETING
 * un "cambiar"/"otra hora" suelto puede ser cualquier cosa — exigir "cita"
 * evita secuestrar mensajes que no hablan de una cita existente.
 */
export function wantsToModifyExistingAppointment(body: string): boolean {
  const lower = body.trim().toLowerCase();
  return isModificationIntent(body) && /\bcita\b/.test(lower);
}
