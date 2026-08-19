// ─── opt-out — "BAJA" se entiende a la primera, sin IA (S8-PER-01 · P2) ──────
// Módulo puro (sin DB, sin red, sin React). Detecta que alguien pidió dejar de
// recibir mensajes, y nada más.
//
// **Por qué determinista y no un intent del clasificador.** Hoy un "BAJA" llega
// al clasificador, que conoce siete intents y ninguno es opt-out, así que cae en
// UNCLEAR y el cliente recibe *"Disculpa, no entendí bien tu mensaje. ¿Puedes
// reformularlo?"* — el peor mensaje posible para alguien que pidió que lo dejen
// en paz. Y agregarle el intent al clasificador no arregla el fondo: **un
// opt-out no puede depender del humor de un modelo.** Si un día el LLM está
// lento, devuelve mal el JSON o cambia de versión, la baja se pierde y el
// negocio le sigue escribiendo a alguien que dijo que no. Una lista cerrada
// falla de una sola manera y se puede leer entera en diez segundos.
//
// **Por qué la lista es corta y no un catálogo de sinónimos.** Cada frase que se
// agrega acerca el matcher a un falso positivo, y un falso positivo acá es
// silenciar a un cliente que no pidió nada. Las nueve de la lista cubren lo que
// la gente realmente escribe; para lo demás está el fallback, que ahora sí es
// una respuesta apropiada.

/** Quita acentos y baja a minúsculas — "BAJA", "Baja" y "bája" son lo mismo. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Frases que se aceptan como MENSAJE COMPLETO, no contenidas.
 *
 * El anclaje al mensaje entero es lo que evita el falso positivo del plan
 * —"quiero darme de baja del gimnasio"—: ahí "baja" aparece, pero el mensaje no
 * ES "baja". La misma lección que `isAffirmation` en `confirmingAppointment.ts`,
 * donde los tokens cortos exigen match completo por la misma razón.
 */
const FRASES_EXACTAS = [
  'baja',
  'stop',
  'no me manden mensajes',
  'no quiero mensajes',
  'dejen de escribir',
  'dejen de escribirme',
  'no me escriban',
  'darme de baja',
  'quiero darme de baja',
];

/** Puntuación y espacios de sobra: "¡BAJA!" y "baja." son "baja". */
function limpiar(s: string): string {
  return normalizar(s).replace(/[.,;:!¡?¿"'()]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * ¿El mensaje ES una petición de baja?
 *
 * `false` ante la duda, siempre: un falso negativo lo corrige el cliente
 * escribiendo otra vez (y el fallback lo invita a hacerlo); un falso positivo
 * silencia a alguien que no pidió nada y solo se descubre cuando reclama.
 */
export function isOptOutCommand(body: string): boolean {
  if (typeof body !== 'string') return false;
  const limpio = limpiar(body);
  if (limpio.length === 0) return false;
  return FRASES_EXACTAS.includes(limpio);
}

/**
 * La única confirmación, y no hay más.
 *
 * Va dentro de la ventana de 24 h —el cliente acaba de escribir—, así que es
 * texto libre y llega sin plantilla. Sin oferta de quedarse, sin encuesta de
 * salida, sin "¿estás seguro?": pedir que lo dejen en paz y recibir una
 * negociación es exactamente lo que la persona quería evitar. La segunda frase
 * existe para que la baja no se sienta una puerta cerrada con llave.
 */
export const OPT_OUT_CONFIRMATION =
  'Listo, no te volveremos a enviar mensajes. Si un día quieres agendar de nuevo, aquí estamos.';
