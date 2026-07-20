// ─── Tests de pulso (Negocio · ocupación de un día) — matemática pura ─────────
// tiling greedy (capacidad), ocupación % (clamp + capacidad 0), proyección tres
// capas, bandas de señal, delta de comparación. Números conocidos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tileCapacity,
  occupancyPct,
  projectionLayers,
  occupancyBand,
  occupancyDeltaPoints,
  FLOJO_MAX,
  LLENO_MIN,
} from '../apps/lifestyle/src/lib/pulso';

// Helper: candidatos de 30 min cada 15 min desde `startMin` hasta `endMin` (exclusivo de fin).
function candidates(startMin: number, endMin: number, durMin = 30, stepMin = 15) {
  const out: { startsAtMs: number; endsAtMs: number }[] = [];
  for (let s = startMin; s + durMin <= endMin; s += stepMin) {
    out.push({ startsAtMs: s * 60_000, endsAtMs: (s + durMin) * 60_000 });
  }
  return out;
}

// ─── tileCapacity: throughput no-solapado, no las posiciones de arranque ───────

test('tileCapacity: 10:00–11:00 con slots de 30 min → 2 (no 3 candidatos)', () => {
  // candidatos: 10:00, 10:15, 10:30 → greedy toma 10:00–10:30 y 10:30–11:00 = 2
  assert.equal(tileCapacity(candidates(600, 660)), 2);
});

test('tileCapacity: 10:00–20:00 (600 min) con slots de 30 → 20', () => {
  assert.equal(tileCapacity(candidates(600, 1200)), 20);
});

test('tileCapacity: sin candidatos → 0', () => {
  assert.equal(tileCapacity([]), 0);
});

test('tileCapacity: ordena antes de tilear (entrada desordenada)', () => {
  const c = candidates(600, 660).slice().reverse();
  assert.equal(tileCapacity(c), 2);
});

// ─── occupancyPct: clamp y capacidad 0 ────────────────────────────────────────

test('occupancyPct: 8 de 20 → 0.4', () => {
  assert.equal(occupancyPct(8, 20), 0.4);
});

test('occupancyPct: capacidad 0 → null (estado vacío honesto, no 0%)', () => {
  assert.equal(occupancyPct(0, 0), null);
  assert.equal(occupancyPct(3, 0), null);
});

test('occupancyPct: walk-in sobre lo agendable clampea a 1 (no >100%)', () => {
  assert.equal(occupancyPct(25, 20), 1);
});

// ─── projectionLayers: tres capas ─────────────────────────────────────────────

test('projectionLayers: piso + agendado + huecos = techo', () => {
  const p = projectionLayers({ completedRevenue: 1600, scheduledRevenue: 1000, emptySlots: 6, repPrice: 200 });
  assert.deepEqual(p, { piso: 1600, agendado: 1000, huecos: 1200, techo: 3800 });
});

test('projectionLayers: emptySlots negativo (overbooking) → huecos 0', () => {
  const p = projectionLayers({ completedRevenue: 0, scheduledRevenue: 0, emptySlots: -3, repPrice: 200 });
  assert.equal(p.huecos, 0);
  assert.equal(p.techo, 0);
});

// ─── occupancyBand: señal, no juicio ──────────────────────────────────────────

test('occupancyBand: umbrales flojo / medio / lleno / cerrado', () => {
  assert.equal(occupancyBand(null), 'cerrado');
  assert.equal(occupancyBand(FLOJO_MAX - 0.01), 'flojo');
  assert.equal(occupancyBand(FLOJO_MAX), 'medio');       // borde: 0.4 ya no es flojo
  assert.equal(occupancyBand(0.6), 'medio');
  assert.equal(occupancyBand(LLENO_MIN), 'lleno');        // 0.85 exacto = lleno
  assert.equal(occupancyBand(1), 'lleno');
});

// ─── occupancyDeltaPoints: comparación en puntos ──────────────────────────────

test('occupancyDeltaPoints: 0.64 vs 0.56 → +8 pts', () => {
  assert.equal(occupancyDeltaPoints(0.64, 0.56), 8);
});

test('occupancyDeltaPoints: null si falta un lado (día sin capacidad)', () => {
  assert.equal(occupancyDeltaPoints(0.5, null), null);
  assert.equal(occupancyDeltaPoints(null, 0.5), null);
});
