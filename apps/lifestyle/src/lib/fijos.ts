// ─── Gastos fijos: cuándo toca la puerta ──────────────────────────────────────
// Módulo PURO: sin DB, sin red, sin React. M4 de S10-ASIS-01.
//
// LA REGLA DE LA QUE CUELGA TODO: un fijo NUNCA se registra solo. Acá no se
// escribe nada — se calcula qué vence, y quien confirma es una persona. Escribir
// "salió la renta" porque es día 3 sería fabricar evidencia (`CLAUDE.md`): un mes
// se paga el 5, otro no se paga, y el sistema no tiene forma de saberlo. La
// automatización que ESCRIBE sola es la que oculta; la que RECUERDA, exhibe — y
// esa es justamente la objeción que este diseño vino a responder.
//
// EL PERÍODO ES LA UNIDAD, NO LA FECHA EXACTA. Un fijo mensual está satisfecho si
// se pagó ALGUNA VEZ dentro del mes que le toca, aunque no haya sido el día 3
// exacto: la vida real no paga en la fecha. Lo mismo con el semanal y su semana
// (lunes→domingo, la misma que ya usan el corte y Panorama).
//
// Y SI NADIE CONFIRMA, NO PASA NADA: el fijo se queda pendiente y ENVEJECE a la
// vista ("vence hace 3 días"). No se autoregistra y no se desvanece — que es la
// diferencia entre un recordatorio y una automatización que esconde.
//
// Toda la aritmética es de CALENDARIO (`lib/timeWindows.ts`), nunca de instantes:
// el día del mes en que vence la renta no depende de ninguna zona horaria.

import { diasDelMes, sumarDias, diaDeLaSemana } from './timeWindows';

export const CADENCIAS = ['mensual', 'semanal'] as const;
export type Cadencia = (typeof CADENCIAS)[number];

export type Fijo = {
  id: string;
  label: string;
  concept: string;
  amountSugerido: number;
  methodSugerido: string;
  cadencia: Cadencia;
  /** 1..31 si es mensual; `null` si es semanal. */
  diaDelMes: number | null;
  /** 0=domingo si es semanal; `null` si es mensual. */
  diaDeSemana: number | null;
  active: boolean;
};

/** Lo último que se pagó de ESE fijo, derivado de `caja_movimientos`. */
export type UltimoPago = { occurredOn: string; amount: number } | null;

/** Un pago candidato, antes de descartar los anulados. */
export type PagoDeFijo = { id: string; fijoId: string; occurredOn: string; amount: number };

/**
 * El último pago VIGENTE de cada fijo: descarta los que fueron anulados.
 *
 * POR QUÉ HACE FALTA. Anular un movimiento no lo borra —la caja es append-only y
 * la corrección es una contraentrada—, y la contraentrada **no lleva `fijo_id`**
 * (`reverseCajaMovimiento` no lo copia). Sin este filtro, un pago anulado seguiría
 * contando como pagado y el fijo se quedaría CALLADO todo el período, que es
 * exactamente el modo de fallo que M4 vino a evitar: un recordatorio que se apaga
 * sin que nadie haya pagado nada.
 *
 * @param pagos    movimientos con `fijoId`, del más nuevo al más viejo
 * @param anulados ids de los pagos que tienen una contraentrada apuntándoles
 */
export function ultimosPagosVigentes(
  pagos: PagoDeFijo[], anulados: ReadonlySet<string>,
): Map<string, UltimoPago> {
  const out = new Map<string, UltimoPago>();
  for (const p of pagos) {
    if (anulados.has(p.id)) continue;
    if (!out.has(p.fijoId)) out.set(p.fijoId, { occurredOn: p.occurredOn, amount: p.amount });
  }
  return out;
}

export type EstadoFijo = {
  fijo: Fijo;
  /** Día LOCAL en que vencía el período en curso. */
  vence: string;
  /** `true` si ese período todavía no tiene un movimiento que lo satisfaga. */
  pendiente: boolean;
  /** Días transcurridos desde `vence`. 0 = vence hoy. Negativo = todavía no. */
  diasDeAtraso: number;
  ultimoPago: UltimoPago;
};

// ─── Fechas de vencimiento ────────────────────────────────────────────────────

function partes(fecha: string): { y: number; m: number; d: number } {
  return {
    y: Number(fecha.slice(0, 4)),
    m: Number(fecha.slice(5, 7)),
    d: Number(fecha.slice(8, 10)),
  };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * El día en que vence un fijo MENSUAL dentro del mes de `fecha`.
 *
 * El día 31 se resuelve al ÚLTIMO día del mes que toque —en febrero, el 28— con
 * el mismo criterio de clamp que `sumarMeses`. No se corre al mes siguiente:
 * "vence el 31" en un mes de 30 significa el 30, no el 1 del otro.
 */
export function venceMensual(fecha: string, diaDelMes: number): string {
  const { y, m } = partes(fecha);
  return fmt(y, m, Math.min(diaDelMes, diasDelMes(y, m)));
}

/** El lunes de la semana que contiene a `fecha` (semana lunes→domingo). */
export function lunesDeLaSemana(fecha: string): string {
  const dow = diaDeLaSemana(fecha);
  return sumarDias(fecha, dow === 0 ? -6 : 1 - dow);
}

/** El día en que vence un fijo SEMANAL dentro de la semana de `fecha`. */
export function venceSemanal(fecha: string, diaDeSemana: number): string {
  const lunes = lunesDeLaSemana(fecha);
  // 0=domingo cae al final de la semana lunes→domingo; el resto, día−1.
  return sumarDias(lunes, diaDeSemana === 0 ? 6 : diaDeSemana - 1);
}

/** El vencimiento del período que contiene a `hoy`. */
export function venceEnElPeriodo(fijo: Fijo, hoy: string): string {
  return fijo.cadencia === 'mensual'
    ? venceMensual(hoy, fijo.diaDelMes ?? 1)
    : venceSemanal(hoy, fijo.diaDeSemana ?? 1);
}

/** ¿`fecha` cae dentro del MISMO período que `hoy`? */
export function mismoPeriodo(cadencia: Cadencia, fecha: string, hoy: string): boolean {
  if (cadencia === 'mensual') return fecha.slice(0, 7) === hoy.slice(0, 7);
  return lunesDeLaSemana(fecha) === lunesDeLaSemana(hoy);
}

// ─── Diferencia en días de calendario ─────────────────────────────────────────

/** Días de `desde` a `hasta`, contando calendario. Sin `Date`, sin tz. */
export function diasEntre(desde: string, hasta: string): number {
  const dias = (f: string) => {
    const { y, m, d } = partes(f);
    let total = d;
    for (let mm = 1; mm < m; mm++) total += diasDelMes(y, mm);
    // Días desde el año 0 — solo importa la DIFERENCIA, no el origen.
    for (let yy = 1970; yy < y; yy++) total += (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 366 : 365;
    return total;
  };
  return dias(hasta) - dias(desde);
}

// ─── El estado de un fijo ─────────────────────────────────────────────────────

/**
 * @param fijo       la plantilla
 * @param ultimoPago el último movimiento que apunta a ella, o `null`
 * @param hoy        día LOCAL del negocio ('YYYY-MM-DD')
 */
export function estadoDelFijo(fijo: Fijo, ultimoPago: UltimoPago, hoy: string): EstadoFijo {
  const vence = venceEnElPeriodo(fijo, hoy);
  // Satisfecho si YA se pagó algo de este fijo dentro del período en curso. Se
  // mira el período y no la fecha exacta porque la vida real no paga el día 3.
  const satisfecho = ultimoPago !== null && mismoPeriodo(fijo.cadencia, ultimoPago.occurredOn, hoy);
  const diasDeAtraso = diasEntre(vence, hoy);
  return {
    fijo,
    vence,
    // Solo se considera pendiente cuando el día de vencimiento YA llegó: un fijo
    // que vence el 30 no molesta el 2. Y sigue pendiente mientras nadie confirme
    // — envejece a la vista en vez de desvanecerse.
    pendiente: fijo.active && !satisfecho && diasDeAtraso >= 0,
    diasDeAtraso,
    ultimoPago,
  };
}

/** Los pendientes primero, y dentro de ellos el más atrasado arriba. */
export function ordenarEstados(estados: EstadoFijo[]): EstadoFijo[] {
  return [...estados].sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? -1 : 1;
    if (a.diasDeAtraso !== b.diasDeAtraso) return b.diasDeAtraso - a.diasDeAtraso;
    return a.fijo.label.localeCompare(b.fijo.label, 'es');
  });
}

/** Cómo se dice el atraso, sin dramatizar: es un recordatorio, no un reproche. */
export function textoDeVencimiento(e: EstadoFijo): string {
  if (!e.pendiente) return e.ultimoPago ? 'pagado este período' : 'todavía no vence';
  if (e.diasDeAtraso === 0) return 'vence hoy';
  if (e.diasDeAtraso === 1) return 'venció ayer';
  return `venció hace ${e.diasDeAtraso} días`;
}
