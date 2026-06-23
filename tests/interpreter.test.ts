// R2 Pieza A — Tests del intérprete puro (interpret()).
// Cubre la tabla del plan: las 3 formas de hora ("a las 5", "5pm", "10:15"),
// la divergencia de "mañana" suelto (es FECHA, no hora), ordinales,
// afirmación/negación neutras, y dígito desnudo (índice potencial).
//
// interpret() es 100% determinista y NO hace red/LLM/Supabase. No decide política
// de estado: solo detecta señales crudas (guardarraíles B1/B2).
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { interpret } from '../packages/engine/src/bot/lifestyle/interpreter';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ  = 'America/Mexico_City';                    // UTC-6 fijo (México sin DST)
const NOW = new Date('2026-06-15T15:00:00.000Z');     // lunes 2026-06-15 ~09:00 local
const TODAY    = '2026-06-15';
const TOMORROW = '2026-06-16';

function run(message: string) {
  return interpret({ message, now: NOW, timezone: TZ });
}

// ─── Las 3 formas de hora ─────────────────────────────────────────────────────

test('hora forma 1: "a las 5" → hour 5, period null', () => {
  const r = run('a las 5');
  assert.deepEqual(r.time, { hour: 5, minute: 0, period: null });
});

// "5pm" PEGADO: la hora se reconoce (hour 5) Y el marcador `period` es 'pm'. El
// lookbehind negativo de letra reconoce el marcador pegado al dígito igual que
// "5 pm" con espacio. Decisión de producto: "5pm" es PM explícito, no ambiguo.
test('hora forma 2: "5pm" (pegado) → hour 5, period pm (marcador pegado reconocido)', () => {
  const r = run('5pm');
  assert.deepEqual(r.time, { hour: 5, minute: 0, period: 'pm' });
});

test('hora forma 2: "5am" (pegado) → hour 5, period am', () => {
  const r = run('5am');
  assert.deepEqual(r.time, { hour: 5, minute: 0, period: 'am' });
});

test('hora forma 2: "5 pm" (con espacio) → hour 5, period pm', () => {
  const r = run('5 pm');
  assert.deepEqual(r.time, { hour: 5, minute: 0, period: 'pm' });
});

test('hora forma 3: "10:15" → hour 10, minute 15, period null', () => {
  const r = run('10:15');
  assert.deepEqual(r.time, { hour: 10, minute: 15, period: null });
});

test('hora "a las 7 pm" → hour 7, period pm (caso smoke Imagen 1)', () => {
  const r = run('a las 7 pm');
  assert.deepEqual(r.time, { hour: 7, minute: 0, period: 'pm' });
});

test('hora "de la mañana" → period am', () => {
  const r = run('a las 5 de la mañana');
  assert.equal(r.time?.period, 'am');
});

// ─── Divergencia de "mañana" suelto: es FECHA, no hora ────────────────────────

test('"mañana" suelto → date = mañana, time = null (no es marcador de hora)', () => {
  const r = run('mañana');
  assert.equal(r.date, TOMORROW);
  assert.equal(r.time, null);
});

test('"mañana a las 5" → date = mañana + time hour 5 (period null, "mañana" no es am)', () => {
  const r = run('mañana a las 5');
  assert.equal(r.date, TOMORROW);
  assert.deepEqual(r.time, { hour: 5, minute: 0, period: null });
});

test('"hoy" → date = hoy', () => {
  assert.equal(run('hoy').date, TODAY);
});

test('sin fecha → date null', () => {
  assert.equal(run('a las 5').date, null);
});

// ─── Ordinales ────────────────────────────────────────────────────────────────

test('ordinal "la primera" → 0', () => {
  assert.equal(run('la primera').ordinal, 0);
});

test('ordinal "el segundo" → 1', () => {
  assert.equal(run('el segundo').ordinal, 1);
});

test('ordinal "la tercera" → 2', () => {
  assert.equal(run('la tercera').ordinal, 2);
});

test('ordinal "el último" → null (resolución exige conteo = política de estado)', () => {
  assert.equal(run('el último').ordinal, null);
});

test('sin ordinal → null', () => {
  assert.equal(run('a las 5').ordinal, null);
});

// ─── Afirmación / negación (neutras) ──────────────────────────────────────────

test('afirmación "sí" (con acento) → true', () => {
  assert.equal(run('sí').affirmation, true);
});

test('afirmación "va" (mensaje completo) → true', () => {
  assert.equal(run('va').affirmation, true);
});

test('afirmación "dale" (anclada) → true', () => {
  assert.equal(run('dale').affirmation, true);
});

test('negación "no" → false', () => {
  assert.equal(run('no').affirmation, false);
});

test('"¿va a estar?" → affirmation null (token corto NO embebido)', () => {
  assert.equal(run('¿va a estar?').affirmation, null);
});

test('"no, a las 6" → affirmation null + time hour 6 (corrección, no negación)', () => {
  const r = run('no, a las 6');
  assert.equal(r.affirmation, null);
  assert.deepEqual(r.time, { hour: 6, minute: 0, period: null });
});

test('mensaje neutro sin sí/no → affirmation null', () => {
  assert.equal(run('a las 5').affirmation, null);
});

// ─── Dígito desnudo (índice potencial) ────────────────────────────────────────

test('dígito desnudo "5" → bareDigit 5, time null', () => {
  const r = run('5');
  assert.equal(r.bareDigit, 5);
  assert.equal(r.time, null);
});

test('dígito desnudo "2" → bareDigit 2', () => {
  assert.equal(run('2').bareDigit, 2);
});

test('"10:15" NO es dígito desnudo (es hora) → bareDigit null', () => {
  assert.equal(run('10:15').bareDigit, null);
});

test('"a las 5" NO es dígito desnudo (es hora) → bareDigit null', () => {
  assert.equal(run('a las 5').bareDigit, null);
});

// ─── Side question ────────────────────────────────────────────────────────────

test('"¿cuánto cuesta?" → hasSideQuestion true', () => {
  assert.equal(run('¿cuánto cuesta?').hasSideQuestion, true);
});

test('"a las 5" → hasSideQuestion false', () => {
  assert.equal(run('a las 5').hasSideQuestion, false);
});

// ─── raw normalizado ──────────────────────────────────────────────────────────

test('raw normaliza (minúsculas, sin diacríticos)', () => {
  assert.equal(run('Mañana A LAS 5').raw, 'manana a las 5');
});
