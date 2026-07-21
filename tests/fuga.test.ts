// ─── Tests de fuga (Negocio · capacidad sin usar) — matemática pura ───────────
// franja, agregación a horas + peso de referencia, y la frase "dónde se concentran".
// El TONO no se testea acá (es UI), pero sí que el titular sea en HORAS y el peso
// una referencia derivada de los mismos slots libres.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  franjaOf,
  describeConcentration,
  computeCapacidadSinUsar,
  FRANJA_CUTOFF_MIN,
  type FreeCell,
} from '../apps/lifestyle/src/lib/fuga';

// ─── franja ───────────────────────────────────────────────────────────────────

test('franjaOf: antes de 14:00 = mañana, 14:00+ = tarde', () => {
  assert.equal(franjaOf(0), 'manana');
  assert.equal(franjaOf(FRANJA_CUTOFF_MIN - 1), 'manana');
  assert.equal(franjaOf(FRANJA_CUTOFF_MIN), 'tarde');
  assert.equal(franjaOf(20 * 60), 'tarde');
});

// ─── computeCapacidadSinUsar: horas + peso de referencia ──────────────────────

test('computeCapacidadSinUsar: 36 slots libres × 30 min = 18 horas; peso = slots × precio', () => {
  const cells: FreeCell[] = [
    { dow: 2, franja: 'tarde', freeSlots: 20 },
    { dow: 3, franja: 'tarde', freeSlots: 16 },
  ];
  const r = computeCapacidadSinUsar(cells, 30, 200);
  assert.equal(r.totalFreeSlots, 36);
  assert.equal(r.totalFreeHours, 18);        // 36 × 30 / 60
  assert.equal(r.pesoRef, 7200);             // 36 × 200
  assert.equal(r.hasData, true);
});

test('computeCapacidadSinUsar: sin huecos → hasData false, concentration null', () => {
  const r = computeCapacidadSinUsar([{ dow: 1, franja: 'manana', freeSlots: 0 }], 30, 200);
  assert.equal(r.hasData, false);
  assert.equal(r.totalFreeHours, 0);
  assert.equal(r.concentration, null);
});

// ─── describeConcentration: dónde se concentran ───────────────────────────────

test('describeConcentration: top-2 misma franja → "el martes y miércoles por la tarde"', () => {
  const cells: FreeCell[] = [
    { dow: 2, franja: 'tarde', freeSlots: 20 },
    { dow: 3, franja: 'tarde', freeSlots: 16 },
    { dow: 5, franja: 'manana', freeSlots: 2 },
  ];
  assert.equal(describeConcentration(cells), 'el martes y miércoles por la tarde');
});

test('describeConcentration: top-2 franjas distintas → dos frases unidas', () => {
  const cells: FreeCell[] = [
    { dow: 2, franja: 'tarde', freeSlots: 20 },
    { dow: 6, franja: 'manana', freeSlots: 18 },
  ];
  assert.equal(describeConcentration(cells), 'el martes por la tarde y el sábado por la mañana');
});

test('describeConcentration: sin huecos → null', () => {
  assert.equal(describeConcentration([{ dow: 1, franja: 'tarde', freeSlots: 0 }]), null);
});
