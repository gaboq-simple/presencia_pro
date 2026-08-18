// ─── analisis — la matemática de la pestaña "Análisis" (dv3-6) ────────────────
// Módulo puro (sin DB, sin red, sin React). Dos composiciones y nada más: la
// mezcla por servicio (magnitud, con pliegue de cola larga) y el canal de origen
// (proporción de un todo). El resto de la pestaña reusa módulos que ya existen
// —`negocioMetrics`, `occupancy`, `staffRecompra`— sin tocarles una línea.
//
// La invariante que sostiene la pestaña: **la suma de las barras de servicios
// (incluida la fila "Otros") es el titular del mes, centavo a centavo**. Si esas
// dos cifras se separan, la card de servicios deja de ser un desglose y pasa a
// ser otro número que el dueño tiene que reconciliar solo.

import { foldOtros, pctWidth, sharePcts, type VizRow } from './viz';

// ─── Mezcla por servicio ──────────────────────────────────────────────────────

/** Cuánto facturó un servicio en el mes, y en cuántas citas. */
export type ServicioMes = { serviceId: string; nombre: string; revenue: number; citas: number };

export type FilaServicio = {
  nombre:  string;
  revenue: number;
  /** Ancho de la barra contra el MÁXIMO de la serie (magnitud, no proporción). */
  pct:     number;
  esOtros: boolean;
};

export type MezclaServicios = {
  filas: FilaServicio[];
  /** Suma de las filas — la que debe coincidir con el titular del mes. */
  total: number;
  vacio: boolean;
};

/** Cuántos servicios se listan antes de plegar el resto en "Otros k". */
export const TOPE_SERVICIOS = 4;

/**
 * Top-N por facturación + la fila de pliegue. `foldOtros` ya garantiza que
 * plegar conserve la suma; acá solo se traduce a anchos.
 *
 * La barra es de MAGNITUD (contra el máximo, `pctWidth`) y no de proporción: la
 * pregunta de esta card es "cuánto pesa cada servicio contra el que más vende",
 * no "qué fracción del total es". La proporción del todo ya la cuenta el canal,
 * abajo, y con una apilada — dos formas distintas para dos preguntas distintas.
 */
export function computeMezclaServicios(entradas: readonly ServicioMes[]): MezclaServicios {
  const conVenta = entradas.filter((e) => e.revenue > 0);
  const rows: VizRow[] = conVenta.map((e) => ({ label: e.nombre, value: e.revenue }));
  const plegadas = foldOtros(rows, TOPE_SERVICIOS);
  const max = Math.max(0, ...plegadas.map((f) => f.value));

  return {
    filas: plegadas.map((f) => ({
      nombre:  f.label,
      revenue: redondear(f.value),
      pct:     pctWidth(f.value, max),
      esOtros: f.esOtros === true,
    })),
    total: redondear(plegadas.reduce((a, f) => a + f.value, 0)),
    vacio: plegadas.length === 0,
  };
}

// ─── Canal de origen ──────────────────────────────────────────────────────────

export type CanalKey = 'bot' | 'manual' | 'walkin';

/** Orden FIJO de presentación. No se ordena por volumen: el canal es identidad,
 *  y si el orden bailara mes a mes la leyenda dejaría de ser leíble de un vistazo. */
export const CANAL_ORDEN: readonly CanalKey[] = ['bot', 'manual', 'walkin'];

export const CANAL_LABEL: Record<CanalKey, string> = {
  bot:    'Bot',
  manual: 'Manual',
  walkin: 'Walk-in',
};

/** El walk-in hereda el violeta que YA significa walk-in en la vista del asistente. */
export const CANAL_COLOR: Record<CanalKey, string> = {
  bot:    'var(--color-viz-cat-1)',
  manual: 'var(--color-viz-cat-2)',
  walkin: 'var(--color-walk)',
};

export type FilaCanal = { key: CanalKey; citas: number; pct: number };

export type Canal = { filas: FilaCanal[]; total: number; vacio: boolean };

/**
 * Reparto del mes por canal. Usa `sharePcts` (proporción del total, suma 100),
 * NO `pctWidth`: es una apilada.
 *
 * Los tres canales se listan SIEMPRE, aunque uno esté en cero — a diferencia de
 * los grupos de la clientela, acá el cero es información: "este mes el bot no
 * agendó nada" es justo lo que el dueño necesita ver, y esconderlo dejaría la
 * card diciendo que todo va bien.
 */
export function computeCanal(conteos: Record<CanalKey, number>): Canal {
  const valores = CANAL_ORDEN.map((k) => conteos[k] ?? 0);
  const pcts = sharePcts(valores);
  const total = valores.reduce((a, b) => a + b, 0);
  return {
    filas: CANAL_ORDEN.map((k, i) => ({ key: k, citas: valores[i]!, pct: pcts[i]! })),
    total,
    vacio: total === 0,
  };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
