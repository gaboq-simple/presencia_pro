// ─── timeWindows — LAS ventanas de consulta, en la tz del negocio (S7-BUG-01) ─
// Módulo puro (solo `Intl`/`Date`, sin DB ni red). Un solo lugar donde se decide
// dónde empieza y dónde termina un día, una semana o un mes **para el negocio**.
//
// **Por qué existe.** El repo ya tenía la pieza correcta (`zonedWallTimeToUtc` de
// `dayWindow.ts`) y la usaba en casi todos lados; casi. `revenueTrend.ts` armaba
// sus ventanas con `Date.UTC` puro, así que al titular del mes le entraban las
// últimas seis horas del mes anterior — medido el 2026-08-18: **$47,100 contra
// $46,580**, tres citas de la noche del 31 de julio. Es la CUARTA vez que este
// bug aparece (PR #142, PR #144, S6-DATA-01), y las tres anteriores se
// arreglaron una por una. Esta vez se arregla el patrón: una función por
// ventana, y un repo-check que rompe el build si alguien vuelve a armar una a
// mano (`tests/timeWindows.repo.test.ts`).
//
// **Contrato, y no se negocia:**
//   · Toda ventana es **semiabierta `[inicio, fin)`**. Un `endMs` de 23:59:59.999
//     pierde el último milisegundo del día, y peor: invita a usar `.lte()`, que
//     con dos ventanas contiguas cuenta dos veces la fila del borde.
//   · Los límites son **horas de pared del NEGOCIO** convertidas a instantes UTC.
//     Nunca el reloj del proceso: Vercel corre en UTC y la máquina de desarrollo
//     en hora de México, así que un cálculo que dependa del proceso da dos
//     resultados distintos para el mismo dato.
//   · `nowMs` se inyecta siempre. Sin reloj inyectable no hay test determinista.

import { zonedWallTimeToUtc, todayStrInTz } from './dayWindow';

/** Ventana semiabierta `[startMs, endMs)`. */
export type TimeWindow = { startMs: number; endMs: number };

/** La misma ventana en ISO, que es lo que comen `.gte()` / `.lt()`. */
export function toIso(w: TimeWindow): { start: string; end: string } {
  return { start: new Date(w.startMs).toISOString(), end: new Date(w.endMs).toISOString() };
}

// ─── Helpers de calendario (sobre 'YYYY-MM-DD', sin tocar el reloj) ──────────

/** Partes de una fecha 'YYYY-MM-DD'. */
function partes(fecha: string): { y: number; m: number; d: number } {
  const [y, m, d] = fecha.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Días del mes. Aritmética de CALENDARIO pura — no depende de ninguna tz. */
export function diasDelMes(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
          31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** `fecha` + `dias`, en calendario. Nunca cruza mal un cambio de horario porque
 *  no toca instantes: solo cuenta días. */
export function sumarDias(fecha: string, dias: number): string {
  let { y, m, d } = partes(fecha);
  d += dias;
  while (d > diasDelMes(y, m)) { d -= diasDelMes(y, m); m++; if (m > 12) { m = 1; y++; } }
  while (d < 1) { m--; if (m < 1) { m = 12; y--; } d += diasDelMes(y, m); }
  return fmt(y, m, d);
}

/** `fecha` + `meses`, con clamp al último día del mes destino (31 → 30/28). */
export function sumarMeses(fecha: string, meses: number): string {
  const { y, m, d } = partes(fecha);
  const idx = (y * 12 + (m - 1)) + meses;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return fmt(yy, mm, Math.min(d, diasDelMes(yy, mm)));
}

/** Día de la semana (0=domingo) de una fecha de CALENDARIO — Zeller, sin `Date`.
 *  Con `new Date('YYYY-MM-DD')` habría que elegir entre `getDay()` (tz del
 *  proceso) y `getUTCDay()`, y las dos son la pregunta equivocada: el día de la
 *  semana de una fecha no depende de ninguna zona horaria. */
export function diaDeLaSemana(fecha: string): number {
  const { y, m, d } = partes(fecha);
  const mm = m < 3 ? m + 12 : m;
  const yy = m < 3 ? y - 1 : y;
  const k = yy % 100, j = Math.floor(yy / 100);
  const h = (d + Math.floor((13 * (mm + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;  // Zeller: 0=sábado → 0=domingo
}

// ─── Las ventanas ────────────────────────────────────────────────────────────

/** El día `fecha` completo, en la tz del negocio. */
export function dayWindow(fecha: string, timeZone: string): TimeWindow {
  return {
    startMs: zonedWallTimeToUtc(fecha, '00:00:00', timeZone).getTime(),
    endMs:   zonedWallTimeToUtc(sumarDias(fecha, 1), '00:00:00', timeZone).getTime(),
  };
}

/** La semana (lunes→domingo) que CONTIENE a `fecha`. Lunes y no domingo porque es
 *  la semana laboral de la barbería, y es la misma que ya usan el corte y el
 *  héroe de Panorama. */
export function weekWindow(fecha: string, timeZone: string): TimeWindow {
  const dow = diaDeLaSemana(fecha);
  const lunes = sumarDias(fecha, dow === 0 ? -6 : 1 - dow);
  return {
    startMs: zonedWallTimeToUtc(lunes, '00:00:00', timeZone).getTime(),
    endMs:   zonedWallTimeToUtc(sumarDias(lunes, 7), '00:00:00', timeZone).getTime(),
  };
}

/** El mes calendario que CONTIENE a `fecha`. */
export function monthWindow(fecha: string, timeZone: string): TimeWindow {
  const { y, m } = partes(fecha);
  return {
    startMs: zonedWallTimeToUtc(fmt(y, m, 1), '00:00:00', timeZone).getTime(),
    endMs:   zonedWallTimeToUtc(sumarMeses(fmt(y, m, 1), 1), '00:00:00', timeZone).getTime(),
  };
}

/** Del inicio del mes de `fecha` hasta `hastaMs` (el "tramo" transcurrido). */
export function monthToDateWindow(fecha: string, timeZone: string, hastaMs: number): TimeWindow {
  return { startMs: monthWindow(fecha, timeZone).startMs, endMs: hastaMs };
}

/**
 * El MISMO tramo del mes anterior: del día 1 al **final del día `diaCorte`**.
 *
 * Con clamp al último día cuando el mes anterior es más corto (hoy 31, junio
 * tiene 30): se compara contra el mes anterior completo y se avisa con
 * `clamped`, en vez de fallar por "no existe 31 de junio".
 */
export function prevMonthTramoWindow(
  fecha: string, timeZone: string,
): TimeWindow & { clamped: boolean } {
  const { d } = partes(fecha);
  const primeroAnterior = sumarMeses(fecha, -1).slice(0, 8) + '01';
  const { y: py, m: pm } = partes(primeroAnterior);
  const diasPrev = diasDelMes(py, pm);
  const corte = Math.min(d, diasPrev);
  return {
    startMs: zonedWallTimeToUtc(fmt(py, pm, 1), '00:00:00', timeZone).getTime(),
    // Semiabierta: hasta el INICIO del día siguiente al de corte.
    endMs:   zonedWallTimeToUtc(sumarDias(fmt(py, pm, corte), 1), '00:00:00', timeZone).getTime(),
    clamped: d > diasPrev,
  };
}

/** "Hoy" del negocio — reexportado para que un consumidor no tenga que importar
 *  de dos módulos distintos para armar una ventana del día de hoy. */
export { todayStrInTz };
