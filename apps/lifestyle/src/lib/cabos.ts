// ─── Cabos sueltos — matemática PURA (sin DB, sin red, sin React) ─────────────
// Un "cabo suelto" es una cita que YA PASÓ y sigue sin resolver: nadie marcó si
// el cliente llegó, no llegó, o si se canceló. Queda ahí, `pending` o
// `confirmed`, con su hora en el pasado.
//
// POR QUÉ IMPORTA EN LA CAPA DE DINERO: una cita sin resolver no es neutral —
// es un número que no existe. No suma al cobrado (no está `completed`) y
// tampoco cuenta como falta (no está `no_show`), así que **desaparece del
// cuadre sin dejar rastro**. Si el descuadre del día sale positivo, un cabo
// suelto es una de las explicaciones posibles, y lo peor que puede hacer la app
// es absorberlo en un total y no mostrarlo. De ahí la regla del plan: "lo
// pasado sin resolver se ve, nunca se absorbe".
//
// Frontera con el auto-cancel: el cron (`dispatch-auto-cancel`) resuelve solo
// las `confirmed` que pasaron su `auto_cancel_after_minutes` y a las que NADIE
// marcó como llegadas. Lo que queda acá es lo que el cron NO toca: las
// `pending` (nunca confirmadas) y las `confirmed` con `arrived_at` — el cliente
// llegó y nadie cerró la cita. Son cabos de PERSONAS, no de máquina.

/** Ventana hacia atrás: más allá de esto ya no es un cabo suelto, es historia. */
export const VENTANA_CABOS_DIAS = 14;

export type CitaSinResolver = {
  id:         string;
  startsAtMs: number;
  status:     string;
  /** El cliente llegó (botón "Llegó") pero nadie cerró la cita. */
  llego:      boolean;
  cliente:    string | null;
};

export type Cabos = {
  total:    number;
  /** Ordenados del más viejo al más reciente: lo que lleva más tiempo colgando
   *  es lo que más urge cerrar, no lo de ayer. */
  lista:    CitaSinResolver[];
  /** De los que el cliente sí llegó — el subconjunto donde ALGUIEN cobró y
   *  nadie lo registró, que es el que puede estar tapando dinero. */
  conLlegada: number;
};

const ESTADOS_SIN_RESOLVER = new Set(['pending', 'confirmed']);

/**
 * Cabos sueltos de una lista de citas, contra un "ahora" explícito.
 *
 * `ahoraMs` se inyecta (no se lee el reloj acá) para que la función sea
 * determinista y testeable — el patrón de `lib/pulso.ts` y `lib/cadence.ts`.
 */
export function computeCabos(
  citas: readonly CitaSinResolver[],
  ahoraMs: number,
  ventanaDias: number = VENTANA_CABOS_DIAS,
): Cabos {
  const desdeMs = ahoraMs - ventanaDias * 24 * 60 * 60_000;

  const lista = citas
    .filter((c) => ESTADOS_SIN_RESOLVER.has(c.status))
    .filter((c) => c.startsAtMs < ahoraMs && c.startsAtMs >= desdeMs)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);

  return {
    total:      lista.length,
    lista,
    conLlegada: lista.filter((c) => c.llego).length,
  };
}

/**
 * Copy del conteo. Dato y nada más: sin juicio, sin regaño — el plan prohíbe
 * explícitamente los "descuadre grave" y equivalentes. Singular/plural correctos
 * porque "1 citas" es la clase de detalle que hace que nadie confíe en el resto.
 */
export function etiquetaCabos(total: number): string {
  if (total === 0) return 'Todo el día está cerrado';
  return total === 1 ? '1 cita sin cerrar' : `${total} citas sin cerrar`;
}
