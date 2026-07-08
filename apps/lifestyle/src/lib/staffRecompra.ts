// ─── Recompra de héroe (Barberos · Negocio) — módulo puro, sin DB ni React ────
// Mide, por barbero, si SUS clientes vuelven A ÉL — no volumen, no repetidores del
// negocio agnósticos del barbero (ese es el proxy `recurring_clients` de S6, que NO
// reusamos: mide ≥2 visitas al negocio sin mirar quién los atendió).
//
// Decisiones de producto cerradas (ver zlot-dashboard-dueno-diseno.md §5 + sesión):
//   · Métrica (a): de los clientes que vio un barbero, cuántos lo vieron 2+ veces A ÉL.
//     Tasa = recompraron / cohorte. "De mi gente, cuántos volvieron a mí."
//   · Atribución del cliente REPARTIDO (vio a este barbero y a otro): entra al
//     DENOMINADOR de cada barbero que lo atendió, al NUMERADOR de ninguno salvo que
//     haya vuelto 2+ veces con ese barbero en concreto. Repartir ≠ recompra.
//   · Madurez: un cliente con UNA sola visita RECIENTE (<30d) no tuvo tiempo de volver
//     → EXCLUIDO del denominador (no es no-recompra definitiva). Una sola visita MADURA
//     (≥30d) sí cuenta como no-recompra. Espejo de la cohorte "nuevos que vuelven".
//   · Promedio del local = misma métrica AGREGADA (pooled): suma de recompras sobre
//     suma de relaciones maduras (barbero×cliente) del negocio. Es la línea de
//     referencia — NO un ranking.
//   · Piso: barbero con <5 clientes maduros → banda "aún juntando datos", sin %
//     (mismo piso 5 que la retención de Clientela — RETENTION_MIN_COHORT).
//   · Orden de presentación FIJO (alfabético), nunca por la métrica (sería ranking
//     encubierto). El módulo emite las filas ya ordenadas.
//
// Todo determinista y puro: `now` se inyecta para testear sin reloj real.

// ─── Constantes tuneables (un solo lugar) ─────────────────────────────────────

/** Antigüedad mínima de la 1ª visita con un barbero para que "no haber vuelto" cuente
 *  (días). Debajo de esto el cliente aún está "en tiempo" → fuera del denominador. */
export const RECOMPRA_MATURE_DAYS = 30;

/** Piso de cohorte por barbero: <5 clientes maduros → sin tasa creíble (banda). */
export const RECOMPRA_MIN_COHORT = 5;

/** Banda de "cerca del promedio" (±puntos de tasa): dentro de ella el barbero se
 *  pinta neutro (gris), ni arriba ni abajo. Evita dramatizar diferencias de ruido. */
export const RECOMPRA_NEAR_BAND = 0.05;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Una visita COMPLETADA ligada a barbero+cliente (staff_id NOT NULL; customer_id
 *  presente — las walk-in sin cliente no entran, no hay a quién atribuir recompra). */
export type CompletedVisit = {
  staffId: string;
  customerId: string;
  /** ISO timestamp del inicio de la cita. */
  startsAt: string;
};

/** Barbero del roster (define qué filas se emiten y su nombre — incluso con 0 data). */
export type StaffRosterEntry = {
  staffId: string;
  staffName: string;
};

/** Tasa de recompra con su cohorte, o banda "sin datos" si no llega al piso. */
export type RecompraRate =
  | { status: 'ok'; rate: number; cohortSize: number; retained: number }
  | { status: 'insufficient'; cohortSize: number };

/** Relación del barbero con el promedio del local (para el color). `insufficient`
 *  cuando el barbero está bajo el piso; `near` también si no hay promedio comparable. */
export type RecompraTone = 'above' | 'near' | 'below' | 'insufficient';

export type StaffRecompraRow = {
  staffId: string;
  staffName: string;
  rate: RecompraRate;
  tone: RecompraTone;
};

export type StaffRecompraResult = {
  /** Filas ya ordenadas FIJO (alfabético por nombre). Nunca por la métrica. */
  staff: StaffRecompraRow[];
  /** Promedio del local (pooled sobre todas las relaciones maduras del negocio). */
  localAverage: RecompraRate;
  /** Ventana de madurez usada (días) — para etiquetar el reloj en la UI. */
  matureDays: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Conteo crudo por barbero antes de aplicar el piso: cohorte madura + recompras. */
type RawStaffCount = { cohort: number; retained: number };

function toneOf(rate: RecompraRate, avg: RecompraRate): RecompraTone {
  if (rate.status !== 'ok') return 'insufficient';
  if (avg.status !== 'ok') return 'near'; // sin promedio comparable → neutro
  const diff = rate.rate - avg.rate;
  if (diff > RECOMPRA_NEAR_BAND) return 'above';
  if (diff < -RECOMPRA_NEAR_BAND) return 'below';
  return 'near';
}

// ─── Cómputo ──────────────────────────────────────────────────────────────────

/**
 * Recompra de héroe por barbero + promedio del local.
 * @param roster  barberos activos (define filas y orden; incluye los de 0 data).
 * @param visits  visitas completadas ligadas (staffId, customerId, startsAt).
 * @param nowMs   reloj inyectable.
 */
export function computeStaffRecompra(
  roster: StaffRosterEntry[],
  visits: CompletedVisit[],
  nowMs: number,
): StaffRecompraResult {
  // 1. Agrupar por barbero → por cliente: nº de visitas con ÉL + 1ª visita (madurez).
  //    Map<staffId, Map<customerId, { count, firstMs }>>
  const byStaff = new Map<string, Map<string, { count: number; firstMs: number }>>();
  for (const entry of roster) byStaff.set(entry.staffId, new Map());

  for (const v of visits) {
    const perCustomer = byStaff.get(v.staffId);
    if (!perCustomer) continue; // visita de un barbero fuera del roster (inactivo) → se ignora
    const t = new Date(v.startsAt).getTime();
    if (Number.isNaN(t)) continue;
    const cur = perCustomer.get(v.customerId);
    if (cur) {
      cur.count += 1;
      if (t < cur.firstMs) cur.firstMs = t;
    } else {
      perCustomer.set(v.customerId, { count: 1, firstMs: t });
    }
  }

  // 2. Conteo crudo por barbero (cohorte madura + recompras), aplicando madurez.
  const raw = new Map<string, RawStaffCount>();
  for (const entry of roster) {
    const perCustomer = byStaff.get(entry.staffId)!;
    let cohort = 0;
    let retained = 0;
    for (const { count, firstMs } of perCustomer.values()) {
      if (count >= 2) {
        // Volvió con este barbero → cohorte + recompra (ya es maduro por construcción).
        cohort += 1;
        retained += 1;
      } else {
        // Una sola visita con este barbero: ¿maduró?
        const ageDays = (nowMs - firstMs) / MS_PER_DAY;
        if (ageDays >= RECOMPRA_MATURE_DAYS) {
          cohort += 1; // maduro y no volvió → no-recompra (denominador, no numerador)
        }
        // reciente (<30d) → fuera del denominador (aún en tiempo de volver)
      }
    }
    raw.set(entry.staffId, { cohort, retained });
  }

  // 3. Promedio del local: pooled sobre TODAS las relaciones maduras (incluye a los
  //    barberos bajo el piso — el piso protege el juicio individual, no el agregado).
  let poolCohort = 0;
  let poolRetained = 0;
  for (const { cohort, retained } of raw.values()) {
    poolCohort += cohort;
    poolRetained += retained;
  }
  const localAverage: RecompraRate =
    poolCohort < RECOMPRA_MIN_COHORT
      ? { status: 'insufficient', cohortSize: poolCohort }
      : { status: 'ok', rate: poolRetained / poolCohort, cohortSize: poolCohort, retained: poolRetained };

  // 4. Fila por barbero (con piso) + tono vs promedio. Orden FIJO alfabético.
  const ordered = [...roster].sort((a, b) => a.staffName.localeCompare(b.staffName, 'es'));
  const staff: StaffRecompraRow[] = ordered.map((entry) => {
    const { cohort, retained } = raw.get(entry.staffId)!;
    const rate: RecompraRate =
      cohort < RECOMPRA_MIN_COHORT
        ? { status: 'insufficient', cohortSize: cohort }
        : { status: 'ok', rate: retained / cohort, cohortSize: cohort, retained };
    return { staffId: entry.staffId, staffName: entry.staffName, rate, tone: toneOf(rate, localAverage) };
  });

  return { staff, localAverage, matureDays: RECOMPRA_MATURE_DAYS };
}
