/**
 * Construye la URL de enlace directo a WhatsApp.
 * @param phone  Número en formato internacional solo dígitos (ej. 5215512345678)
 * @param message Mensaje preescrito — será URL-encoded
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
