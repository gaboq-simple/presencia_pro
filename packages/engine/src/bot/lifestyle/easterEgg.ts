// ─── Easter Egg ───────────────────────────────────────────────────────────────
// Comando oculto: si el body normalizado (trim + lowercase) coincide con el
// código secreto, devuelve un mensaje festivo fijo. Para cualquier otro mensaje
// devuelve null (no dispara). Pura y determinista — sin red, sin DB, sin LLM.
//
// El handler del webhook intercepta este comando ANTES del buffer/FSM/estado:
// si devuelve una cadena, responde con ella y corta el flujo sin tocar
// bot_conversations.

const EASTER_EGG_COMMAND = '69b741';
const EASTER_EGG_MESSAGE = '¡Feliz cumpleaños, ermabog! Hora de hacer GAZILLIONS';

export function checkEasterEgg(body: string): string | null {
  if (body.trim().toLowerCase() === EASTER_EGG_COMMAND) {
    return EASTER_EGG_MESSAGE;
  }
  return null;
}
