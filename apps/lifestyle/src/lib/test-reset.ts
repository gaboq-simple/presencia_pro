// ─── Test reset command — guardas puras ───────────────────────────────────────
// Lógica determinista del comando de reset SOLO para pruebas. Sin deps de Next,
// Supabase ni red → unit-testable en el harness node:test.
//
// La capa de route (api/bot/route.ts) lee process.env['TEST_PHONE_ALLOWLIST'] y
// la inyecta aquí como parámetro (mismo patrón de inyección que message-buffer-core).
// El efecto de I/O (UPDATE en bot_conversations) vive en route.ts — aquí solo las
// guardas.

export const TEST_RESET_TRIGGER      = '/reset-bot';
export const TEST_RESET_CONFIRMATION = '\u2705 Conversación reseteada (modo prueba)';

/** Normaliza un teléfono para comparar: quita espacios y un '+' inicial. */
export function normalizeTestPhone(phone: string): string {
  return phone.trim().replace(/^\+/, '');
}

/**
 * Guarda 1 (allowlist): true si el teléfono está en la allowlist (CSV).
 * Falla cerrado: allowlist ausente/vacía o teléfono vacío → false.
 */
export function isTestPhoneAllowlisted(
  customerPhone: string,
  rawAllowlist: string | undefined,
): boolean {
  if (!rawAllowlist) return false; // ausente o vacía → fail-closed
  const target = normalizeTestPhone(customerPhone);
  if (target.length === 0) return false;
  return rawAllowlist
    .split(',')
    .map(normalizeTestPhone)
    .filter((p) => p.length > 0)
    .includes(target);
}

/**
 * Doble guarda del comando de reset de prueba:
 *   1. El texto es EXACTAMENTE el trigger (no substring) → "quiero resetear mi
 *      cita" o "/reset-bot porfa" NO lo disparan.
 *   2. El teléfono está en la allowlist.
 * Si cualquiera falla → false → el mensaje sigue el flujo normal del FSM,
 * idéntico a cualquier otro mensaje.
 */
export function isTestResetCommand(
  customerPhone: string,
  messageBody: string,
  rawAllowlist: string | undefined,
): boolean {
  if (messageBody.trim() !== TEST_RESET_TRIGGER) return false; // guarda 2
  return isTestPhoneAllowlisted(customerPhone, rawAllowlist);  // guarda 1
}
