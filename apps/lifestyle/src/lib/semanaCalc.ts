// ─── Semana — la matemática del héroe de Panorama (dv3-3') ────────────────────
// Sin DB, sin red, sin React.
//
// El héroe de Panorama pasa de "el dinero de hoy" a **LA SEMANA**, y con la capa
// de dinero encima cambia además de FUENTE: ya no es agenda × precio de lista,
// es **Cobrado** (`lib/cobrado.ts`) — lo que alguien firmó. Dos consecuencias que
// este módulo hace explícitas:
//
//   1. **El strip pinta solo el PASADO.** De lunes a hoy hay dinero cobrado; de
//      mañana en adelante no hay nada que pintar, porque lo que existe es agenda,
//      que es otra cosa. La proyección vive en "Los próximos 7 días" (ocupación).
//      Una métrica por strip: nunca eje doble, nunca dinero y ocupación en la
//      misma forma.
//
//   2. **El delta compara el MISMO TRAMO.** Un lunes contra una semana completa
//      no dice nada — diría "vas 80% abajo" todos los lunes. Se compara lun→hoy
//      contra lun→el mismo día de la semana pasada.
//
// La semana es lunes a domingo en la TZ del negocio (la que usa el local para
// decir "esta semana"), y quién es "hoy" lo decide el caller: acá no se lee el
// reloj, para que el resultado sea determinista y testeable.

export type DiaSemana = {
  /** 'YYYY-MM-DD' local. */
  fecha:   string;
  /** Cobrado del día (regla de `lib/cobrado.ts`). */
  cobrado: number;
  /** El negocio no abre ese día (se pinta en hatch, no como un cero). */
  cerrado: boolean;
};

export type EntradaSemana = {
  /** Los 7 días de ESTA semana, lunes → domingo. */
  estaSemana:     readonly DiaSemana[];
  /** Los 7 días de la semana PASADA, lunes → domingo. */
  semanaPasada:   readonly DiaSemana[];
  /** Hoy en la tz del negocio ('YYYY-MM-DD'). Tiene que caer dentro de estaSemana. */
  hoy:            string;
};

export type CeldaSemana = DiaSemana & {
  esHoy:     boolean;
  /** Posterior a hoy: no se pinta (no hay cobrado que pintar todavía). */
  esFuturo:  boolean;
  /** Alto relativo 0..1 contra el mejor día de la semana. Pista vacía = 0. */
  altura:    number;
};

export type SemanaHero = {
  celdas:  CeldaSemana[];
  /** El titular: cobrado de lunes a HOY (incluido). */
  titular: number;
  /** Mismo tramo de la semana pasada. null si esa semana no tiene nada con qué comparar. */
  tramoPasado: number | null;
  /** titular − tramoPasado. null cuando no hay comparación honesta. */
  delta:   number | null;
  /** Cuántos días del tramo llevan cobrado > 0 (para el degradado "sin nada aún"). */
  diasConCobro: number;
};

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * El héroe de la semana.
 *
 * `hoy` fuera de `estaSemana` (no debería pasar: el caller arma la semana que lo
 * contiene) degrada a "toda la semana es futuro" en vez de reventar — un héroe
 * en blanco es recuperable; una excepción en el render del dashboard, no.
 */
export function computeSemanaHero(input: EntradaSemana): SemanaHero {
  const { estaSemana, semanaPasada, hoy } = input;

  const iHoy = estaSemana.findIndex((d) => d.fecha === hoy);
  const hasta = iHoy < 0 ? -1 : iHoy;

  const tramo = hasta < 0 ? [] : estaSemana.slice(0, hasta + 1);
  const titular = redondear(tramo.reduce((t, d) => t + d.cobrado, 0));

  // El tramo espejo de la semana pasada: mismos índices de día, misma cantidad.
  const tramoPasadoDias = hasta < 0 ? [] : semanaPasada.slice(0, hasta + 1);
  const sumaPasada = redondear(tramoPasadoDias.reduce((t, d) => t + d.cobrado, 0));
  // Sin NADA la semana pasada no hay comparación: un "+100%" contra cero es
  // ruido, y un "vs $0" es peor (regla de robustez 2 del rediseño).
  const tramoPasado = tramoPasadoDias.length > 0 && sumaPasada > 0 ? sumaPasada : null;

  const max = Math.max(0, ...estaSemana.map((d) => (d.cerrado ? 0 : d.cobrado)));

  const celdas: CeldaSemana[] = estaSemana.map((d, i) => ({
    ...d,
    esHoy:    i === hasta,
    esFuturo: hasta >= 0 && i > hasta,
    altura:   max > 0 && !d.cerrado ? d.cobrado / max : 0,
  }));

  return {
    celdas,
    titular,
    tramoPasado,
    delta: tramoPasado === null ? null : redondear(titular - tramoPasado),
    diasConCobro: tramo.filter((d) => d.cobrado > 0).length,
  };
}

/** "lun–jue" — el tramo que el titular cubre, con los nombres cortos del strip. */
export const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

export function etiquetaTramo(hero: SemanaHero): string {
  const i = hero.celdas.findIndex((c) => c.esHoy);
  if (i < 0) return '';
  return i === 0 ? DIAS_CORTOS[0] : `${DIAS_CORTOS[0]}–${DIAS_CORTOS[i]}`;
}
