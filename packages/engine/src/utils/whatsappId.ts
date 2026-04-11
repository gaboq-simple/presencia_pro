// ─── WhatsApp ID — Normalización canónica ─────────────────────────────────────
// Normaliza cualquier identificador de WhatsApp recibido del webhook de Meta
// a un formato estable y único antes de persistirlo o usarlo como clave.
//
// Hoy: todos los identificadores son números de teléfono.
// Futuro: Meta planea introducir usernames — este módulo los manejará aquí.

/**
 * Normaliza un identificador de WhatsApp a formato canónico.
 *
 * Transformaciones aplicadas (en orden):
 *   1. Quita el '+' inicial si existe
 *   2. Elimina espacios en blanco
 *   3. Si el resultado son 10 dígitos, agrega prefijo '52' (México sin código de país)
 *   4. Si el resultado es '52' + 10 dígitos sin el '1' de larga distancia,
 *      normaliza a '521XXXXXXXXXX' (formato que usa WhatsApp Business API para México)
 *
 * Ejemplos:
 *   '+5215512345678' → '5215512345678'
 *   '521551234567'   → '521551234567'    (ya normalizado)
 *   '5215512345678'  → '5215512345678'   (ya normalizado)
 *   '5512345678'     → '525512345678'    (10 dígitos → agrega '52')
 *   '525512345678'   → '5215512345678'   (52 + 10 dígitos sin '1' → agrega '1')
 *
 * @param raw - Identificador tal como llega del webhook (campo `from`)
 */
export function normalizeWhatsAppId(raw: string): string {
  // Paso 1 y 2: quitar '+' inicial y espacios
  const cleaned = raw.replace(/^\+/, '').replace(/\s/g, '');

  // Paso 3: número mexicano de 10 dígitos sin código de país → agregar '52'
  if (/^\d{10}$/.test(cleaned)) {
    return `52${cleaned}`;
  }

  // Paso 4: número mexicano de 12 dígitos con '52' pero sin el '1' de larga distancia
  // Formato WhatsApp para México: 521 + 10 dígitos
  // Si llega como 52 + 10 dígitos (sin '1') → normalizar a 521 + 10 dígitos
  if (/^52\d{10}$/.test(cleaned) && !cleaned.startsWith('521')) {
    return `521${cleaned.slice(2)}`;
  }

  return cleaned;
}

/**
 * Determina el tipo del identificador de WhatsApp.
 * Hoy todos los identificadores son números de teléfono.
 * Preparado para usernames cuando Meta los introduzca en la API.
 *
 * @param id - Identificador ya normalizado
 */
export function getWhatsAppIdType(id: string): 'phone' | 'username' {
  return /^\d+$/.test(id) ? 'phone' : 'username';
}
