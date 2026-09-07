// ─── El período: la misma regla del día, repetida y sumada ────────────────────
// Módulo PURO: sin DB, sin red, sin React. M5 de S10-ASIS-01.
//
// PROHIBIDA UNA SEGUNDA REGLA DEL DINERO. Este módulo NO calcula nada nuevo:
// corre `computeCobrado` —LA regla de D6— una vez por día y suma. Por eso el
// total del período es, por construcción, la suma de los totales diarios que ya
// ve el mostrador. Si acá se hubiera escrito una agregación propia, tarde o
// temprano el período y el día habrían dicho números distintos, y la salida sería
// preguntarse a cuál creerle — que es exactamente el defecto que la capa de
// dinero existió para volver imposible.
//
// LAS SALIDAS JAMÁS SE NETEAN, igual que en el día (regla 3 de `lib/cobrado.ts`):
// una semana de $12,000 con $2,000 de gastos no es una semana de $10,000. Son dos
// hechos y el segundo no corrige al primero.
//
// UN DÍA CERRADO NO ES UN DÍA EN CERO, y el sistema SÍ puede distinguirlos: lo
// dice `staff_availability`. La primera versión de este módulo afirmaba que la
// distinción era imposible —"puede ser que cerramos o que nadie anotó"— y **era
// falso**: `lib/semanaHero.ts` ya la hacía para el dueño desde dv3-3', leyendo
// qué días de la semana tiene el negocio con horario activo. Sostener la versión
// vaga habría llenado de huecos falsos la vista de cualquier barbería que cierra
// los domingos, y un aviso que grita en falso enseña a ignorarlo.
//
// Con esa distinción, "sin registro" queda reservado para lo que de verdad lo
// merece: un día ABIERTO en el que nadie anotó nada. Aun así no se acusa a nadie
// —puede haber sido un día sin un solo cliente— pero ya no es ruido.
//
// Guarda de la guarda: si el negocio NO tiene NINGUNA fila de horario (negocio
// nuevo), no se pinta todo cerrado. Una semana entera en gris por falta de
// configuración sería peor que no decir nada. Misma decisión que `semanaHero`.

import { computeCobrado, type Cobrado, type CitaCobradaHoy, type MovimientoDelDia } from './cobrado';
import { sumarDias, diaDeLaSemana } from './timeWindows';

export type CitaDelPeriodo = { fecha: string; amount: number };
export type MovimientoDelPeriodo = { fecha: string; type: string; amount: number };

export type DiaDelPeriodo = {
  fecha: string;
  cobrado: Cobrado;
  /** Sin citas cobradas y sin movimientos. */
  enBlanco: boolean;
  /** Ningún barbero tiene horario activo ese día de la semana. */
  cerrado: boolean;
};

export type ResumenPeriodo = {
  desde: string;
  hasta: string;
  dias: DiaDelPeriodo[];
  /** Σ de los totales diarios. Nunca menos las salidas. */
  total: number;
  deAgenda: number;
  entradas: number;
  /** Línea aparte, jamás restada del total. */
  salidas: number;
  /** Días ABIERTOS y sin un solo registro. Los cerrados no cuentan. */
  diasEnBlanco: number;
  /** Cuántos días del rango son de cierre. Se dice, no se esconde. */
  diasCerrados: number;
  /** El día con más cobrado del período, si hubo alguno con movimiento. */
  mejorDia: DiaDelPeriodo | null;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Todos los días del rango, inclusive, en orden. */
export function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let d = desde;
  // Cota dura: un rango invertido o absurdo no puede colgar la vista.
  for (let i = 0; i < 400 && d <= hasta; i++) { out.push(d); d = sumarDias(d, 1); }
  return out;
}

/**
 * @param diasAbiertos días de la semana (0=domingo) con horario activo. Vacío =
 *        el negocio no tiene horarios cargados y NO se asume que cierra siempre.
 */
export function computePeriodo(
  desde: string,
  hasta: string,
  citas: readonly CitaDelPeriodo[],
  movimientos: readonly MovimientoDelPeriodo[],
  diasAbiertos: ReadonlySet<number> = new Set(),
): ResumenPeriodo {
  const porDiaCitas = new Map<string, CitaCobradaHoy[]>();
  for (const c of citas) {
    const arr = porDiaCitas.get(c.fecha) ?? [];
    arr.push({ amount: c.amount });
    porDiaCitas.set(c.fecha, arr);
  }
  const porDiaMovs = new Map<string, MovimientoDelDia[]>();
  for (const m of movimientos) {
    const arr = porDiaMovs.get(m.fecha) ?? [];
    arr.push({ type: m.type, amount: m.amount });
    porDiaMovs.set(m.fecha, arr);
  }

  const dias: DiaDelPeriodo[] = diasDelRango(desde, hasta).map((fecha) => {
    const cs = porDiaCitas.get(fecha) ?? [];
    const ms = porDiaMovs.get(fecha) ?? [];
    return {
      fecha,
      // LA regla, sin tocarla: el período no sabe sumar dinero por su cuenta.
      cobrado:  computeCobrado(cs, ms),
      enBlanco: cs.length === 0 && ms.length === 0,
      cerrado:  diasAbiertos.size > 0 && !diasAbiertos.has(diaDeLaSemana(fecha)),
    };
  });

  const acc = dias.reduce(
    (t, d) => ({
      total:    t.total    + d.cobrado.total,
      deAgenda: t.deAgenda + d.cobrado.deAgenda,
      entradas: t.entradas + d.cobrado.entradas,
      salidas:  t.salidas  + d.cobrado.salidas,
    }),
    { total: 0, deAgenda: 0, entradas: 0, salidas: 0 },
  );

  const conMovimiento = dias.filter((d) => !d.enBlanco);
  const mejorDia = conMovimiento.length === 0
    ? null
    : conMovimiento.reduce((a, b) => (b.cobrado.total > a.cobrado.total ? b : a));

  return {
    desde,
    hasta,
    dias,
    total:    redondear(acc.total),
    deAgenda: redondear(acc.deAgenda),
    entradas: redondear(acc.entradas),
    salidas:  redondear(acc.salidas),
    // Solo los ABIERTOS sin registro. Un domingo de cierre no es un olvido.
    diasEnBlanco: dias.filter((d) => d.enBlanco && !d.cerrado).length,
    diasCerrados: dias.filter((d) => d.cerrado).length,
    mejorDia,
  };
}

// ─── Los rangos que ofrece la vista ───────────────────────────────────────────
// Semana lunes→domingo, la misma que ya usan el corte y Panorama. Sin inventar
// una tercera definición de semana.

export type RangoId = 'semana' | 'mes';

/** El lunes de la semana que contiene a `fecha`. */
export function lunesDe(fecha: string): string {
  const dow = diaDeLaSemana(fecha);
  return sumarDias(fecha, dow === 0 ? -6 : 1 - dow);
}

/**
 * El rango a mostrar, **acotado por el tope**.
 *
 * `tope` es el último día que se puede mostrar, y existe por una razón dura: el
 * corte del día es A CIEGAS. Si el período incluyera HOY, su total sería —menos
 * el fondo y sin el reparto por riel— el esperado que la persona todavía no
 * contó, y contar dejaría de ser evidencia para volverse copiar. Así que el
 * período llega hasta AYER, salvo que el corte de hoy ya esté firmado: ahí el
 * número ya se reveló y esconderlo no protege nada.
 */
export function rangoDelPeriodo(rango: RangoId, hoy: string, tope: string): { desde: string; hasta: string } {
  const desde = rango === 'semana' ? lunesDe(hoy) : `${hoy.slice(0, 7)}-01`;
  return { desde, hasta: tope < desde ? desde : tope };
}

/** El último día que el período puede mostrar sin romper la ceguera del corte. */
export function topeDelPeriodo(hoy: string, corteDeHoyFirmado: boolean): string {
  return corteDeHoyFirmado ? hoy : sumarDias(hoy, -1);
}
