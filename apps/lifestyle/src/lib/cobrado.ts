// ─── Cobrado — LA regla del titular del dueño (D6) ────────────────────────────
// Sin DB, sin red, sin React. Una sola definición de "cuánto entró hoy", que es
// la que el dueño ve a diario, la que el corte compara y la que el aviso de
// WhatsApp repite. Si hubiera dos, tarde o temprano dirían números distintos y
// el dueño dejaría de creerle a los dos.
//
// El cambio de fondo respecto de lo que había: el titular era **derivado** —
// agenda × precio de lista— y pasa a ser **confirmado**: eventos que una persona
// firmó. Tres consecuencias que este módulo hace explícitas:
//
//   1. **Atribución por `completed_at` local**, no por `starts_at`. El dinero
//      cuenta cuando se cobró. Una cita de ayer cobrada hoy es de hoy; una de
//      hoy que nadie completó no es de nadie todavía. Es la MISMA regla de
//      `lib/corte.ts`, y por eso los dos módulos consumen la misma query
//      (`getInsumosDelCorte`): una regla, una implementación.
//
//   2. **Los tres rieles suman**, transferencia incluida. El corte deja las
//      transferencias fuera de SU comparación porque no hay artefacto físico que
//      contar — pero el dinero entró igual, y el titular es cuánto entró.
//
//   3. **Las salidas JAMÁS se netean.** Un día de $1,700 con $120 de salidas no
//      es un día de $1,580: son dos hechos distintos y el segundo no corrige al
//      primero. Netearlos esconde las dos mitades a la vez — cuánto se vendió y
//      cuánto se gastó— detrás de un número que no es ninguna de las dos.

/** Una cita ya cobrada del día. Mismo shape que el insumo del corte. */
export type CitaCobradaHoy = { amount: number };

/** Un movimiento de caja del día (D4). */
export type MovimientoDelDia = { type: string; amount: number };

export type Cobrado = {
  /** El titular: lo de la agenda + lo de fuera de ella. NUNCA menos las salidas. */
  total:    number;
  /** Citas completadas hoy (por `completed_at` local). */
  deAgenda: number;
  /** Entradas de caja de hoy: walk-in sin cita, producto, otro. */
  entradas: number;
  /** Salidas del día. Línea APARTE, jamás restada del total. */
  salidas:  number;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function suma(xs: readonly { amount: number }[]): number {
  return redondear(xs.reduce((t, x) => t + x.amount, 0));
}

/**
 * El cobrado de un día. `citas` y `movimientos` llegan ya acotados al día LOCAL
 * del negocio — la atribución la hace la capa de datos, la aritmética se hace
 * acá, y así el resultado es determinista y testeable.
 */
export function computeCobrado(
  citas: readonly CitaCobradaHoy[],
  movimientos: readonly MovimientoDelDia[],
): Cobrado {
  const deAgenda = suma(citas);
  const entradas = suma(movimientos.filter((m) => m.type === 'entrada'));
  const salidas  = suma(movimientos.filter((m) => m.type === 'salida'));

  return {
    total: redondear(deAgenda + entradas),
    deAgenda,
    entradas,
    salidas,
  };
}
