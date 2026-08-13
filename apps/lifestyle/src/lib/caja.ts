// ─── Caja — movimientos fuera de agenda: validación PURA (D4) ─────────────────
// Sin DB, sin red, sin React. Traduce lo que tecleó una persona a la fila que la
// action inserta en `caja_movimientos`.
//
// POR QUÉ EXISTE: hay dinero que nunca pasa por la agenda — alguien entró sin
// cita, se vendió una cera, se pagaron toallas, el dueño retiró efectivo. Si eso
// no entra al sistema, el descuadre POSITIVO del corte (sobra efectivo) es
// indistinguible de un error de conteo, que es justo la confusión que la capa de
// dinero existe para deshacer. La captura es pura: acá no se calcula nada, se
// valida y se nombra.
//
// El CHECK pareado de la migración D1 vive también acá, a propósito. La BD ya lo
// impide (una "salida por producto" no significa nada y la fila no entra), pero un
// 23514 crudo le dice a la persona "new row violates check constraint" — este
// módulo lo dice en su idioma ANTES de ir a la BD. La BD sigue siendo la que
// manda; esto es cortesía, no la garantía.

import { resolveCobro, esCobroError, type Rail } from './cobro';

export const MOV_TYPES = ['entrada', 'salida'] as const;
export type MovimientoType = (typeof MOV_TYPES)[number];

/**
 * Conceptos por tipo — ESPEJO EXACTO de `caja_movimientos_concept_check`
 * (migración 20260812000000_capa_dinero.sql). Si un día se agrega un concepto,
 * se agrega en los dos lados o la fila la rebota la BD.
 */
export const CONCEPTOS_POR_TIPO = {
  entrada: ['walkin', 'producto', 'otro'],
  salida:  ['insumos', 'retiro', 'otro'],
} as const satisfies Record<MovimientoType, readonly string[]>;

export type Concepto = (typeof CONCEPTOS_POR_TIPO)[MovimientoType][number];

/** La nota es libre y CORTA (plan D1). El tope evita que la caja se use de libreta. */
export const NOTA_MAX = 120;

// ─── Copy ─────────────────────────────────────────────────────────────────────
// Mexicano neutro, cero fiscal, cero juicio: esto es control de caja, no
// contabilidad. Ningún concepto acusa a nadie — "retiro" es un hecho, no un
// reproche.

const TIPO_LABEL: Record<MovimientoType, string> = {
  entrada: 'Entró',
  salida:  'Salió',
};

// 'walkin' se rinde como "Sin cita" y NO como "Walk-in" a propósito: la mesa ya
// tiene un botón "+ Walk-in" que crea una CITA (que después se cobra al
// completarla, por el riel de D2). Este concepto es lo contrario — dinero de
// alguien que nunca tuvo fila en la agenda. Con la misma palabra, las dos cosas
// se confunden justo donde importa no confundirlas.
const CONCEPTO_LABEL: Record<string, string> = {
  walkin:   'Sin cita',
  producto: 'Producto',
  insumos:  'Insumos',
  retiro:   'Retiro',
  otro:     'Otro',
};

// Ejemplos de COSAS, nunca de personas: la nota fluye a Actividad, que el dueño
// lee, y un nombre de cliente escrito ahí es PII que nadie pidió guardar (queda
// anotado en la deuda de retención, SPRINT S6-SEC-01). El placeholder es la única
// pista que la mayoría va a leer — que invite a lo operativo.
const NOTA_PLACEHOLDER: Record<string, string> = {
  walkin:   'Ej. corte sin cita',
  producto: 'Ej. cera y shampoo',
  insumos:  'Ej. toallas y navajas',
  retiro:   'Ej. pago de la renta',
  otro:     'Ej. para qué fue',
};

export function etiquetaTipo(t: MovimientoType): string {
  return TIPO_LABEL[t];
}

export function etiquetaConcepto(c: string): string {
  return CONCEPTO_LABEL[c] ?? c;
}

export function notaPlaceholder(c: string): string {
  return NOTA_PLACEHOLDER[c] ?? NOTA_PLACEHOLDER['otro']!;
}

/** $1,250 — sin centavos si es entero (el caso normal en un cajón). */
export function fmtMonto(n: number): string {
  return `$${n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })}`;
}

// ─── Validación ───────────────────────────────────────────────────────────────

export type MovimientoInput = {
  type?:    string | null;
  concept?: string | null;
  /** Tecleado por la persona. A diferencia del cobro de una cita, acá es OBLIGATORIO. */
  amount?:  number | string | null;
  method?:  string | null;
  note?:    string | null;
};

export type MovimientoResuelto = {
  type:    MovimientoType;
  concept: string;
  amount:  number;
  method:  Rail;
  note:    string | null;
};

export type MovimientoError = { error: string };

export function esMovimientoError(r: MovimientoResuelto | MovimientoError): r is MovimientoError {
  return 'error' in r;
}

function isTipo(v: unknown): v is MovimientoType {
  return typeof v === 'string' && (MOV_TYPES as readonly string[]).includes(v);
}

/**
 * Resuelve un movimiento de caja a la fila que se va a insertar.
 *
 * Devuelve `{ error }` (no `throw`) para todo lo que una PERSONA puede corregir —
 * el patrón de `resolveCobro`, por la misma razón: Next redacta los throw de
 * server actions en producción y la persona vería "algo salió mal".
 *
 * El monto y el riel se parsean con `resolveCobro` (una sola definición de "qué
 * es un monto válido" en toda la capa), con UNA diferencia: acá vacío es error.
 * En una cita, monto vacío significa "cobré el precio de siempre" y lo sella el
 * trigger; un movimiento no tiene precio de lista del que caerse.
 */
export function resolveMovimiento(input: MovimientoInput): MovimientoResuelto | MovimientoError {
  const type = input.type;
  if (!isTipo(type)) {
    return { error: 'Falta decir si el dinero entró o salió' };
  }

  const concept = input.concept ?? '';
  const permitidos: readonly string[] = CONCEPTOS_POR_TIPO[type];
  if (!permitidos.includes(concept)) {
    return { error: `Ese concepto no va con "${TIPO_LABEL[type].toLowerCase()}"` };
  }

  const cobro = resolveCobro({ amount: input.amount, method: input.method });
  if (esCobroError(cobro)) return cobro;
  if (cobro.amount === undefined) {
    return { error: 'Falta el monto' };
  }

  const notaCruda = (input.note ?? '').trim();
  if (notaCruda.length > NOTA_MAX) {
    return { error: `La nota es muy larga (máximo ${NOTA_MAX} caracteres)` };
  }

  return {
    type,
    concept,
    amount: cobro.amount,
    method: cobro.method,
    note: notaCruda === '' ? null : notaCruda,
  };
}

// ─── Frase de un movimiento ───────────────────────────────────────────────────

export type MovimientoDescribible = {
  type:    string;
  concept: string;
  amount:  number;
  method:  string;
  /** Contraentrada: esta fila anula a otra (reverses_id no nulo). */
  anula?:  boolean;
};

/**
 * "entrada de $150 · sin cita · efectivo" — el mismo texto en las tres
 * superficies (lista del día, hoja de confirmación y Actividad). Sin actor: cada
 * superficie sabe quién lo firmó y lo antepone.
 *
 * Una contraentrada se nombra como lo que es (una anulación), nunca como un
 * movimiento más: sumarlas de nuevo al leerlas sería contar el mismo dinero dos
 * veces con signo cambiado.
 */
export function describeMovimiento(m: MovimientoDescribible): string {
  // En la contraentrada el concepto se OMITE: es 'otro' por construcción (no hay
  // concepto compatible del otro lado del CHECK) y leer "anuló un movimiento de
  // $250 · otro · tarjeta" no informa nada — el concepto que importa es el de la
  // fila anulada, que está ahí arriba en la misma lista.
  if (m.anula) return `anuló un movimiento de ${fmtMonto(m.amount)} · ${m.method}`;
  return `registró una ${m.type === 'salida' ? 'salida' : 'entrada'} de ` +
    `${fmtMonto(m.amount)} · ${etiquetaConcepto(m.concept).toLowerCase()} · ${m.method}`;
}
