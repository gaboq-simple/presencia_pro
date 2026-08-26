// ─── Tests de cobro (D2) — validación pura del monto + riel al completar ──────
// El contrato del módulo, fijado acá: **ninguno de los dos campos se escribe si
// nadie lo declaró**, y cada `undefined` significa una cosa distinta:
//   · el MONTO `undefined` → que lo selle el trigger seal_appointment_price con
//     el precio de lista. Escribirlo afirmaría que una persona lo confirmó;
//   · el RIEL `undefined` → que la columna quede NULL, o sea "no sé cómo
//     pagaron". Hasta S9-OPS-06 caía en `'efectivo'` por default, y eso era
//     fabricar evidencia: dos de los tres "Terminó" del barbero no preguntaban
//     nada, así que el sistema afirmaba un riel que nadie miró y el corte —que
//     compara riel por riel contra artefactos físicos— producía un descuadre
//     espejo del tamaño de la tarjeta, todos los días.
// `DEFAULT_RAIL` sigue exportado porque la hoja de CAJA sí lo necesita (su
// columna es NOT NULL); lo que ya no hace es entrar solo por la puerta de atrás.
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

test('sin tocar nada: NI riel NI monto se escriben (S9-OPS-06)', () => {
  const r = ok(resolveCobro(undefined));
  assert.equal(r.method, undefined, 'el riel NO cae al default: nadie lo declaró');
  assert.equal(r.amount, undefined);
});

test('objeto vacío o campos vacíos = igual que no tocar nada', () => {
  for (const input of [{}, { amount: '', method: '' }, { amount: null, method: null }]) {
    const r = ok(resolveCobro(input));
    assert.equal(r.method, undefined);
    assert.equal(r.amount, undefined);
  }
});

test('el default de la caja NO se cuela en el cobro de una cita', () => {
  // Contraprueba del arreglo: `DEFAULT_RAIL` existe y vale 'efectivo', y aun así
  // `resolveCobro` no lo devuelve jamás por su cuenta. Si alguien reintrodujera
  // el `?? DEFAULT_RAIL`, esta prueba es la que lo detiene.
  assert.equal(DEFAULT_RAIL, 'efectivo');
  for (const input of [undefined, {}, { amount: 200 }, { amount: '', method: null }]) {
    assert.notEqual(ok(resolveCobro(input)).method, DEFAULT_RAIL);
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

test('solo monto editado: el riel queda SIN DECLARAR', () => {
  // Tocar el monto no es declarar cómo pagaron. Antes esto escribía 'efectivo'.
  const r = ok(resolveCobro({ amount: 180 }, 200));
  assert.equal(r.amount, 180);
  assert.equal(r.method, undefined);
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
