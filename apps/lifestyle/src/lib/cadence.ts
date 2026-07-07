// ─── Cadencia personal (RFM) — módulo puro, sin DB ni React ───────────────────
// El detector de fugas de la pestaña "Hoy": dado el historial de visitas completadas
// de un cliente + sus campos, decide si está ATRASADO respecto de SU propio ritmo
// (no "no vino este mes"), su segmento, y su valor en juego para el ranking.
//
// Decisiones de producto cerradas (ver zlot-dashboard-dueno-diseno.md §4):
//   · Métrica: MEDIANA del gap entre visitas completadas (robusta a outliers).
//   · Confianza: ≥3 visitas (≥2 gaps). 3 = "recién confiable" (banda, no dura);
//     ≥4 = confiable. <3 = Nuevos (no entra al feed por cadencia).
//   · Atrasado a partir de 1.5× la mediana. Escalado: 1.5–3× "Se están yendo",
//     >3× "Perdidos"; campeón (alta frecuencia) atrasado → urgencia crítica (rojo).
//   · Ranking por valor en juego = frecuencia × monetario × severidad del atraso.
//   · is_flagged / no-show crónico → EXCLUIDO del feed.
//   · Segmentos on-the-fly (no materializados en v1).
//
// Todo determinista y puro: `now` se inyecta para testear sin reloj real.

// ─── Constantes tuneables (un solo lugar) ─────────────────────────────────────

export const MIN_VISITS_FOR_CADENCE = 3;   // <3 → Nuevos (ruido, no señal)
export const OVERDUE_FACTOR         = 1.5;  // atrasado ≥ 1.5× la mediana
export const LOST_FACTOR            = 3;    // perdido > 3× la mediana
// TODO (config por-negocio): CHAMPION_MIN_VISITS es el piso de frecuencia para
// "campeón". Candidato a vivir en Gestión como ajuste POR NEGOCIO (una barbería de
// alto ticket/baja frecuencia define distinto a un campeón que una de corte rápido),
// no una constante global para siempre. No se mueve ahora — sin data real que lo
// calibre. Ver SPRINT.md.
export const CHAMPION_MIN_VISITS    = 6;
export const OVERDUE_SCORE_CAP      = 4;    // tope de severidad en el score (un
                                            // "atrasado eterno" no gana a un campeón)
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type RfmSegment =
  | 'nuevos'
  | 'campeones'
  | 'regulares'
  | 'se_estan_yendo'
  | 'perdidos';

/** Confianza de la predicción de cadencia según cuántas visitas hay. */
export type CadenceConfidence = 'none' | 'tentative' | 'confident';

/** Urgencia visual de una fila del feed (mapea a color en la UI). */
export type FeedUrgency = 'critical' | 'leaving' | 'lost' | 'none';

/** Entrada por cliente: historial + campos denormalizados. */
export type CustomerCadenceInput = {
  customerId: string;
  name: string;
  /** ISO timestamps de visitas COMPLETADAS, cualquier orden (se ordena adentro). */
  completedVisits: string[];
  /** price_charged de las visitas completadas (para el monetario). Nullables se ignoran. */
  monetaryValues: Array<number | null>;
  /** customers.visit_count denormalizado — contexto de display ("48 visitas"). */
  visitCount: number;
  /** customers.created_at — "cliente desde". */
  createdAt: string;
  isFlagged: boolean;
  noshowCount: number;
};

/** Resultado del cómputo por cliente. */
export type CadenceResult = {
  customerId: string;
  name: string;
  segment: RfmSegment;
  confidence: CadenceConfidence;
  medianGapDays: number | null;    // null si <3 visitas
  daysSinceLastVisit: number | null;
  overdueRatio: number | null;     // daysSinceLastVisit / medianGapDays
  isOverdue: boolean;
  inRescueFeed: boolean;           // isOverdue && confianza && !flagged
  urgency: FeedUrgency;
  valueScore: number;              // para el ranking (0 si no entra al feed)
  explanation: string;             // "venía cada 2 semanas, lleva 6 semanas"
  // contexto de display
  visitCount: number;
  avgMonetary: number | null;
  createdAt: string;
};

// ─── Helpers puros ────────────────────────────────────────────────────────────

function daysBetween(aIso: string, bMs: number): number {
  return (bMs - new Date(aIso).getTime()) / MS_PER_DAY;
}

/** Mediana de una lista no vacía de números. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Gaps (en días) entre visitas completadas consecutivas, ordenadas ascendente. */
export function gapsInDays(completedVisits: string[]): number[] {
  const ms = completedVisits
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ms.length; i++) {
    gaps.push((ms[i]! - ms[i - 1]!) / MS_PER_DAY);
  }
  return gaps;
}

/** Humaniza un número de días a idioma barbería aproximado. */
export function humanizeDays(days: number): string {
  const d = Math.round(days);
  if (d <= 1) return 'un día';
  if (d < 14) return `${d} días`;
  const weeks = Math.round(d / 7);
  if (weeks < 9) return weeks === 1 ? 'una semana' : `${weeks} semanas`;
  const months = Math.round(d / 30);
  return months === 1 ? 'un mes' : `${months} meses`;
}

// ─── Cómputo por cliente ──────────────────────────────────────────────────────

export function computeCadence(input: CustomerCadenceInput, nowMs: number): CadenceResult {
  const validVisits = input.completedVisits.filter((iso) => !Number.isNaN(new Date(iso).getTime()));
  const nVisits = validVisits.length;

  const monetaries = input.monetaryValues.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const avgMonetary = monetaries.length > 0
    ? monetaries.reduce((a, b) => a + b, 0) / monetaries.length
    : null;

  // Degradado con gracia: sin cadencia confiable → Nuevos, no predicción.
  if (nVisits < MIN_VISITS_FOR_CADENCE) {
    return {
      customerId: input.customerId,
      name: input.name,
      segment: 'nuevos',
      confidence: 'none',
      medianGapDays: null,
      daysSinceLastVisit: nVisits > 0
        ? daysBetween(maxIso(validVisits), nowMs)
        : null,
      overdueRatio: null,
      isOverdue: false,
      inRescueFeed: false,
      urgency: 'none',
      valueScore: 0,
      explanation: nVisits === 0
        ? 'Sin visitas completadas aún'
        : `Aún sin patrón (${nVisits} ${nVisits === 1 ? 'visita' : 'visitas'})`,
      visitCount: input.visitCount,
      avgMonetary,
      createdAt: input.createdAt,
    };
  }

  const gaps = gapsInDays(validVisits);           // nVisits-1 gaps (≥2)
  const medianGapDays = median(gaps);
  const daysSinceLastVisit = daysBetween(maxIso(validVisits), nowMs);
  const overdueRatio = medianGapDays > 0 ? daysSinceLastVisit / medianGapDays : 0;
  const confidence: CadenceConfidence = nVisits === MIN_VISITS_FOR_CADENCE ? 'tentative' : 'confident';

  const isChampionFreq = input.visitCount >= CHAMPION_MIN_VISITS || nVisits >= CHAMPION_MIN_VISITS;
  const isOverdue = overdueRatio >= OVERDUE_FACTOR;

  // Segmento
  let segment: RfmSegment;
  if (!isOverdue) {
    segment = isChampionFreq ? 'campeones' : 'regulares';
  } else if (overdueRatio > LOST_FACTOR) {
    segment = 'perdidos';
  } else {
    segment = 'se_estan_yendo';
  }

  // El feed excluye flagged / no-show crónico (is_flagged ya lo captura).
  const inRescueFeed = isOverdue && !input.isFlagged;

  // Urgencia (color): campeón enfriándose = crítico (rojo, primero); si no,
  // ámbar para "se están yendo", gris para "perdidos".
  let urgency: FeedUrgency = 'none';
  if (inRescueFeed) {
    if (isChampionFreq) urgency = 'critical';
    else if (segment === 'perdidos') urgency = 'lost';
    else urgency = 'leaving';
  }

  // Valor en juego = frecuencia × monetario × severidad (acotada).
  const monetaryWeight = avgMonetary && avgMonetary > 0 ? avgMonetary : 1;
  const severity = Math.min(overdueRatio, OVERDUE_SCORE_CAP);
  const valueScore = inRescueFeed ? input.visitCount * monetaryWeight * severity : 0;

  const explanation = `Venía cada ${humanizeDays(medianGapDays)}, lleva ${humanizeDays(daysSinceLastVisit)}`;

  return {
    customerId: input.customerId,
    name: input.name,
    segment,
    confidence,
    medianGapDays,
    daysSinceLastVisit,
    overdueRatio,
    isOverdue,
    inRescueFeed,
    urgency,
    valueScore,
    explanation,
    visitCount: input.visitCount,
    avgMonetary,
    createdAt: input.createdAt,
  };
}

function maxIso(isos: string[]): string {
  return isos.reduce((max, cur) =>
    new Date(cur).getTime() > new Date(max).getTime() ? cur : max,
  );
}

// ─── Feed: computa todos, filtra a "para recuperar", rankea, capea ────────────

export type RetentionFeed = {
  rows: CadenceResult[];       // solo inRescueFeed, ordenadas por valor desc
  porRecuperar: number;        // = rows.length (antes del cap de display, ver opts)
};

/**
 * Rango de GRUPO para el orden del feed. El segmento/urgencia es el ordenador
 * PRIMARIO — un perdido NUNCA rankea arriba de un "se están yendo"; el valor en
 * juego ordena DENTRO del grupo (secundario).
 *   0 = campeón enfriándose (crítico) · 1 = se están yendo · 2 = perdidos
 */
export function feedGroupRank(r: CadenceResult): number {
  if (r.urgency === 'critical') return 0;
  if (r.urgency === 'leaving')  return 1;
  return 2; // 'lost'
}

export function computeRetentionFeed(
  inputs: CustomerCadenceInput[],
  nowMs: number,
  opts?: { topN?: number },
): RetentionFeed {
  const all = inputs.map((i) => computeCadence(i, nowMs));
  const feed = all
    .filter((r) => r.inRescueFeed)
    // Primario: grupo (campeón-en-riesgo → se-están-yendo → perdidos).
    // Secundario: valor en juego DESC dentro del grupo.
    .sort((a, b) => feedGroupRank(a) - feedGroupRank(b) || b.valueScore - a.valueScore);
  const porRecuperar = feed.length;
  const rows = typeof opts?.topN === 'number' ? feed.slice(0, opts.topN) : feed;
  return { rows, porRecuperar };
}

// ─── Clientela: agregados de la base (crecimiento + grupos por segmento) ──────
// La pestaña Clientela NO es un rolodex de individuos: trabaja con AGREGADOS.
// Reusa `computeCadence` (fuente ÚNICA de clasificación) para contar por segmento;
// el crecimiento sale de `createdAt`. Puro: `now` inyectable, sin DB ni React.

/** Conteo por segmento RFM (TODOS los segmentos, incluidos los que no entran al feed). */
export type SegmentCounts = Record<RfmSegment, number>;

export type ClientelaStats = {
  /** Total histórico de clientes del negocio (todos, cualquier antigüedad). */
  totalCustomers: number;
  /** Clientes cuyo `createdAt` cae en el mes calendario en curso (reconcilia el "+N"). */
  newThisMonth: number;
  /** Conteo REAL por segmento, on-the-fly (no materializado). */
  segmentCounts: SegmentCounts;
  /**
   * Delta del mes por segmento: de los `newThisMonth`, cuántos caen en cada segmento
   * SEGÚN SU SEGMENTO ACTUAL. La suma = `newThisMonth` (reconcilia con el crecimiento).
   * NO es "movimiento entre grupos" (eso exige recomputar el segmento a dos `now` sobre
   * la historia — PR-C); es "los recién llegados, por su segmento de hoy" (con <3 visitas
   * casi todos caen a Nuevos, honesto).
   */
  newThisMonthBySegment: SegmentCounts;
  /** Retención partida en dos cohortes (nuevos que vuelven / recompra de base). */
  retention: RetentionCohorts;
};

function emptySegmentCounts(): SegmentCounts {
  return { nuevos: 0, campeones: 0, regulares: 0, se_estan_yendo: 0, perdidos: 0 };
}

/** Inicio del mes calendario en curso (UTC) desde un instante en ms. */
function monthStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Agregados de la clientela: crecimiento (total + llegados este mes) y conteo por
 * segmento. Corre `computeCadence` sobre TODOS los inputs (los de <3 visitas caen a
 * Nuevos → degradado con gracia, no ruido). `flagged`/no-show no se excluyen del
 * conteo por segmento (son parte de la base; el feed sí los excluye, esto es la foto).
 */
export function computeClientelaStats(
  inputs: CustomerCadenceInput[],
  nowMs: number,
): ClientelaStats {
  const monthStart = monthStartMs(nowMs);
  const segmentCounts = emptySegmentCounts();
  const newThisMonthBySegment = emptySegmentCounts();
  let newThisMonth = 0;

  for (const input of inputs) {
    const { segment } = computeCadence(input, nowMs);
    segmentCounts[segment] += 1;

    const createdMs = new Date(input.createdAt).getTime();
    if (!Number.isNaN(createdMs) && createdMs >= monthStart) {
      newThisMonth += 1;
      newThisMonthBySegment[segment] += 1;
    }
  }

  return {
    totalCustomers: inputs.length,
    newThisMonth,
    segmentCounts,
    newThisMonthBySegment,
    retention: computeRetention(inputs, nowMs),
  };
}

// ─── Retención por cohortes (el "balde que gotea") ────────────────────────────
// Dos tasas separadas — mezcladas MIENTEN (los viejos pegajosos ahogan la señal de
// los nuevos). Puro: reusa la MISMA serie de visitas completadas (CustomerCadenceInput),
// `now` inyectable. Cada cohorte declara su ventana (el reloj etiquetado del doc).

/** Piso de datos: por debajo de esto no se muestra un %, sino una banda honesta. */
export const RETENTION_MIN_COHORT = 5;

// ── Cohorte "nuevos que vuelven" ──
/** Antigüedad MÍNIMA de la 1ª visita para entrar a la cohorte (días). */
export const NEW_COHORT_MATURE_DAYS = 30;
/** Antigüedad MÁXIMA de la 1ª visita para seguir siendo "nuevo reciente" (días). */
export const NEW_COHORT_WINDOW_DAYS = 90;
/** Un "vuelve" = 2ª visita dentro de este margen desde la 1ª (días). */
export const NEW_RETURN_WINDOW_DAYS = 30;

// ── Cohorte "recompra de base" ──
/** Establecido = al menos esta cantidad de visitas completadas. */
export const BASE_MIN_VISITS = MIN_VISITS_FOR_CADENCE; // 3
/** Recompró = alguna visita en los últimos N días. */
export const BASE_RECENT_DAYS = 60;

/** Una tasa de retención con su tamaño de cohorte, o banda "sin datos" si no llega al piso. */
export type RetentionRate =
  | { status: 'ok'; rate: number; cohortSize: number; retained: number }
  | { status: 'insufficient'; cohortSize: number };

export type RetentionCohorts = {
  /** Nuevos que vuelven: de los primerizos maduros (1ª visita [30–90]d atrás), cuántos
   *  tuvieron 2ª visita ≤30d de la 1ª. Ventana declarada en la UI. */
  newReturn: RetentionRate;
  /** Recompra de base: de los establecidos (≥3 visitas), cuántos vinieron en los últimos 60d. */
  baseRepeat: RetentionRate;
};

/** ms ascendentes y válidos de las visitas completadas de un input. */
function sortedVisitMs(input: CustomerCadenceInput): number[] {
  return input.completedVisits
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
}

function rateOf(cohortSize: number, retained: number): RetentionRate {
  if (cohortSize < RETENTION_MIN_COHORT) return { status: 'insufficient', cohortSize };
  return { status: 'ok', rate: retained / cohortSize, cohortSize, retained };
}

export function computeRetention(inputs: CustomerCadenceInput[], nowMs: number): RetentionCohorts {
  // ── Nuevos que vuelven ──
  // La cohorte EXCLUYE a los primerizos recientes (<30d desde su 1ª visita) A PROPÓSITO:
  // todavía no "fallaron en volver" — no han tenido los 30d de margen. Contarlos como
  // "no volvieron" desinflaría la tasa con gente que aún está en tiempo. Por eso el rango
  // es [30, 90]d de antigüedad de la 1ª visita (maduro pero aún "nuevo"). NO simplificar
  // a "todos los nuevos".
  let newCohort = 0;
  let newRetained = 0;
  // ── Recompra de base ──
  let baseCohort = 0;
  let baseRepeat = 0;

  for (const input of inputs) {
    const visits = sortedVisitMs(input);
    if (visits.length === 0) continue;

    // Cohorte nueva: por antigüedad de la PRIMERA visita.
    const firstAgeDays = (nowMs - visits[0]!) / MS_PER_DAY;
    if (firstAgeDays >= NEW_COHORT_MATURE_DAYS && firstAgeDays <= NEW_COHORT_WINDOW_DAYS) {
      newCohort += 1;
      // Volvió si hubo una 2ª visita dentro de NEW_RETURN_WINDOW_DAYS de la 1ª.
      // visits[1] es la más temprana después de la 1ª (serie ordenada).
      if (visits.length >= 2 && (visits[1]! - visits[0]!) / MS_PER_DAY <= NEW_RETURN_WINDOW_DAYS) {
        newRetained += 1;
      }
    }

    // Cohorte de base: establecidos (≥ BASE_MIN_VISITS visitas).
    if (visits.length >= BASE_MIN_VISITS) {
      baseCohort += 1;
      const lastAgeDays = (nowMs - visits[visits.length - 1]!) / MS_PER_DAY;
      if (lastAgeDays <= BASE_RECENT_DAYS) baseRepeat += 1;
    }
  }

  return {
    newReturn: rateOf(newCohort, newRetained),
    baseRepeat: rateOf(baseCohort, baseRepeat),
  };
}
