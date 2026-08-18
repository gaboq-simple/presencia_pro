// ─── equipoSemana — el equipo de la semana, en filas (dv3-4') ─────────────────
// Módulo puro (sin DB, sin red, sin React). Lo que hoy son 7 tarjetas de 6 tiles
// cada una —42 números— pasa a 5 filas: punto de color + nombre + barra de
// participación + $ tabular.
//
// La pregunta que la forma nueva responde y la vieja no: **cuánto pesa cada
// barbero dentro del total**. Seis tiles por persona dan seis números absolutos
// y ninguna comparación; la barra de participación ES la comparación.
//
// Dos decisiones que fija este módulo:
//
//   · **Staff sin citas NO se lista.** Una fila en cero no informa de nada y
//     ocupa lo mismo que una que sí. Quien no trabajó esta semana no aparece;
//     eso no lo esconde (el panel completo de gestión sigue teniendo a todos).
//   · **Las faltas van en UNA línea al pie, no en una columna.** El no-show es
//     excepcional; darle una columna propia lo pone a la altura del ingreso en
//     cada fila y sugiere que se compara barbero contra barbero por faltas.
//
// El ingreso es el MISMO que suma `/api/reports/staff-metrics` para 'week'
// (`price_charged ?? services.price` sobre completadas): es un derivado de la
// agenda, no dinero confirmado, y la etiqueta de la card lo dice. La frontera
// derivado/confirmado que trazó D6 no se cruza acá.

import { pctWidth } from './viz';

// ─── Entrada ──────────────────────────────────────────────────────────────────

/** Lo que aporta un barbero a la semana. Mismo shape que el acumulador del endpoint. */
export type EquipoStaffInput = {
  staffId:   string;
  name:      string;
  revenue:   number;
  completed: number;
  noShow:    number;
};

// ─── Salida ───────────────────────────────────────────────────────────────────

export type EquipoFila = {
  staffId:    string;
  name:       string;
  revenue:    number;
  /** Ancho de la barra en % del máximo de la serie (regla del kit). */
  pct:        number;
  /** Participación real en el total, 0–1. Para el `title` accesible. */
  share:      number;
  completed:  number;
  noShow:     number;
  colorIndex: number;
};

export type EquipoSemana = {
  filas: EquipoFila[];
  /** Suma de los `revenue` de las filas — es el total del encabezado, por construcción. */
  total: number;
  /** "Miguel 1 falta · Beto 1 falta" · "" cuando no hubo faltas. */
  faltas: string;
  /** Nadie con citas en la semana: la card se rinde en su estado vacío. */
  vacio: boolean;
};

// ─── Cómputo ──────────────────────────────────────────────────────────────────

/**
 * Filas ordenadas por ingreso DESC (mismo orden que el panel que reemplaza).
 * `colorPorStaff` viene de `lib/staffColors` — el color es identidad y no se
 * deriva de este orden, que sí es por métrica.
 */
export function computeEquipoSemana(
  entradas: readonly EquipoStaffInput[],
  colorPorStaff: ReadonlyMap<string, number>,
): EquipoSemana {
  // Sin citas en la semana = fuera. `completed + noShow` y no `revenue`: un
  // barbero cuyas dos citas fueron no-show trabajó la semana y su falta cuenta;
  // filtrar por dinero lo borraría junto con su dato.
  const conActividad = entradas.filter((e) => e.completed + e.noShow > 0);

  const total = redondear(conActividad.reduce((t, e) => t + e.revenue, 0));
  const max = Math.max(0, ...conActividad.map((e) => e.revenue));

  const filas: EquipoFila[] = [...conActividad]
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'es'))
    .map((e) => ({
      staffId:    e.staffId,
      name:       e.name,
      revenue:    redondear(e.revenue),
      pct:        pctWidth(e.revenue, max),
      share:      total > 0 ? e.revenue / total : 0,
      completed:  e.completed,
      noShow:     e.noShow,
      colorIndex: colorPorStaff.get(e.staffId) ?? 0,
    }));

  return { filas, total, faltas: lineaDeFaltas(filas), vacio: filas.length === 0 };
}

/**
 * "Miguel 1 falta · Beto 2 faltas · el resto sin faltas."
 * Sin faltas devuelve '' — la card omite la línea entera en vez de afirmar un
 * cero, que en una pantalla de operación se lee como una felicitación.
 */
export function lineaDeFaltas(filas: readonly EquipoFila[]): string {
  const conFaltas = filas.filter((f) => f.noShow > 0);
  if (conFaltas.length === 0) return '';
  const partes = conFaltas.map(
    (f) => `${f.name} ${f.noShow} ${f.noShow === 1 ? 'falta' : 'faltas'}`,
  );
  if (conFaltas.length < filas.length) partes.push('el resto sin faltas');
  return `${partes.join(' · ')}.`;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
