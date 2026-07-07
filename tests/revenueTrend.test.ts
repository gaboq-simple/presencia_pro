// ─── Tests de revenueTrend (Ingresos · Negocio) — matemática de fechas ────────
// El filo: el "mismo tramo" del mes anterior por DÍA DE MES, con el borde de mes
// (día que no existe en el mes anterior → clamp al mes completo). Puro, sin DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tramoRanges, monthlySpecs, prevMonthName } from '../apps/lifestyle/src/lib/revenueTrend';

// ─── Tramo normal ─────────────────────────────────────────────────────────────

test('tramoRanges: mes en curso hasta ahora vs mismo tramo del mes anterior', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0); // 15 jul 2026 (jul=31d, jun=30d)
  const tr = tramoRanges(now);

  assert.equal(tr.elapsedDay, 15);
  assert.equal(tr.prevClamped, false);
  // Mes en curso: 1 jul 00:00 → ahora.
  assert.equal(tr.thisMonth.startMs, Date.UTC(2026, 6, 1));
  assert.equal(tr.thisMonth.endMs, now);
  // Mismo tramo del mes anterior: 1 jun 00:00 → 15 jun 23:59:59.999.
  assert.equal(tr.prevTramo.startMs, Date.UTC(2026, 5, 1));
  assert.equal(tr.prevTramo.endMs, Date.UTC(2026, 5, 15, 23, 59, 59, 999));
});

// ─── Borde de mes (🔴): día que no existe en el mes anterior ──────────────────

test('tramoRanges: día 31 con mes anterior de 30 días → clamp a mes completo', () => {
  const now = Date.UTC(2026, 6, 31, 10, 0, 0); // 31 jul (jun tiene 30 días)
  const tr = tramoRanges(now);

  assert.equal(tr.elapsedDay, 31);
  assert.equal(tr.prevClamped, true, '31 no existe en junio → clamp');
  // El tramo del anterior llega hasta el 30 (mes completo), no falla.
  assert.equal(tr.prevTramo.endMs, Date.UTC(2026, 5, 30, 23, 59, 59, 999));
});

test('tramoRanges: 29-feb pasa a mes anterior con clamp (año no bisiesto detrás)', () => {
  const now = Date.UTC(2026, 2, 30, 10, 0, 0); // 30 mar 2026; feb 2026 = 28 días
  const tr = tramoRanges(now);
  assert.equal(tr.prevClamped, true);
  assert.equal(tr.prevTramo.endMs, Date.UTC(2026, 1, 28, 23, 59, 59, 999)); // feb 28
});

// ─── Serie de 6 meses ─────────────────────────────────────────────────────────

test('monthlySpecs: 6 meses del más viejo al más nuevo; el último parcial', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0); // jul 2026
  const specs = monthlySpecs(now, 6);

  assert.equal(specs.length, 6);
  assert.deepEqual(specs.map((s) => s.label), ['febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio']);
  // Todos cerrados salvo el último (en curso).
  assert.deepEqual(specs.map((s) => s.partial), [false, false, false, false, false, true]);
  // El mes en curso termina AHORA (parcial); los cerrados en su último día.
  assert.equal(specs[5]!.endMs, now);
  assert.equal(specs[5]!.startMs, Date.UTC(2026, 6, 1));
  assert.equal(specs[4]!.endMs, Date.UTC(2026, 5, 30, 23, 59, 59, 999)); // junio cerrado
});

test('monthlySpecs: wrap de año → etiquetas desambiguadas con el año', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0); // 10 ene 2026
  const specs = monthlySpecs(now, 6);
  // ago..dic 2025 + ene 2026 → los de 2025 llevan sufijo de año.
  assert.equal(specs[0]!.label, "agosto '25");
  assert.equal(specs[5]!.label, 'enero'); // el año en curso sin sufijo
  assert.equal(specs[0]!.startMs, Date.UTC(2025, 7, 1));
  assert.equal(prevMonthName(now), 'diciembre');
});
