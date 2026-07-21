// ─── La fuga (Negocio · Panorama) — matemática PURA ───────────────────────────
// Dos sub-piezas: (1) capacidad sin usar (huecos de la semana que pasó) y (2) faltas
// repetidas. Esta capa es determinista: recibe huecos ya bucketeados por (día×franja)
// y devuelve el titular en HORAS, el peso como REFERENCIA, y DÓNDE se concentran.
//
// 🔴 EL TONO: la fuga muestra "dónde hay espacio", NO reprocha. Titular en horas, el
//    peso es referencia (no "perdiste $X"). Ámbar tenue, nunca rojo. Señala dónde;
//    el dueño decide. Sin propinas (esto es capacidad y no-shows).
// Puro y testeable con números conocidos.

// Corte mañana / tarde en minutos locales (14:00) — el mismo del engine.
export const FRANJA_CUTOFF_MIN = 14 * 60;
export type Franja = 'manana' | 'tarde';

export function franjaOf(localMinutes: number): Franja {
  return localMinutes < FRANJA_CUTOFF_MIN ? 'manana' : 'tarde';
}

// Hueco por celda: un día-de-semana × franja, con cuántos slots quedaron libres.
export type FreeCell = { dow: number; franja: Franja; freeSlots: number };

export type CapacidadSinUsar = {
  hasData: boolean;
  totalFreeSlots: number;
  /** Horas-barbero libres = slots libres × duración / 60. El TITULAR. */
  totalFreeHours: number;
  /** Peso de REFERENCIA (no pérdida) = slots libres × precio del servicio. */
  pesoRef: number;
  /** Frase "dónde se concentran" (día×franja), o null si no hay huecos. */
  concentration: string | null;
};

const DOW_ES = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];
const FRANJA_LABEL: Record<Franja, string> = { manana: 'por la mañana', tarde: 'por la tarde' };

// Describe dónde están los huecos más grandes (top-2 celdas), agrupando por franja:
// "el martes y miércoles por la tarde" · "el martes por la tarde y el sábado por la mañana".
export function describeConcentration(cells: readonly FreeCell[]): string | null {
  const valid = cells.filter((c) => c.freeSlots > 0).sort((a, b) => b.freeSlots - a.freeSlots);
  if (valid.length === 0) return null;

  const top = valid.slice(0, 2);
  // Agrupar por franja preservando el orden (mayor primero).
  const byFranja = new Map<Franja, number[]>();
  for (const c of top) {
    const arr = byFranja.get(c.franja) ?? [];
    arr.push(c.dow);
    byFranja.set(c.franja, arr);
  }

  const parts: string[] = [];
  for (const [franja, dows] of byFranja) {
    const dias = dows.map((d) => DOW_ES[d] ?? 'un día');
    // "el martes" / "el martes y miércoles" (el 2º sin repetir "el")
    const diasStr = dias.length === 1
      ? dias[0]
      : `${dias[0]} y ${dias.slice(1).map((s) => s.replace(/^el /, '')).join(' y ')}`;
    parts.push(`${diasStr} ${FRANJA_LABEL[franja]}`);
  }
  return parts.join(' y ');
}

export function computeCapacidadSinUsar(
  cells: readonly FreeCell[],
  repDurationMinutes: number,
  repPrice: number,
): CapacidadSinUsar {
  const totalFreeSlots = cells.reduce((a, c) => a + Math.max(0, c.freeSlots), 0);
  const totalFreeHours = Math.round((totalFreeSlots * repDurationMinutes) / 60);
  const pesoRef = Math.round(totalFreeSlots * repPrice);
  return {
    hasData: totalFreeSlots > 0,
    totalFreeSlots,
    totalFreeHours,
    pesoRef,
    concentration: describeConcentration(cells),
  };
}

// Faltas repetidas (2+ no-shows en el mes). Solo dato — sin acción (las señas no
// existen en el sistema). El server arma la lista; este tipo la describe.
export type FaltaRepetida = {
  customerId: string;
  name: string;
  count: number;
  lastNoShow: string; // ISO
  lastLabel: string;  // "12 jul" en la tz del negocio (lo arma el server)
};
