// ─── dayDrift — el corrimiento del día del barbero (Paso 6) ──────────────────
// Módulo PURO y client-safe (solo Date/aritmética, sin red/DB/Intl): calcula
// cuánto se corrió el día a partir de HECHOS, nunca de suposiciones.
//
// La regla (decisión de producto, no cambiar sin re-discutir):
//   · El atraso nace SOLO de `completed_at` — el instante real en que el barbero
//     marcó Terminó. Ancla: el máximo completed_at de las citas cerradas del día.
//     Sin ese hecho, no hay corrimiento NUNCA (ancla -∞ → cero drama).
//   · Una cita PASADA SIN MARCAR (ventana terminada, sigue activa) es señal de
//     "no marcó" — el hero ya pregunta "¿Terminó?". Se EXCLUYE del cálculo: ni
//     genera atraso infinito ni recibe proyección. El atraso se cuenta desde que
//     marque.
//   · Todas las demás activas (futuras Y las que su ventana contiene el ahora) se
//     proyectan en CADENA: cada una entra cuando el barbero queda libre
//     (max(su hora, fin proyectado anterior)). Una en curso que empezó a tiempo
//     queda en su hora (corrimiento cero) y ocupa hasta su fin programado; una
//     cuya ventana contiene el ahora pero el ancla real la alcanzó (el barbero
//     recién marcó 13:59 y ella era de 13:45) se proyecta al ancla — "Miguel
//     entra 13:59". Los huecos absorben el corrimiento — si terminó 20 tarde
//     pero hay 30 min de hueco, no pasó nada.
//
// Solapes intencionales (allow_overlap): la cadena se corre DOS veces — una con el
// ancla real (completed_at / en-curso) y una solo con la forma del horario. El
// corrimiento de cada cita es la DIFERENCIA. Así, dos citas agendadas encimadas a
// propósito no fabrican un atraso que no existe.
//
// El tono es asunto de la UI, pero la semántica vive acá: el corrimiento es un
// dato sobre EL DÍA, no un reproche al barbero.

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Subconjunto estructural de DashboardAppointment que necesita el cálculo. */
export type DriftAppt = {
  id: string;
  starts_at: string;                    // ISO UTC
  ends_at: string;                      // ISO UTC
  status: string;
  adjusted_starts_at?: string | null;   // nueva hora acordada si el cliente avisó retraso
  completed_at?: string | null;         // instante real del cierre (migración 20260718)
};

export type DriftProjection = {
  apptId: string;
  /** Inicio programado (efectivo: adjusted_starts_at si existe), ms epoch. */
  scheduledStartMs: number;
  /** Inicio proyectado según el corrimiento real, ms epoch. */
  projectedStartMs: number;
  /** Minutos de corrimiento (proyectado − programado), redondeado. */
  shiftMin: number;
};

export type DayDrift = {
  /**
   * Corrimiento de la PRÓXIMA cita afectada, en minutos. 0 = el día va a tiempo
   * (o los huecos absorbieron el atraso). Es el número del aviso: "Tu día se
   * corrió N min". Siempre el máximo de la cadena (el corrimiento solo decrece
   * hacia adelante — los huecos absorben, nunca amplifican).
   */
  driftMin: number;
  /** Citas futuras activas con corrimiento > 0, en orden cronológico. */
  projections: DriftProjection[];
};

/**
 * Umbral de surface: por debajo de este corrimiento NO se muestra nada (aviso,
 * horas tachadas, fantasma de la barra). 5 min no ameritan molestar; 10 sí es
 * información. Decisión cerrada con Gabriel (Paso 6).
 */
export const DRIFT_THRESHOLD_MIN = 10;

// ─── Cálculo ──────────────────────────────────────────────────────────────────

const ACTIVE = new Set(['pending', 'confirmed', 'walkin']);

type Slot = { id: string; startMs: number; endMs: number };

/** Corre la cadena: cada slot entra en max(su hora, ancla) y empuja el ancla. */
function chainProject(slots: Slot[], anchor: number): number[] {
  const out: number[] = [];
  let freeAt = anchor;
  for (const s of slots) {
    const proj = Math.max(s.startMs, freeAt);
    out.push(proj);
    freeAt = proj + (s.endMs - s.startMs);
  }
  return out;
}

/**
 * Calcula el corrimiento del día a partir de las citas del día y el ahora.
 * `nowMs` viene del caller (cliente con tick, o server action) — el módulo no lee
 * el reloj. Todos los instantes son absolutos (ms epoch): el cálculo no necesita
 * timezone; la tz del negocio es asunto del formateo en la UI.
 */
export function computeDayDrift(appts: DriftAppt[], nowMs: number): DayDrift {
  const none: DayDrift = { driftMin: 0, projections: [] };
  if (appts.length === 0) return none;

  // ── Ancla real: cuándo queda libre el barbero, según hechos ────────────────
  //  Solo max(completed_at) de las cerradas — el hecho duro del cierre tardío.
  //  Las pasadas sin marcar no aportan: son "no marcó", no atraso.
  let anchor = -Infinity;
  const slots: Slot[] = [];

  const sorted = [...appts].sort((a, b) => effStartMs(a) - effStartMs(b));
  for (const a of sorted) {
    if (a.status === 'completed' && a.completed_at) {
      const doneAt = Date.parse(a.completed_at);
      if (Number.isFinite(doneAt)) anchor = Math.max(anchor, doneAt);
      continue;
    }
    if (!ACTIVE.has(a.status)) continue; // cancelada / no_show / completed sin timestamp

    const startMs = effStartMs(a);
    const endMs = startMs + durMs(a);
    if (endMs <= nowMs) {
      // Pasada sin marcar: excluida ("no marcó" — el hero pregunta "¿Terminó?").
      continue;
    }
    // Futuras Y en-curso-por-ventana entran a la cadena. La que empezó a tiempo
    // queda en su hora (shift 0) y ocupa hasta su fin programado; la que el ancla
    // alcanzó se proyecta ("Miguel entra 13:59" en el instante en que marca).
    slots.push({ id: a.id, startMs, endMs });
  }

  if (slots.length === 0 || anchor === -Infinity) return none;

  // ── Dos pasadas: real vs. forma del horario ────────────────────────────────
  const real = chainProject(slots, anchor);
  const baseline = chainProject(slots, -Infinity);

  const projections: DriftProjection[] = [];
  for (let i = 0; i < slots.length; i++) {
    const f = slots[i]!;
    const shiftMs = real[i]! - baseline[i]!;
    const shiftMin = Math.round(shiftMs / 60_000);
    if (shiftMin > 0) {
      projections.push({
        apptId: f.id,
        scheduledStartMs: f.startMs,
        projectedStartMs: real[i]!,
        shiftMin,
      });
    }
  }

  return { driftMin: projections[0]?.shiftMin ?? 0, projections };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function effStartMs(a: DriftAppt): number {
  return Date.parse(a.adjusted_starts_at ?? a.starts_at);
}

function durMs(a: DriftAppt): number {
  return Math.max(60_000, Date.parse(a.ends_at) - Date.parse(a.starts_at));
}
