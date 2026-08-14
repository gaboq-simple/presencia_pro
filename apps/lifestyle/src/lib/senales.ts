// ─── Señales — la tabla "Cómo se ve el fracaso", calculada (D7) ───────────────
// Sin DB, sin red, sin React. Traduce lo que la capa de dinero ya guarda en las
// cuatro señales que dicen si esto está funcionando o si está fallando de una de
// las cuatro maneras previstas.
//
// POR QUÉ EXISTE: el plan escribió esa tabla el día 1 y la dejó sin lector. Una
// señal que nadie mira no existe — y las cuatro fallas que vigila son
// SILENCIOSAS: el ritual que no prende, el cuadre que no converge, el teatro y
// el dueño que dejó de abrir la app no producen ningún error, ninguna alerta,
// ninguna pantalla roja. Se ven solo si alguien las va a buscar todas las
// semanas, y "alguien se acuerda" no es un mecanismo.
//
// LO QUE ESTE MÓDULO NO HACE: concluir. No hay veredictos, ni colores, ni
// "atención". Cada señal sale como DATO + su UMBRAL al lado ("mediana 3.2% ·
// umbral 10%") para que quien lea compare. La misma regla del resto de la capa:
// el número con su referencia, y la conclusión es de quien mira.

// ─── Entradas ─────────────────────────────────────────────────────────────────

/** Un corte, con lo mínimo para las señales 2 y 3. */
export type CorteParaSenal = {
  id:            string;
  corteDate:     string;   // 'YYYY-MM-DD' local
  createdAt:     string;   // ISO — para resolver el último del día
  replacesId:    string | null;
  cashDiff:      number;
  cardDiff:      number;
  expectedCash:  number;
  expectedCard:  number;
  fondoSnapshot: number;
};

/** Un día de caja: cuánto se cobró y cuántos movimientos fuera de agenda hubo. */
export type DiaDeCaja = {
  fecha:       string;   // 'YYYY-MM-DD' local
  cobrado:     number;
  movimientos: number;
};

export type EntradaSenales = {
  cortes:          readonly CorteParaSenal[];
  dias:            readonly DiaDeCaja[];
  /** ISO o null si el dueño nunca abrió el dashboard. */
  ownerLastSeenAt: string | null;
  /** Hoy en la tz del NEGOCIO ('YYYY-MM-DD'). */
  hoy:             string;
};

// ─── Umbrales (los de la tabla del plan, en un solo lugar) ────────────────────

/** "El ritual no prende": <5 de los 7 días hábiles con corte firmado. */
export const UMBRAL_RITUAL = 5;
/** "El cuadre no converge": descuadre mediano >10% de lo capturado. */
export const UMBRAL_CONVERGENCIA_PCT = 10;
/** "El riesgo terminal": el dueño sin abrir la app >7 días. */
export const UMBRAL_DUENO_DIAS = 7;

export const VENTANA_DIAS = 14;
export const SEMANA_DIAS = 7;

// ─── Helpers de fecha (puros: sin tz, aritmética de calendario) ───────────────

function aUTC(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

function desplazar(fecha: string, dias: number): string {
  const t = new Date(aUTC(fecha));
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** 0=domingo … 6=sábado. Sobre la fecha LOCAL como calendario, no como instante. */
function diaSemana(fecha: string): number {
  return new Date(aUTC(fecha)).getUTCDay();
}

/** Supuesto v1, documentado: hábil = lunes a sábado. Los domingos el local cierra. */
function esHabil(fecha: string): boolean {
  return diaSemana(fecha) !== 0;
}

function rangoDias(hasta: string, cuantos: number): string[] {
  const out: string[] = [];
  for (let i = cuantos - 1; i >= 0; i--) out.push(desplazar(hasta, -i));
  return out;
}

function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

function pct1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Siempre un decimal en el TEXTO: "3%" y "4.2%" juntos se leen como precisiones
 *  distintas cuando son la misma medida. El número del campo queda sin tocar. */
function pctTexto(n: number): string {
  return pct1(n).toFixed(1);
}

// ─── La última fila por día manda (regla de D5) ───────────────────────────────
// Duplicar acá el `resolverCortes` de `lib/corte.ts` sería tener dos definiciones
// de "cuál corte vale"; se importa la idea aplicándola sobre este tipo, que es
// estructuralmente el mismo (id + corteDate + createdAt + replacesId).

function ultimoPorDia(cortes: readonly CorteParaSenal[]): CorteParaSenal[] {
  const porDia = new Map<string, CorteParaSenal[]>();
  for (const c of cortes) {
    const l = porDia.get(c.corteDate) ?? [];
    l.push(c);
    porDia.set(c.corteDate, l);
  }
  return [...porDia.values()].map((l) =>
    [...l].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]!,
  );
}

/**
 * Descuadre relativo de un corte: cuánto se desvió contra cuánto se movió.
 *
 * El denominador RESTA el fondo (`expected_cash − fondo_snapshot`): el fondo de
 * cambio no es dinero que entró ese día — es el mismo que estaba en el cajón
 * desde antes. Dejarlo adentro inflaría la base y haría que todos los días se
 * vieran más convergentes de lo que son, justo en los negocios chicos, que son
 * todos los de este producto.
 *
 * `max(1, …)` evita dividir por cero en un día sin movimiento: en ese día el
 * porcentaje no significa nada, pero tampoco puede reventar el reporte.
 */
export function pctDescuadre(c: CorteParaSenal): number {
  const base = Math.max(1, (c.expectedCash - c.fondoSnapshot) + c.expectedCard);
  return (Math.abs(c.cashDiff) + Math.abs(c.cardDiff)) / base * 100;
}

// ─── Salida ───────────────────────────────────────────────────────────────────

export type Senales = {
  ritual: {
    conCorte: number;
    habiles:  number;
    umbral:   number;
    texto:    string;
  };
  convergencia: {
    medianaPct:  number | null;
    recientePct: number | null;
    previaPct:   number | null;
    umbralPct:   number;
    texto:       string;
  };
  teatro: {
    ceroExacto:            number;
    cortesRecientes:       number;
    sabadosLlenosSinMovs:  number;
    sabadosLlenos:         number;
    texto:                 string;
  };
  dueno: {
    diasSinVer: number | null;   // null = nunca abrió
    umbral:     number;
    texto:      string;
  };
};

export function computeSenales(input: EntradaSenales): Senales {
  const { cortes, dias, ownerLastSeenAt, hoy } = input;

  const diasSemana  = rangoDias(hoy, SEMANA_DIAS);
  const diasVentana = rangoDias(hoy, VENTANA_DIAS);
  const enVentana   = new Set(diasVentana);
  const enSemana    = new Set(diasSemana);

  const vigentes = ultimoPorDia(cortes).filter((c) => enVentana.has(c.corteDate));

  // ── 1. El ritual ───────────────────────────────────────────────────────────
  const habiles  = diasSemana.filter(esHabil);
  const conCorte = habiles.filter((d) => vigentes.some((c) => c.corteDate === d)).length;

  // ── 2. La convergencia ─────────────────────────────────────────────────────
  const pctDe = (cs: readonly CorteParaSenal[]) => mediana(cs.map(pctDescuadre));
  const medianaPct  = pctDe(vigentes);
  const recientePct = pctDe(vigentes.filter((c) => enSemana.has(c.corteDate)));
  const previaPct   = pctDe(vigentes.filter((c) => !enSemana.has(c.corteDate)));

  // ── 3. El teatro ───────────────────────────────────────────────────────────
  // (a) El cuadre perfecto sistemático. Un conteo real tiene ruido; una racha de
  //     ceros exactos es más fácil de explicar por "se copió el esperado" que por
  //     una caja impecable.
  const recientes  = vigentes.filter((c) => enSemana.has(c.corteDate));
  const ceroExacto = recientes.filter((c) => c.cashDiff === 0 && c.cardDiff === 0).length;

  // (b) El sábado lleno sin un solo movimiento fuera de agenda. Si el día más
  //     ocupado de la semana no tuvo ni un walk-in ni una venta suelta, lo más
  //     probable no es que no hayan pasado: es que nadie los registró.
  const diasEnVentana = dias.filter((d) => enVentana.has(d.fecha));
  const medianaDiaria = mediana(diasEnVentana.map((d) => d.cobrado)) ?? 0;
  const sabados = diasEnVentana.filter((d) => diaSemana(d.fecha) === 6);
  const sabadosLlenos = sabados.filter((d) => d.cobrado >= medianaDiaria && d.cobrado > 0);
  const sabadosLlenosSinMovs = sabadosLlenos.filter((d) => d.movimientos === 0).length;

  // ── 4. El dueño ────────────────────────────────────────────────────────────
  const diasSinVer = ownerLastSeenAt === null
    ? null
    : Math.max(0, Math.floor((aUTC(hoy) - aUTC(ownerLastSeenAt.slice(0, 10))) / 86_400_000));

  return {
    ritual: {
      conCorte, habiles: habiles.length, umbral: UMBRAL_RITUAL,
      texto: `${conCorte} de ${habiles.length} días hábiles con corte · umbral ${UMBRAL_RITUAL}`,
    },
    convergencia: {
      medianaPct:  medianaPct  === null ? null : pct1(medianaPct),
      recientePct: recientePct === null ? null : pct1(recientePct),
      previaPct:   previaPct   === null ? null : pct1(previaPct),
      umbralPct:   UMBRAL_CONVERGENCIA_PCT,
      texto: medianaPct === null
        ? `sin cortes en los últimos ${VENTANA_DIAS} días · umbral ${UMBRAL_CONVERGENCIA_PCT}%`
        : `mediana ${pctTexto(medianaPct)}% · umbral ${UMBRAL_CONVERGENCIA_PCT}%` +
          (recientePct !== null && previaPct !== null
            ? ` · semana ${pctTexto(recientePct)}% vs ${pctTexto(previaPct)}% la previa`
            : ''),
    },
    teatro: {
      ceroExacto, cortesRecientes: recientes.length,
      sabadosLlenosSinMovs, sabadosLlenos: sabadosLlenos.length,
      texto: `${ceroExacto} de ${recientes.length} cortes en cero exacto · ` +
             `${sabadosLlenosSinMovs} de ${sabadosLlenos.length} sábados llenos sin movimientos`,
    },
    dueno: {
      diasSinVer, umbral: UMBRAL_DUENO_DIAS,
      texto: diasSinVer === null
        ? `nunca abrió la app · umbral ${UMBRAL_DUENO_DIAS} días`
        : `hace ${diasSinVer} ${diasSinVer === 1 ? 'día' : 'días'} · umbral ${UMBRAL_DUENO_DIAS} días`,
    },
  };
}
