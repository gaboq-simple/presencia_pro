// ─── Tests de cobro (D2) — validación pura del monto + riel al completar ──────
// Las dos asimetrías del módulo son el contrato y están fijadas acá:
//   · el riel SIEMPRE sale con valor (default efectivo) — decisión 2 del plan;
//   · el monto sale `undefined` cuando nadie lo editó, para que el trigger
//     seal_appointment_price selle el precio de lista. Escribirlo explícitamente
//     afirmaría que una persona lo confirmó, y nadie lo miró.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCobro,
  esCobroError,
  DEFAULT_RAIL,
  MAX_COBRO,
  type CobroResuelto,
} from '../apps/lifestyle/src/lib/cobro';

function ok(r: ReturnType<typeof resolveCobro>): CobroResuelto {
  assert.equal(esCobroError(r), false, `esperaba cobro válido, llegó ${JSON.stringify(r)}`);
  return r as CobroResuelto;
}

// ─── El caso normal: el swipe de 2 segundos ───────────────────────────────────

test('sin tocar nada: riel efectivo y monto undefined (lo sella el trigger)', () => {
  const r = ok(resolveCobro(undefined));
  assert.equal(r.method, 'efectivo');
  assert.equal(r.amount, undefined);
});

test('objeto vacío o campos vacíos = igual que no tocar nada', () => {
  for (const input of [{}, { amount: '', method: '' }, { amount: null, method: null }]) {
    const r = ok(resolveCobro(input));
    assert.equal(r.method, DEFAULT_RAIL);
    assert.equal(r.amount, undefined);
  }
});

// ─── El caso del plan: cortesía de $150 con tarjeta ───────────────────────────

test('caso numérico del plan: $150 tarjeta sobre una lista de $200', () => {
  const r = ok(resolveCobro({ amount: 150, method: 'tarjeta' }, 200));
  assert.equal(r.amount, 150);
  assert.equal(r.method, 'tarjeta');
});

test('solo riel editado: el monto sigue sin escribirse', () => {
  const r = ok(resolveCobro({ method: 'transferencia' }, 200));
  assert.equal(r.amount, undefined);
  assert.equal(r.method, 'transferencia');
});

test('solo monto editado: el riel cae al default', () => {
  const r = ok(resolveCobro({ amount: 180 }, 200));
  assert.equal(r.amount, 180);
  assert.equal(r.method, 'efectivo');
});

// ─── Lo que teclea una persona de verdad ──────────────────────────────────────

test('acepta el monto como texto, con $ , y espacios', () => {
  assert.equal(ok(resolveCobro({ amount: '150' })).amount, 150);
  assert.equal(ok(resolveCobro({ amount: ' $1,250 ' })).amount, 1250);
  assert.equal(ok(resolveCobro({ amount: '99.50' })).amount, 99.5);
});

test('redondea a centavos: la columna es numeric(10,2) y el 3er decimal se perdería', () => {
  assert.equal(ok(resolveCobro({ amount: 10.005 })).amount, 10.01);
  assert.equal(ok(resolveCobro({ amount: 33.333 })).amount, 33.33);
});

// ─── Rechazos: cosas que una persona puede corregir ───────────────────────────

test('monto no numérico, cero o negativo → error legible, no throw', () => {
  for (const amount of ['abc', 0, -50, '-1']) {
    const r = resolveCobro({ amount });
    assert.equal(esCobroError(r), true, `${amount} debía rechazarse`);
  }
});

test('monto por encima del techo de la columna → error', () => {
  assert.equal(esCobroError(resolveCobro({ amount: MAX_COBRO + 1 })), true);
  assert.equal(esCobroError(resolveCobro({ amount: MAX_COBRO })), false); // el techo justo, pasa
});

test('riel desconocido → error (no cae al default en silencio)', () => {
  const r = resolveCobro({ amount: 100, method: 'bitcoin' });
  assert.equal(esCobroError(r), true);
  // El riel es obligatorio por construcción: tragarse un valor inválido y
  // guardarlo como 'efectivo' sería inventar cómo pagó el cliente.
});

test('NaN e Infinity se rechazan (no llegan a la BD como null o error de tipo)', () => {
  assert.equal(esCobroError(resolveCobro({ amount: Number.NaN })), true);
  assert.equal(esCobroError(resolveCobro({ amount: Number.POSITIVE_INFINITY })), true);
});

// ─── Los tres rieles son exactamente los del CHECK de la BD ───────────────────

test('los tres rieles válidos pasan y son los del CHECK de la migración', () => {
  for (const method of ['efectivo', 'tarjeta', 'transferencia']) {
    assert.equal(ok(resolveCobro({ amount: 100, method })).method, method);
  }
});
