// ─── Ingresos (Negocio) — fechas, tramo y serie mensual (PURO, sin DB) ────────
// La matemática de fechas del bloque Ingresos: el tramo del mes en curso, el mismo
// tramo del mes anterior (con el borde de mes), y las ventanas de la serie de 6 meses.
// Puro y determinista → testeable sin reloj real ni Supabase. El revenue de cada
// ventana lo llena el server (lib/negocioMetrics) con el precio SELLADO.
//
// 🔴 **S7-BUG-01 — este módulo ERA el bug.** Armaba sus ventanas con `Date.UTC`
//    puro mientras el resto del dashboard usaba el mes LOCAL del negocio, así que
//    al titular le entraban las últimas seis horas del mes anterior: medido el
//    2026-08-18, **$47,100 contra $46,580** — tres citas de la noche del 31 de
//    julio contadas como agosto. Ahora los límites salen de `lib/timeWindows`, y
//    por eso la firma cambió: ya no basta un `nowMs`, hace falta **la timezone
//    del negocio**. Ese cambio de firma es la parte importante: un módulo de
//    ventanas al que no se le puede pasar la tz es un módulo que garantiza el
//    bug.
//
//    Las ventanas también pasaron a ser **semiabiertas [inicio, fin)**. Antes el
//    fin era 23:59:59.999 y `negocioMetrics` filtraba con `.lte()`: dos meses
//    contiguos contaban dos veces la cita del último milisegundo.

import {
  monthWindow, monthToDateWindow, prevMonthTramoWindow, sumarMeses, todayStrInTz,
} from './timeWindows';

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Ventana SEMIABIERTA [startMs, endMs) para sumar revenue. */
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

/**
 * Tramo del mes en curso (hasta ahora) vs el MISMO tramo del mes anterior.
 * 🔴 Borde de mes: el tramo se define por DÍA DE MES, no por fecha calendario. Si
 * hoy es el día 31 y el mes anterior tuvo 30 días → se compara contra el mes
 * anterior COMPLETO (clamp al último día) y se marca `prevClamped=true`, en vez de
 * fallar por "no existe 31 de junio".
 */
export function tramoRanges(nowMs: number, timeZone: string): TramoRanges {
  const hoy = todayStrInTz(timeZone, new Date(nowMs));
  const prev = prevMonthTramoWindow(hoy, timeZone);
  return {
    thisMonth:  monthToDateWindow(hoy, timeZone, nowMs),
    prevTramo:  { startMs: prev.startMs, endMs: prev.endMs },
    elapsedDay: Number(hoy.slice(8, 10)),
    prevClamped: prev.clamped,
  };
}

/**
 * Ventanas de la serie de N meses (default 6), del más viejo al más nuevo. El
 * último es el mes en curso (`partial:true`, termina AHORA); los previos son meses
 * calendario completos del NEGOCIO.
 */
export function monthlySpecs(nowMs: number, timeZone: string, count = 6): MonthSpec[] {
  const hoy = todayStrInTz(timeZone, new Date(nowMs));
  const anioActual = Number(hoy.slice(0, 4));
  const specs: MonthSpec[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const ancla = sumarMeses(`${hoy.slice(0, 8)}01`, -i);
    const w = monthWindow(ancla, timeZone);
    const partial = i === 0;
    const yy = Number(ancla.slice(0, 4));
    const mm = Number(ancla.slice(5, 7)) - 1;
    // Si la serie cruza de año, la etiqueta se desambigua con el año corto.
    const label = yy !== anioActual ? `${MESES_ES[mm]} '${String(yy).slice(2)}` : MESES_ES[mm]!;
    specs.push({ label, startMs: w.startMs, endMs: partial ? nowMs : w.endMs, partial });
  }
  return specs;
}

/** Nombre del mes anterior (para el copy "el mes pasado…"), en la tz del negocio.
 *  A las 23:00 del 31 de julio en México, el mes anterior es junio — con
 *  `getUTCMonth()` habría dicho julio, porque en UTC ya era agosto. */
export function prevMonthName(nowMs: number, timeZone: string): string {
  const hoy = todayStrInTz(timeZone, new Date(nowMs));
  const anterior = sumarMeses(`${hoy.slice(0, 8)}01`, -1);
  return MESES_ES[Number(anterior.slice(5, 7)) - 1]!;
}
