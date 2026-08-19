// ─── Tests de revenueTrend (Ingresos · Negocio) — matemática de fechas ────────
// El filo original: el "mismo tramo" del mes anterior por DÍA DE MES, con el borde
// de mes (día que no existe en el mes anterior → clamp al mes completo).
//
// 🔴 **Reescritos en S7-BUG-01.** Este módulo armaba sus ventanas con `Date.UTC`
//    puro, y estos tests lo confirmaban usando `Date.UTC` para expresar lo
//    esperado — o sea que el test hablaba el mismo idioma equivocado que el
//    código y no podía atrapar el bug. Ahora las ventanas salen de
//    `lib/timeWindows` en la tz del NEGOCIO, y las expectativas se escriben en
//    ISO absoluto, que es lo único que no se puede "acordar" con el código.
//
// Lo que fijan y no se puede mover:
//   · el mes del negocio EMPIEZA a las 06:00Z en México (00:00 local del día 1),
//     no a las 00:00Z — esas seis horas son la noche del último día del mes
//     anterior, y son el bug entero;
//   · las ventanas son SEMIABIERTAS [inicio, fin);
//   · el borde de mes hace clamp y lo avisa.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tramoRanges, monthlySpecs, prevMonthName } from '../apps/lifestyle/src/lib/revenueTrend';

const MX = 'America/Mexico_City';   // UTC-6 todo el año
const KI = 'Pacific/Kiritimati';    // UTC+14

const iso = (ms: number) => new Date(ms).toISOString();

// ─── ★ El bug ────────────────────────────────────────────────────────────────

test('★ el mes del negocio NO empieza a las 00:00Z (ahí estaba el bug)', () => {
  const now = Date.parse('2026-08-18T22:00:00Z');
  const tr = tramoRanges(now, MX);
  assert.equal(iso(tr.thisMonth.startMs), '2026-08-01T06:00:00.000Z');
  assert.notEqual(iso(tr.thisMonth.startMs), '2026-08-01T00:00:00.000Z',
    'con Date.UTC entraban seis horas del 31 de julio: los $520 medidos en dv3-6');
});

test('★ la misma función da ventanas distintas según la tz del negocio', () => {
  const now = Date.parse('2026-08-18T22:00:00Z');
  assert.notEqual(
    tramoRanges(now, MX).thisMonth.startMs,
    tramoRanges(now, KI).thisMonth.startMs,
  );
});

// ─── Tramo normal ─────────────────────────────────────────────────────────────

test('tramoRanges: mes en curso hasta ahora vs mismo tramo del mes anterior', () => {
  const now = Date.parse('2026-07-15T18:00:00Z');   // 15 jul, mediodía en México
  const tr = tramoRanges(now, MX);

  assert.equal(tr.elapsedDay, 15);
  assert.equal(tr.prevClamped, false);
  assert.equal(iso(tr.thisMonth.startMs), '2026-07-01T06:00:00.000Z');
  assert.equal(tr.thisMonth.endMs, now);
  assert.equal(iso(tr.prevTramo.startMs), '2026-06-01T06:00:00.000Z');
  // Semiabierta: hasta el inicio del 16 de junio = todo el 15 incluido.
  assert.equal(iso(tr.prevTramo.endMs), '2026-06-16T06:00:00.000Z');
});

test('★ las ventanas son semiabiertas: ninguna termina en 23:59:59.999', () => {
  const tr = tramoRanges(Date.parse('2026-07-15T18:00:00Z'), MX);
  assert.equal(iso(tr.prevTramo.endMs).endsWith('999Z'), false);
});

// ─── Borde de mes (🔴) ───────────────────────────────────────────────────────

test('tramoRanges: día 31 con mes anterior de 30 días → clamp a mes completo', () => {
  const now = Date.parse('2026-07-31T16:00:00Z');   // 31 jul, 10:00 en México
  const tr = tramoRanges(now, MX);
  assert.equal(tr.elapsedDay, 31);
  assert.equal(tr.prevClamped, true);
  assert.equal(iso(tr.prevTramo.startMs), '2026-06-01T06:00:00.000Z');
  assert.equal(iso(tr.prevTramo.endMs),   '2026-07-01T06:00:00.000Z', 'junio completo');
});

test('tramoRanges: 31-mar contra febrero no bisiesto → clamp al 28', () => {
  const now = Date.parse('2026-03-31T18:00:00Z');
  const tr = tramoRanges(now, MX);
  assert.equal(tr.prevClamped, true);
  assert.equal(iso(tr.prevTramo.endMs), '2026-03-01T06:00:00.000Z', 'febrero completo');
});

// ─── Serie de meses ──────────────────────────────────────────────────────────

test('monthlySpecs: 6 meses del más viejo al más nuevo; el último parcial', () => {
  const now = Date.parse('2026-08-18T22:00:00Z');
  const specs = monthlySpecs(now, MX, 6);

  assert.equal(specs.length, 6);
  assert.deepEqual(specs.map((s) => s.label), ['marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto']);
  assert.equal(specs[5]!.partial, true);
  assert.equal(specs[5]!.endMs, now, 'el mes en curso termina AHORA');
  assert.equal(specs.slice(0, 5).every((s) => !s.partial), true);
  // Cada mes cerrado termina donde empieza el siguiente: sin huecos ni solapes.
  for (let i = 0; i < 4; i++) {
    assert.equal(specs[i]!.endMs, specs[i + 1]!.startMs, `${specs[i]!.label} → ${specs[i + 1]!.label}`);
  }
  assert.equal(iso(specs[0]!.startMs), '2026-03-01T06:00:00.000Z');
});

test('monthlySpecs: wrap de año → etiquetas desambiguadas con el año', () => {
  const specs = monthlySpecs(Date.parse('2026-02-10T18:00:00Z'), MX, 6);
  assert.deepEqual(specs.map((s) => s.label),
    ["septiembre '25", "octubre '25", "noviembre '25", "diciembre '25", 'enero', 'febrero']);
});

// ─── El nombre del mes anterior ──────────────────────────────────────────────

test('★ prevMonthName usa la tz del negocio, no UTC', () => {
  // 23:00 del 31 de julio en México = 05:00Z del 1 de agosto. En UTC ya es agosto,
  // así que el "mes anterior" leído en UTC sería julio — el mes en el que todavía
  // está parado el dueño.
  const now = Date.parse('2026-08-01T05:00:00Z');
  assert.equal(prevMonthName(now, MX), 'junio', 'para el negocio sigue siendo 31 de julio');
});

test('prevMonthName con wrap de año', () => {
  assert.equal(prevMonthName(Date.parse('2026-01-15T18:00:00Z'), MX), 'diciembre');
});
