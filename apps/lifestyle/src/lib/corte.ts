// ─── Corte de caja — la matemática PURA del cuadre (D5) ───────────────────────
// Sin DB, sin red, sin React. Dos números leídos de artefactos físicos (el
// efectivo del cajón y el voucher de la terminal) contra lo que la app CREE que
// debería haber, y la diferencia con signo.
//
// Tres reglas que este módulo fija y que el resto de la capa hereda:
//
//   1. **El día de caja de una cita es la fecha LOCAL de `completed_at`**, no la
//      de `starts_at`. El dinero cuenta cuando se cobró, no cuando se agendó: una
//      cita de las 19:00 que se cobró a las 23:40 pertenece a ESE día, y una que
//      se agendó ayer y se cobró hoy cuenta hoy. Es la única regla de atribución
//      de toda la capa de dinero — `lib/cobrado.ts` (D6) usa la misma. Este
//      módulo la recibe ya aplicada (la query acota por día local) y la
//      documenta acá porque es donde nació.
//
//   2. **Las transferencias quedan FUERA de la comparación.** No tienen artefacto
//      físico que contar: nadie abre un cajón y cuenta transferencias. Meterlas
//      obligaría a la persona a inventar un número, y un número inventado
//      contamina el descuadre — que es la señal que toda la capa existe para
//      producir. Se muestran como línea informativa, sumadas aparte.
//
//   3. **El descuadre va CON SIGNO, siempre.** Negativo = falta efectivo
//      (salidas sin registrar o fuga). Positivo = entró dinero que nadie capturó
//      (típicamente walk-ins). En valor absoluto los dos casos se ven iguales y
//      son problemas opuestos: por eso el valor absoluto está prohibido.
//
// Lo que este módulo NO hace: decidir. No hay umbrales, no hay "descuadre grave",
// no hay colores. Dato y signo.

/** Una cita ya cobrada del día (monto real + riel con el que se pagó). */
export type CitaCobrada = {
  amount: number;
  method: string;
};

/** Un movimiento de caja del día (D4). */
export type MovimientoDelCorte = {
  type:   string;   // 'entrada' | 'salida'
  amount: number;
  method: string;
};

export type EsperadoPorRiel = {
  /** fondo + citas en efectivo + entradas en efectivo − salidas en efectivo. */
  efectivo:       number;
  /** citas con tarjeta + entradas con tarjeta − salidas con tarjeta. Sin fondo:
   *  el fondo es billetes en un cajón, no saldo de una terminal. */
  tarjeta:        number;
  /** Informativa: fuera de la comparación (regla 2). */
  transferencias: number;
  /**
   * Dinero cobrado cuyo riel NO quedó registrado (filas legadas anteriores a D2:
   * `payment_method` NULL). NO se reparte ni se adivina.
   *
   * Adivinar sería peor que no saber: si se asumiera efectivo y hubiera sido
   * tarjeta, el corte inventaría un faltante en el cajón Y un sobrante en la
   * terminal — dos mentiras donde había un dato ausente. Excluido, el conteo
   * simplemente sale por encima del esperado y el descuadre POSITIVO dice la
   * verdad: entró dinero que no se sabe capturar. El cliente #1 nace con D2
   * activo, así que esto debería ser siempre 0 salvo en datos viejos.
   */
  sinRiel:        number;
  /** El fondo con el que se calculó, para que la card pueda explicarse. */
  fondo:          number;
};

const RIELES = ['efectivo', 'tarjeta', 'transferencia'];

function suma(xs: readonly { amount: number }[]): number {
  return redondear(xs.reduce((t, x) => t + x.amount, 0));
}

/** Centavos exactos: la columna es numeric(10,2) y el float acumula ruido. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * La foto de lo que DEBERÍA haber, por riel, al instante del corte.
 *
 * `citas` y `movimientos` llegan ya acotados al día local del negocio — este
 * módulo no sabe de fechas ni de zonas horarias a propósito: quien decide qué
 * día es cada fila es la capa de datos, y así la matemática queda determinista.
 */
export function expectedByRail(
  citas: readonly CitaCobrada[],
  movimientos: readonly MovimientoDelCorte[],
  fondo: number,
): EsperadoPorRiel {
  const porRiel = (riel: string) => {
    const deCitas   = suma(citas.filter((c) => c.method === riel));
    const entradas  = suma(movimientos.filter((m) => m.type === 'entrada' && m.method === riel));
    const salidas   = suma(movimientos.filter((m) => m.type === 'salida'  && m.method === riel));
    return redondear(deCitas + entradas - salidas);
  };

  return {
    efectivo:       redondear(fondo + porRiel('efectivo')),
    tarjeta:        porRiel('tarjeta'),
    transferencias: porRiel('transferencia'),
    sinRiel:        suma(citas.filter((c) => !RIELES.includes(c.method))),
    fondo,
  };
}

/**
 * Contado − esperado. Con signo, sin excepciones: `Math.abs` sobre esto es el
 * bug que el plan prohíbe por nombre.
 */
export function signedDiff(counted: number, expected: number): number {
  return redondear(counted - expected);
}

/** "−$50" · "+$30" · "$0" — el cero no lleva signo porque no tiene dirección. */
export function fmtSigned(n: number): string {
  const abs = Math.abs(n);
  const monto = `$${abs.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(abs) ? 0 : 2,
  })}`;
  if (n === 0) return monto;
  return `${n < 0 ? '−' : '+'}${monto}`;
}

/** "$1,180" — montos sin dirección (contado, esperado, transferencias). */
export function fmtMonto(n: number): string {
  return `$${n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })}`;
}

// ─── La última fila por día manda ─────────────────────────────────────────────

/** Lo mínimo de un corte para resolver cuál vale (D5) y para la serie (D7). */
export type CorteResoluble = {
  id:         string;
  corteDate:  string;   // 'YYYY-MM-DD' local
  createdAt:  string;   // ISO
  replacesId: string | null;
};

/**
 * De varios cortes del mismo día, vale el ÚLTIMO. Corregir un corte es una fila
 * nueva con `replaces_id`, nunca un UPDATE (decisión 10), así que un día puede
 * tener historia; lo que se muestra es el final de esa historia, y el resto sigue
 * existiendo.
 *
 * Devuelve un corte por fecha, del día más reciente al más viejo, con cuántas
 * correcciones hubo — para que la UI pueda decir "corregido" sin mentir sobre
 * que hubo una sola versión.
 */
export function resolverCortes<T extends CorteResoluble>(
  cortes: readonly T[],
): Array<{ corte: T; correcciones: number }> {
  const porDia = new Map<string, T[]>();
  for (const c of cortes) {
    const lista = porDia.get(c.corteDate) ?? [];
    lista.push(c);
    porDia.set(c.corteDate, lista);
  }

  return [...porDia.entries()]
    .map(([, lista]) => {
      const ordenados = [...lista].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { corte: ordenados[0]!, correcciones: ordenados.length - 1 };
    })
    .sort((a, b) => (a.corte.corteDate < b.corte.corteDate ? 1 : a.corte.corteDate > b.corte.corteDate ? -1 : 0));
}

// ─── El aviso al dueño ────────────────────────────────────────────────────────

export type AvisoCorte = {
  cashCounted: number;
  cardCounted: number;
  cashDiff:    number;
  cardDiff:    number;
  firmadoPor:  string;
  /** Instante del corte; se rinde en la hora del NEGOCIO. */
  at:          Date | number | string;
  timeZone:    string;
};

/** "9:04pm" en la hora del negocio — como lo diría alguien, no como lo diría un log. */
export function horaCorta(at: Date | number | string, timeZone: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
    })
      .format(d)
      .replace(' ', '')
      .toLowerCase();
  } catch {
    return '';
  }
}

/**
 * El mensaje que le llega al dueño el mismo día (decisión 3 del plan). Es el
 * ÚNICO lugar donde el dueño ausente se entera de que hubo corte, así que dice
 * las cuatro cosas y ninguna más: cuánto se contó, cuánto se desvió, y quién
 * firmó a qué hora.
 *
 * Cero juicio: el descuadre va con su signo y sin adjetivo. Si el dueño quiere
 * saber POR QUÉ, abre la app — y ahí están los movimientos de D4.
 */
export function buildAvisoCorte(a: AvisoCorte): string {
  return (
    `Corte de hoy · Efectivo ${fmtMonto(a.cashCounted)} (${fmtSigned(a.cashDiff)})` +
    ` · Tarjeta ${fmtMonto(a.cardCounted)} (${fmtSigned(a.cardDiff)})` +
    ` · firmado por ${a.firmadoPor} ${horaCorta(a.at, a.timeZone)}`
  );
}
