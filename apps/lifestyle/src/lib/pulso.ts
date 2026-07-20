// ─── Pulso (Negocio) — matemática PURA (sin DB, sin red) ──────────────────────
// El pulso del dueño = ocupación de UN día (hoy o cualquier día futuro) sobre la
// capacidad agendable de ese día. Esta capa es día-agnóstica y determinista:
// recibe slots ya generados / conteos ya sumados y devuelve los números.
//
// Definición de ocupación (aprobada, Paso 1):
//   ocupación = citas agendadas ÷ capacidad agendable (slots), clampeada a 100%.
//   · capacidad = tiling greedy NO-solapado de los candidatos del bot por barbero
//     activo, según su horario de ESE día − breaks − bloqueos − día libre.
//   · agendadas = citas no-canceladas del día (no_show incluido: ocupó el slot).
//
// 🔴 No toca la tabla privada de propinas del barbero — el pulso es ocupación; la
//    proyección usa solo el precio del servicio (price_charged ∥ services.price).
// Puro y testeable con números conocidos.

// ── Tiling greedy: cuántas citas NO-solapadas caben ───────────────────────────
// Los candidatos del bot arrancan cada 15 min y se solapan (uno de 30 min tapa a
// los siguientes). Una cita bloquea su duración → el throughput real del barbero es
// el máximo de citas no-solapadas que entran, no la cantidad de posiciones de arranque.
// Recorre los candidatos ordenados por inicio; toma uno, salta al primero cuyo inicio
// ≥ fin del tomado; repite. El conteo = capacidad.
export function tileCapacity(
  slots: ReadonlyArray<{ startsAtMs: number; endsAtMs: number }>,
): number {
  const sorted = [...slots].sort((a, b) => a.startsAtMs - b.startsAtMs);
  let count = 0;
  let lastEndMs = -Infinity;
  for (const s of sorted) {
    if (s.startsAtMs < lastEndMs) continue; // se solapa con el anterior tomado
    lastEndMs = s.endsAtMs;
    count++;
  }
  return count;
}

// ── Ocupación de un día ───────────────────────────────────────────────────────
// null si no hay capacidad (nadie trabaja ese día / negocio cerrado) → estado vacío
// honesto, no "0%". Clamp a 1 (100%): un walk-in embutido en un día lleno no empuja
// el gauge por encima del 100% (un día lleno es un día lleno).
export function occupancyPct(booked: number, capacity: number): number | null {
  if (capacity <= 0) return null;
  return Math.min(1, booked / capacity);
}

// ── Proyección de ingreso — tres capas de certeza decreciente ─────────────────
// piso     = completadas hoy × precio (ya cobrado, sellado — no puede bajar).
// agendado = confirmadas/pendientes futuras de hoy × precio (en agenda, no cobrado).
// huecos   = capacidad vacía × precio del servicio representativo (especulativo).
// techo    = piso + agendado + huecos (el máximo si se llena el día).
// El número que se muestra sólido es el piso; agendado y huecos siempre van marcados
// como potencial ("si se llena"), nunca como promesa.
export type Projection = {
  piso: number;
  agendado: number;
  huecos: number;
  techo: number;
};

export function projectionLayers(input: {
  completedRevenue: number;
  scheduledRevenue: number;
  emptySlots: number;
  repPrice: number;
}): Projection {
  const piso = Math.max(0, Math.round(input.completedRevenue));
  const agendado = Math.max(0, Math.round(input.scheduledRevenue));
  const huecos = Math.max(0, Math.round(Math.max(0, input.emptySlots) * input.repPrice));
  return { piso, agendado, huecos, techo: piso + agendado + huecos };
}

// ── Banda de señal (para "señalar sin concluir") ──────────────────────────────
// Traduce una ocupación a una banda visual — el color señala dónde mirar; NO opina.
// 'flojo' = mucho hueco (mirá acá), 'lleno' = casi tope (orgullo), 'medio' = neutro.
// null (sin capacidad) → 'cerrado'. Los umbrales son datos, no juicios: el dueño
// saca la conclusión. Un día "flojo" no dice "mal día", solo "acá hay lugar".
export type OccBand = 'cerrado' | 'flojo' | 'medio' | 'lleno';

export const FLOJO_MAX = 0.4;  // < 40% ocupado = muchos huecos → señalar
export const LLENO_MIN = 0.85; // ≥ 85% ocupado = casi tope → señalar (orgullo)

export function occupancyBand(pct: number | null): OccBand {
  if (pct === null) return 'cerrado';
  if (pct < FLOJO_MAX) return 'flojo';
  if (pct >= LLENO_MIN) return 'lleno';
  return 'medio';
}

// ── Delta de comparación (dato, no juicio) ────────────────────────────────────
// Devuelve la diferencia en puntos porcentuales entre dos ocupaciones. null si falta
// una de las dos (sin capacidad ese día) → la UI omite la comparación en vez de mentir.
export function occupancyDeltaPoints(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round(current * 100) - Math.round(previous * 100);
}
