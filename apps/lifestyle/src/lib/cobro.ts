// ─── Cobro — validación PURA del dinero que entra al completar una cita ───────
// Sin DB, sin red, sin React. Traduce lo que tecleó una persona (o lo que NO
// tecleó) a los dos campos que la action escribe: `price_charged` y
// `payment_method`.
//
// La regla de fondo (plan capa-de-dinero, D2): completar una cita registra cuánto
// entró DE VERDAD y por qué riel, sin romper el swipe de 2 segundos. De ahí las
// dos asimetrías de este módulo, que no son casualidad:
//
//   · El RIEL siempre sale con valor (default 'efectivo'). Es la decisión 2 del
//     plan: el riel jamás queda NULL en filas nuevas por construcción, no por
//     validación — un movimiento sin riel no se puede comparar contra ningún
//     artefacto físico y por lo tanto no sirve para cuadrar.
//   · El MONTO sale `undefined` si la persona no lo editó, y eso es deliberado:
//     así la action NO escribe `price_charged` y el precio de lista lo sella el
//     trigger `seal_appointment_price` (que solo rellena cuando está NULL). Si
//     escribiéramos el precio de lista explícitamente estaríamos afirmando "una
//     persona vio y confirmó este monto" cuando nadie lo miró.

export const RAILS = ['efectivo', 'tarjeta', 'transferencia'] as const;
export type Rail = (typeof RAILS)[number];

export const DEFAULT_RAIL: Rail = 'efectivo';

/** Techo alineado con MAX_TIP y con numeric(10,2) de la BD. */
export const MAX_COBRO = 99_999_999.99;

/** Lo que la UI recolecta. Ambos opcionales: no tocar nada es el caso normal. */
export type CobroInput = {
  /** Monto tecleado por la persona. `undefined`/'' = no lo editó. */
  amount?: number | string | null;
  method?: string | null;
};

/** Lo que la action escribe. `amount: undefined` = no escribir price_charged. */
export type CobroResuelto = {
  amount:  number | undefined;
  method:  Rail;
};

export type CobroError = { error: string };

function isRail(v: unknown): v is Rail {
  return typeof v === 'string' && (RAILS as readonly string[]).includes(v);
}

/**
 * Resuelve el cobro de una cita que se está completando.
 *
 * Devuelve `{ error }` para lo que una PERSONA puede corregir (monto imposible,
 * riel desconocido) — el patrón `{ error }` y no `throw` porque Next redacta los
 * throw de server actions en producción (lección de S6-SEC-02).
 *
 * `listPrice` no se usa para rellenar el monto (de eso se encarga el trigger);
 * se acepta para que el caller pueda mostrarlo y para dejar la firma estable
 * cuando D6 necesite comparar contra la lista.
 */
export function resolveCobro(input: CobroInput | undefined, _listPrice?: number): CobroResuelto | CobroError {
  const method = input?.method == null || input.method === '' ? DEFAULT_RAIL : input.method;
  if (!isRail(method)) {
    return { error: `Método de pago no válido: ${String(input?.method)}` };
  }

  const raw = input?.amount;
  if (raw == null || raw === '') {
    // Nadie editó el monto → el trigger sella el precio de lista.
    return { amount: undefined, method };
  }

  const amount = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount)) {
    return { error: 'El monto no es un número' };
  }
  if (amount <= 0) {
    return { error: 'El monto debe ser mayor a cero' };
  }
  if (amount > MAX_COBRO) {
    return { error: 'El monto es demasiado grande' };
  }

  // Centavos: la columna es numeric(10,2) y un tercer decimal se perdería en la
  // BD sin avisar — se redondea acá para que lo guardado sea lo que se muestra.
  return { amount: Math.round(amount * 100) / 100, method };
}

/** Type guard para el caller. */
export function esCobroError(r: CobroResuelto | CobroError): r is CobroError {
  return 'error' in r;
}
