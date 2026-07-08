// ─── Ocupación (Negocio) — agregación PURA (sin DB) ───────────────────────────
// Dado la CAPACIDAD por franja (día-de-semana × hora, de la primitiva de slots del
// bot sobre los horarios recurrentes) y las citas bucketeadas por franja en una
// ventana, computa: ocupación % por celda, ocupación global, el heatmap (modo
// capacidad o RELATIVO si no hay capacidad definida), las 1-2 mejores oportunidades
// (franjas vacías con capacidad) y el "$X potencial" conservador.
// Puro y determinista → testeable con números conocidos.

export const FILL_FACTOR = 0.35;       // factor de llenado CONSERVADOR del potencial (~1/3)
export const WEEKS_PER_MONTH = 4.345;  // para llevar el potencial semanal a mensual
export const OPPORTUNITY_MAX_OCC = 0.7; // una franja es "hueco" si su ocupación < 70%

export type OccCell = {
  dow: number;             // 0=dom … 6=sáb
  hour: number;            // 0-23 (hora local del negocio)
  capacity: number;        // slots por SEMANA típica (capacidad de esa franja)
  booked: number;          // citas en la ventana en esa franja
  intensity: number;       // 0..1 para el color (occ% en modo capacidad; relativo si no)
  occPct: number | null;   // ocupación % (null en modo relativo)
};

export type Opportunity = {
  dow: number;
  hour: number;
  occPct: number | null;
  emptyPerWeek: number;    // slots vacíos por semana en esa franja
};

export type OccupancyResult = {
  mode: 'capacity' | 'relative';
  overallPct: number | null;          // ocupación global (null en modo relativo)
  cells: OccCell[];
  dows: number[];                     // días presentes (con capacidad, o con citas en relativo)
  hours: number[];                    // horas presentes
  starCell: { dow: number; hour: number } | null;  // la franja más llena (orgullo)
  opportunities: Opportunity[];       // top 1-2 huecos con capacidad
  potentialMonthly: number | null;    // $X potencial conservador (null en modo relativo)
  windowWeeks: number;                // semanas cubiertas por la ventana (aprox)
};

const key = (dow: number, hour: number): string => `${dow}:${hour}`;

/**
 * @param capacityByCell  key `${dow}:${hour}` → slots por semana típica.
 * @param bookedByCell     key → citas en la ventana.
 * @param dowCounts        cuántas veces aparece cada dow en la ventana (denominador).
 * @param representativePrice  precio del servicio representativo (para el potencial).
 */
export function assembleOccupancy(
  capacityByCell: Map<string, number>,
  bookedByCell: Map<string, number>,
  dowCounts: Record<number, number>,
  representativePrice: number,
): OccupancyResult {
  const totalCapacity = [...capacityByCell.values()].reduce((a, b) => a + b, 0);
  const dowVals = Object.values(dowCounts);
  const windowWeeks = dowVals.length ? Math.max(...dowVals) : 1;

  // ── Modo RELATIVo: sin capacidad definida (negocio sin horarios) ──
  if (totalCapacity === 0) {
    const cellKeys = new Set<string>([...bookedByCell.keys()]);
    const maxBooked = Math.max(1, ...[...bookedByCell.values()]);
    const cells: OccCell[] = [...cellKeys].map((k) => {
      const [dow, hour] = k.split(':').map(Number) as [number, number];
      const booked = bookedByCell.get(k) ?? 0;
      return { dow, hour, capacity: 0, booked, intensity: booked / maxBooked, occPct: null };
    });
    const star = cells.reduce<OccCell | null>((best, c) => (!best || c.booked > best.booked ? c : best), null);
    return {
      mode: 'relative',
      overallPct: null,
      cells,
      dows: [...new Set(cells.map((c) => c.dow))].sort((a, b) => a - b),
      hours: [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b),
      starCell: star && star.booked > 0 ? { dow: star.dow, hour: star.hour } : null,
      opportunities: [],
      potentialMonthly: null,
      windowWeeks,
    };
  }

  // ── Modo CAPACIDAD: hay horarios → ocupación % real ──
  const cells: OccCell[] = [];
  let sumBooked = 0;
  let sumCapacityWindow = 0;

  for (const [k, capacity] of capacityByCell.entries()) {
    if (capacity <= 0) continue;
    const [dow, hour] = k.split(':').map(Number) as [number, number];
    const weeks = Math.max(1, dowCounts[dow] ?? 1);
    const booked = bookedByCell.get(k) ?? 0;
    const capacityWindow = capacity * weeks;
    const occPct = Math.min(1, booked / capacityWindow);
    cells.push({ dow, hour, capacity, booked, intensity: occPct, occPct });
    sumBooked += Math.min(booked, capacityWindow);
    sumCapacityWindow += capacityWindow;
  }

  const overallPct = sumCapacityWindow > 0 ? sumBooked / sumCapacityWindow : 0;

  // Estrella: la franja más llena (mayor ocupación; desempate por más capacidad).
  const star = cells.reduce<OccCell | null>((best, c) =>
    (!best || c.occPct! > best.occPct! || (c.occPct === best.occPct && c.capacity > best.capacity)) ? c : best, null);

  // Oportunidades: franjas con hueco real (occ < umbral), ordenadas por MÁS slots vacíos
  // absolutos (donde más lugar se desperdicia), top 2.
  const opportunities: Opportunity[] = cells
    .filter((c) => c.occPct! < OPPORTUNITY_MAX_OCC)
    .map((c) => {
      const weeks = Math.max(1, dowCounts[c.dow] ?? 1);
      const emptyPerWeek = Math.max(0, c.capacity - c.booked / weeks);
      return { dow: c.dow, hour: c.hour, occPct: c.occPct, emptyPerWeek };
    })
    .sort((a, b) => b.emptyPerWeek - a.emptyPerWeek)
    .slice(0, 2);

  // Potencial mensual conservador: slots vacíos de las oportunidades × precio × factor.
  const emptyPerWeekTop = opportunities.reduce((a, o) => a + o.emptyPerWeek, 0);
  const potentialMonthly = Math.round(emptyPerWeekTop * WEEKS_PER_MONTH * representativePrice * FILL_FACTOR);

  return {
    mode: 'capacity',
    overallPct,
    cells,
    dows: [...new Set(cells.map((c) => c.dow))].sort((a, b) => a - b),
    hours: [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b),
    starCell: star ? { dow: star.dow, hour: star.hour } : null,
    opportunities,
    potentialMonthly,
    windowWeeks,
  };
}

export { key as occCellKey };
