// ─── Tests del cobrado (D6) — la regla del titular ────────────────────────────
// El caso numérico del plan es el test principal, y su aserción central es una
// NEGACIÓN: el titular NUNCA es $1,580. Ese número —el neto— es el que aparece
// solo si alguien "simplifica" restando las salidas, y es exactamente lo que el
// plan prohíbe: esconde cuánto se vendió Y cuánto se gastó detrás de un número
// que no es ninguna de las dos cosas.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeCobrado, type CitaCobradaHoy, type MovimientoDelDia } from '../apps/lifestyle/src/lib/cobrado';

// ─── El caso numérico del plan ────────────────────────────────────────────────
// Agenda cobrada $1,300 (ef $700 + tj $600) + entradas $400 → "Cobrado hoy
// $1,700", con "Salidas $120" aparte.

const CITAS: CitaCobradaHoy[] = [
  { amount: 200 }, { amount: 320 }, { amount: 180 },  // efectivo → 700
  { amount: 150 }, { amount: 450 },                    // tarjeta  → 600
];

const MOVS: MovimientoDelDia[] = [
  { type: 'entrada', amount: 150 },  // walk-in
  { type: 'entrada', amount: 250 },  // producto
  { type: 'salida',  amount: 120 },  // insumos
];

test('el caso del plan: cobrado hoy $1,700 (agenda 1,300 + entradas 400)', () => {
  const c = computeCobrado(CITAS, MOVS);
  assert.equal(c.deAgenda, 1300);
  assert.equal(c.entradas, 400);
  assert.equal(c.total, 1700);
});

test('las salidas van APARTE y jamás se netean: el total NUNCA es 1,580', () => {
  const c = computeCobrado(CITAS, MOVS);
  assert.equal(c.salidas, 120);
  assert.notEqual(c.total, 1580, 'netear las salidas es el bug que el plan prohíbe por nombre');
  assert.equal(c.total, c.deAgenda + c.entradas);
});

// ─── Las tres consecuencias de la regla ───────────────────────────────────────

test('los TRES rieles suman — la transferencia también entró', () => {
  // El corte deja las transferencias fuera de SU comparación (no hay artefacto
  // físico que contar); el titular es cuánto entró, y entraron.
  const c = computeCobrado([{ amount: 900 }], [{ type: 'entrada', amount: 100 }]);
  assert.equal(c.total, 1000);
});

test('un día de puras salidas: total 0, salidas visibles, nunca negativo', () => {
  const c = computeCobrado([], [{ type: 'salida', amount: 300 }]);
  assert.equal(c.total, 0);
  assert.equal(c.salidas, 300);
});

test('la contraentrada de D4 se neutraliza sola en el total', () => {
  // Anular una entrada de $250 crea una salida de $250. El total baja $250
  // (la entrada ya no cuenta) y la salida queda a la vista — que es lo correcto:
  // hubo dos hechos y los dos pasaron.
  const c = computeCobrado([], [
    { type: 'entrada', amount: 250 },
    { type: 'salida',  amount: 250 },
  ]);
  assert.equal(c.entradas, 250);
  assert.equal(c.salidas, 250);
  assert.equal(c.total, 250, 'el total NO se auto-corrige: para eso está la línea de salidas');
});

test('día vacío: todo en cero, sin reventar', () => {
  assert.deepEqual(computeCobrado([], []), { total: 0, deAgenda: 0, entradas: 0, salidas: 0 });
});

test('centavos exactos, sin ruido de float', () => {
  const c = computeCobrado([{ amount: 0.1 }, { amount: 0.2 }], [{ type: 'entrada', amount: 0.3 }]);
  assert.equal(c.deAgenda, 0.3);
  assert.equal(c.total, 0.6);
});

test('un tipo desconocido no se cuela ni como entrada ni como salida', () => {
  const c = computeCobrado([], [{ type: 'ajuste', amount: 999 }]);
  assert.equal(c.total, 0);
  assert.equal(c.entradas, 0);
  assert.equal(c.salidas, 0);
});

test('no muta lo que recibe', () => {
  const citas = CITAS.map((x) => ({ ...x }));
  const movs = MOVS.map((x) => ({ ...x }));
  const copiaC = citas.map((x) => ({ ...x }));
  const copiaM = movs.map((x) => ({ ...x }));
  computeCobrado(citas, movs);
  assert.deepEqual(citas, copiaC);
  assert.deepEqual(movs, copiaM);
});
