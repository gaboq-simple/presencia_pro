// ─── Ingresos (Negocio) — fechas, tramo y serie mensual (PURO, sin DB) ────────
// La matemática de fechas del bloque Ingresos: el tramo del mes en curso, el mismo
// tramo del mes anterior (con el borde de mes), y las ventanas de la serie de 6 meses.
// Puro y determinista (`nowMs` inyectable) → testeable sin reloj real ni Supabase.
// El revenue de cada ventana lo llena el server (lib/negocioMetrics) con el precio
// SELLADO (COALESCE(price_charged, service.price), igual que #81).

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Ventana [startMs, endMs] para sumar revenue. */
export type RevenueRange = { startMs: number; endMs: number };

/** Especificación de una barra mensual (el server le agrega `revenue`). */
export type MonthSpec = RevenueRange & { label: string; partial: boolean };

/** Los dos tramos a comparar + metadata del borde de mes. */
export type TramoRanges = {
  thisMonth: RevenueRange;   // inicio del mes en curso → ahora (parcial)
  prevTramo: RevenueRange;   // inicio del mes anterior → mismo día-de-mes (o clamp)
  elapsedDay: number;        // día del mes de hoy (1..31)
  prevClamped: boolean;      // hoy > días del mes anterior → prevTramo = mes anterior COMPLETO
};

function startOfMonthUtc(y: number, mZeroBased: number): number {
  return Date.UTC(y, mZeroBased, 1);
}

/** Días del mes (UTC): el "día 0" del mes siguiente. */
function daysInMonthUtc(y: number, mZeroBased: number): number {
  return new Date(Date.UTC(y, mZeroBased + 1, 0)).getUTCDate();
}

/** Fin de un día calendario (UTC) — 23:59:59.999. */
function endOfDayUtc(y: number, mZeroBased: number, day: number): number {
  return Date.UTC(y, mZeroBased, day, 23, 59, 59, 999);
}

/**
 * Tramo del mes en curso (hasta ahora) vs el MISMO tramo del mes anterior.
 * 🔴 Borde de mes: el tramo se define por DÍA DE MES, no por fecha calendario. Si hoy
 * es el día 31 y el mes anterior tuvo 30 días → se compara contra el mes anterior
 * COMPLETO (clamp al último día) y se marca `prevClamped=true`, en vez de fallar por
 * "no existe 31 de junio".
 */
export function tramoRanges(nowMs: number): TramoRanges {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const elapsedDay = now.getUTCDate();

  // Mes anterior (con wrap de año).
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const prevDays = daysInMonthUtc(prevY, prevM);

  const tramoDay = Math.min(elapsedDay, prevDays);
  const prevClamped = elapsedDay > prevDays;

  return {
    thisMonth: { startMs: startOfMonthUtc(y, m), endMs: nowMs },
    prevTramo: { startMs: startOfMonthUtc(prevY, prevM), endMs: endOfDayUtc(prevY, prevM, tramoDay) },
    elapsedDay,
    prevClamped,
  };
}

/**
 * Ventanas de la serie de N meses (default 6), del más viejo al más nuevo. El último
 * es el mes en curso (`partial:true`, termina AHORA); los previos son meses cerrados.
 */
export function monthlySpecs(nowMs: number, count = 6): MonthSpec[] {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const specs: MonthSpec[] = [];

  for (let i = count - 1; i >= 0; i--) {
    // Mes = (y, m - i) normalizado.
    const monthIndex = m - i;
    const yy = y + Math.floor(monthIndex / 12);
    const mm = ((monthIndex % 12) + 12) % 12;
    const partial = i === 0;
    const startMs = startOfMonthUtc(yy, mm);
    const endMs = partial ? nowMs : endOfDayUtc(yy, mm, daysInMonthUtc(yy, mm));
    // Etiqueta: mes; si la serie cruza de año, se desambigua con el año corto.
    const crossesYear = yy !== y;
    const label = crossesYear ? `${MESES_ES[mm]} '${String(yy).slice(2)}` : MESES_ES[mm];
    specs.push({ label, startMs, endMs, partial });
  }
  return specs;
}

/** Nombre del mes anterior (para el copy "el mes pasado…"). */
export function prevMonthName(nowMs: number): string {
  const now = new Date(nowMs);
  const prevM = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
  return MESES_ES[prevM]!;
}
