// ─── Tests de occupancy (Negocio · ocupación) — agregación pura ───────────────
// La capacidad por celda (día×hora) la produce el server con la primitiva de slots
// del bot; acá se prueba la AGREGACIÓN pura: ocupación %, estrella, huecos, potencial,
// y el degradado relativo (sin capacidad). Números conocidos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleOccupancy,
  occCellKey,
  FILL_FACTOR,
  WEEKS_PER_MONTH,
  OPPORTUNITY_MAX_OCC,
} from '../apps/lifestyle/src/lib/occupancy';

function cap(entries: [number, number, number][]): Map<string, number> {
  return new Map(entries.map(([d, h, c]) => [occCellKey(d, h), c]));
}
function booked(entries: [number, number, number][]): Map<string, number> {
  return new Map(entries.map(([d, h, b]) => [occCellKey(d, h), b]));
}

// ─── Ocupación %, estrella y hueco ────────────────────────────────────────────

test('modo capacidad: ocupación %, estrella (más llena) y hueco (más vacío)', () => {
  // Martes (dow 2), 8 martes en la ventana. Dos franjas de capacidad 4/semana → 32 en ventana.
  const capacity = cap([[2, 10, 4], [2, 16, 4]]);
  const bk = booked([[2, 10, 24], [2, 16, 8]]); // 24/32=.75 ; 8/32=.25
  const r = assembleOccupancy(capacity, bk, { 2: 8 }, 200);

  assert.equal(r.mode, 'capacity');
  assert.equal(r.overallPct, 0.5, '(24+8)/(32+32) = 0.5');
  assert.deepEqual(r.starCell, { dow: 2, hour: 10 }, 'la franja más llena (.75)');
  assert.equal(r.opportunities.length, 1);
  assert.deepEqual(
    { dow: r.opportunities[0]!.dow, hour: r.opportunities[0]!.hour },
    { dow: 2, hour: 16 },
    'el hueco es la franja más vacía con capacidad',
  );
  // emptyPerWeek = capacidad 4 − citas/semana (8/8=1) = 3.
  assert.equal(r.opportunities[0]!.emptyPerWeek, 3);
  // Potencial conservador: 3 × WEEKS_PER_MONTH × 200 × FILL_FACTOR.
  assert.equal(r.potentialMonthly, Math.round(3 * WEEKS_PER_MONTH * 200 * FILL_FACTOR));
});

test('umbral de hueco: una franja ocupada ≥70% NO es oportunidad', () => {
  const capacity = cap([[3, 9, 4], [3, 18, 4]]);
  // 3:9 → 30/32 ≈ .94 (llena, no hueco); 3:18 → 4/32 = .125 (hueco)
  const r = assembleOccupancy(capacity, booked([[3, 9, 30], [3, 18, 4]]), { 3: 8 }, 100);
  assert.ok(OPPORTUNITY_MAX_OCC === 0.7);
  assert.equal(r.opportunities.length, 1);
  assert.deepEqual({ d: r.opportunities[0]!.dow, h: r.opportunities[0]!.hour }, { d: 3, h: 18 });
});

test('oportunidades: como máximo 2, ordenadas por más slots vacíos', () => {
  const capacity = cap([[1, 10, 6], [2, 10, 4], [4, 10, 2]]);
  // todas vacías (0 citas) → emptyPerWeek = capacidad; top 2 por capacidad.
  const r = assembleOccupancy(capacity, new Map(), { 1: 8, 2: 8, 4: 8 }, 100);
  assert.equal(r.opportunities.length, 2);
  assert.deepEqual(r.opportunities.map((o) => o.emptyPerWeek), [6, 4], 'top 2 por vacío desc');
});

// ─── Degradado relativo: sin capacidad definida ───────────────────────────────

test('modo relativo: sin capacidad → intensidad relativa, sin % ni potencial', () => {
  const r = assembleOccupancy(new Map(), booked([[5, 11, 5], [5, 15, 2]]), { 5: 8 }, 200);
  assert.equal(r.mode, 'relative');
  assert.equal(r.overallPct, null);
  assert.equal(r.potentialMonthly, null);
  assert.equal(r.opportunities.length, 0);
  assert.deepEqual(r.starCell, { dow: 5, hour: 11 }, 'la más concurrida por conteo');
  const busy = r.cells.find((c) => c.dow === 5 && c.hour === 11)!;
  assert.equal(busy.intensity, 1, 'la más alta define el máximo relativo');
  assert.equal(busy.occPct, null);
});

test('vacío total: sin capacidad ni citas → relativo, todo nulo, sin crash', () => {
  const r = assembleOccupancy(new Map(), new Map(), {}, 200);
  assert.equal(r.mode, 'relative');
  assert.equal(r.cells.length, 0);
  assert.equal(r.starCell, null);
  assert.equal(r.overallPct, null);
});
