// ─── Atajos de caja: el orden y los montos los pone el negocio ────────────────
// Módulo PURO: sin DB, sin red, sin React. M3 de S10-ASIS-01.
//
// POR QUÉ EXISTE. El catálogo de conceptos creció (la salida pasó de 3 opciones a
// 7) para dejar de colapsar la renta con un retiro. Más opciones no cuestan taps
// —sigue siendo UNA— pero sí cuestan lectura, y el riesgo real de un catálogo que
// se lee lento no es que moleste: es que la gente deje de registrar. Un
// movimiento MAL CATEGORIZADO es un dato imperfecto; uno NO REGISTRADO es un
// agujero que después se lee como "no pasó nada".
//
// LA REGLA: la categoría es una comodidad del que LEE, nunca un peaje del que
// ESCRIBE. Por eso acá no hay validación nueva, no hay campo obligatorio y no hay
// nada que bloquee: solo se REORDENA lo que ya existe, con los propios datos del
// negocio.
//
// `otro` NO ESTÁ FIJADO AL FINAL, y es a propósito. Se ordena por uso como
// cualquier otro concepto: si una barbería registra casi todo en `otro`, va a
// verlo primero, porque el sistema sirve a quien lo usa. Y el hecho de que `otro`
// domine no se esconde — se ve en la lectura por concepto, que es donde el dueño
// puede decidir que hace falta una categoría nueva. Penalizar el escape es la
// forma más rápida de que alguien deje de anotar.
//
// DETERMINISTA Y SIN INVENTO: cuenta filas, ordena, corta. Nada aprendido de otros
// negocios, nada estadístico, nada que no se pueda explicar señalando las filas.

import { CONCEPTOS_POR_TIPO, type MovimientoType } from './caja';

/** Lo mínimo que hace falta de cada fila del histórico. */
export type MovimientoHistorico = {
  id: string;
  type: string;
  concept: string;
  amount: number;
  /** Si apunta a otra fila, ESTA es una contraentrada (anula a la otra). */
  reversesId: string | null;
};

export type AtajosDeCaja = {
  /** Conceptos ordenados por uso real, por tipo. Siempre el catálogo completo. */
  orden: Record<MovimientoType, string[]>;
  /** Montos que se repiten, por concepto. Vacío cuando no hay evidencia. */
  montos: Record<string, number[]>;
};

/** Un concepto necesita AL MENOS esto para ofrecer atajos de monto. */
export const MIN_MOVS_PARA_MONTOS = 3;
/** Y un monto tiene que haberse repetido al menos esto para ser un atajo. */
export const MIN_REPETICIONES = 2;
/** Nunca más de tres: el atajo compite con el teclado, no lo reemplaza. */
export const MAX_MONTOS = 3;

/**
 * Descarta las contraentradas Y los movimientos que ellas anulan.
 *
 * Una anulación es la marca de un error, no un hábito: contar el movimiento
 * anulado enseñaría el atajo equivocado, y contar la contraentrada enseñaría un
 * concepto (`otro`, siempre) que nadie eligió.
 */
export function sinAnulados(movs: MovimientoHistorico[]): MovimientoHistorico[] {
  const anulados = new Set(movs.map((m) => m.reversesId).filter((x): x is string => x !== null));
  return movs.filter((m) => m.reversesId === null && !anulados.has(m.id));
}

export function calcularAtajos(historico: MovimientoHistorico[]): AtajosDeCaja {
  const utiles = sinAnulados(historico);

  // ── Orden de conceptos ──────────────────────────────────────────────────────
  const usos = new Map<string, number>();
  for (const m of utiles) usos.set(`${m.type}|${m.concept}`, (usos.get(`${m.type}|${m.concept}`) ?? 0) + 1);

  const orden = {} as Record<MovimientoType, string[]>;
  for (const tipo of Object.keys(CONCEPTOS_POR_TIPO) as MovimientoType[]) {
    const catalogo = [...CONCEPTOS_POR_TIPO[tipo]] as string[];
    orden[tipo] = catalogo
      .map((c, i) => ({ c, i, n: usos.get(`${tipo}|${c}`) ?? 0 }))
      // Más usado primero; empate → el orden del catálogo, que es estable. Sin el
      // desempate, dos conceptos con el mismo uso podrían intercambiarse entre
      // renders y el pulgar aprendería una posición que después se mueve.
      .sort((a, b) => (b.n - a.n) || (a.i - b.i))
      .map((x) => x.c);
  }

  // ── Montos frecuentes por concepto ──────────────────────────────────────────
  const porConcepto = new Map<string, number[]>();
  for (const m of utiles) {
    const arr = porConcepto.get(m.concept) ?? [];
    arr.push(m.amount);
    porConcepto.set(m.concept, arr);
  }

  const montos: Record<string, number[]> = {};
  for (const [concepto, valores] of porConcepto) {
    // Sin historia suficiente NO se ofrece nada. Un atajo derivado de dos filas no
    // es un hábito, es una coincidencia — y un atajo equivocado hace más daño que
    // la ausencia de atajo, porque se toca sin mirar.
    if (valores.length < MIN_MOVS_PARA_MONTOS) continue;

    const cuenta = new Map<number, number>();
    for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);

    const top = [...cuenta.entries()]
      .filter(([, n]) => n >= MIN_REPETICIONES)
      // Más repetido primero; empate → monto menor primero (determinista).
      .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
      .slice(0, MAX_MONTOS)
      .map(([v]) => v);

    if (top.length > 0) montos[concepto] = top;
  }

  return { orden, montos };
}

/** El orden por defecto, para cuando todavía no hay histórico que leer. */
export function ordenDelCatalogo(): Record<MovimientoType, string[]> {
  const orden = {} as Record<MovimientoType, string[]>;
  for (const tipo of Object.keys(CONCEPTOS_POR_TIPO) as MovimientoType[]) {
    orden[tipo] = [...CONCEPTOS_POR_TIPO[tipo]] as string[];
  }
  return orden;
}
