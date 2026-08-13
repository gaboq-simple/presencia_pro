// ─── Tests de cabos sueltos (D3) — matemática pura ────────────────────────────
// Un cabo suelto desaparece del cuadre sin dejar rastro: no suma al cobrado (no
// está completed) ni cuenta como falta (no está no_show). Estos tests fijan qué
// entra, qué NO, y el orden — que es parte del significado: lo más viejo primero,
// porque lo que lleva más tiempo colgando es lo que más urge cerrar.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCabos,
  etiquetaCabos,
  VENTANA_CABOS_DIAS,
  type CitaSinResolver,
} from '../apps/lifestyle/src/lib/cabos';

const AHORA = Date.parse('2026-08-13T18:00:00.000Z');
const DIA   = 24 * 60 * 60_000;

function cita(over: Partial<CitaSinResolver> & { id: string; startsAtMs: number }): CitaSinResolver {
  return { status: 'confirmed', llego: false, cliente: null, ...over };
}

// ─── Qué es un cabo suelto ────────────────────────────────────────────────────

test('cuenta pending y confirmed del pasado; ignora lo resuelto', () => {
  const r = computeCabos([
    cita({ id: 'p', startsAtMs: AHORA - DIA, status: 'pending' }),
    cita({ id: 'c', startsAtMs: AHORA - DIA, status: 'confirmed' }),
    cita({ id: 'x', startsAtMs: AHORA - DIA, status: 'completed' }),
    cita({ id: 'n', startsAtMs: AHORA - DIA, status: 'no_show' }),
    cita({ id: 'k', startsAtMs: AHORA - DIA, status: 'cancelled' }),
  ], AHORA);
  assert.deepEqual(r.lista.map((c) => c.id), ['p', 'c']);
  assert.equal(r.total, 2);
});

test('el futuro NO es un cabo suelto — todavía no le toca', () => {
  const r = computeCabos([
    cita({ id: 'futura', startsAtMs: AHORA + 60_000 }),
    cita({ id: 'pasada', startsAtMs: AHORA - 60_000 }),
  ], AHORA);
  assert.deepEqual(r.lista.map((c) => c.id), ['pasada']);
});

test('la ventana corta lo viejo: más allá de 14 días es historia, no un cabo', () => {
  const r = computeCabos([
    cita({ id: 'dentro', startsAtMs: AHORA - 13 * DIA }),
    cita({ id: 'borde',  startsAtMs: AHORA - VENTANA_CABOS_DIAS * DIA + 1000 }),
    cita({ id: 'fuera',  startsAtMs: AHORA - 15 * DIA }),
  ], AHORA);
  assert.deepEqual(r.lista.map((c) => c.id).sort(), ['borde', 'dentro']);
});

test('la ventana es configurable (misma función, otro alcance)', () => {
  const citas = [cita({ id: 'a', startsAtMs: AHORA - 5 * DIA })];
  assert.equal(computeCabos(citas, AHORA, 14).total, 1);
  assert.equal(computeCabos(citas, AHORA, 3).total, 0);
});

// ─── El orden es parte del significado ────────────────────────────────────────

test('ordena del más VIEJO al más reciente', () => {
  const r = computeCabos([
    cita({ id: 'ayer',      startsAtMs: AHORA - 1 * DIA }),
    cita({ id: 'hace7',     startsAtMs: AHORA - 7 * DIA }),
    cita({ id: 'hace3',     startsAtMs: AHORA - 3 * DIA }),
  ], AHORA);
  assert.deepEqual(r.lista.map((c) => c.id), ['hace7', 'hace3', 'ayer']);
});

// ─── El subconjunto que puede estar tapando dinero ────────────────────────────

test('conLlegada aísla las citas donde el cliente SÍ llegó y nadie cerró', () => {
  const r = computeCabos([
    cita({ id: 'llego1', startsAtMs: AHORA - DIA, llego: true }),
    cita({ id: 'llego2', startsAtMs: AHORA - 2 * DIA, llego: true }),
    cita({ id: 'nunca',  startsAtMs: AHORA - DIA, llego: false }),
  ], AHORA);
  assert.equal(r.total, 3);
  assert.equal(r.conLlegada, 2);
});

// ─── Degradado y copy ─────────────────────────────────────────────────────────

test('sin citas: cero, lista vacía, sin reventar', () => {
  const r = computeCabos([], AHORA);
  assert.equal(r.total, 0);
  assert.deepEqual(r.lista, []);
  assert.equal(r.conLlegada, 0);
});

test('la etiqueta respeta singular/plural y no juzga', () => {
  assert.equal(etiquetaCabos(0), 'Todo el día está cerrado');
  assert.equal(etiquetaCabos(1), '1 cita sin cerrar');
  assert.equal(etiquetaCabos(7), '7 citas sin cerrar');
});

test('no muta la lista de entrada', () => {
  const citas = [
    cita({ id: 'b', startsAtMs: AHORA - DIA }),
    cita({ id: 'a', startsAtMs: AHORA - 2 * DIA }),
  ];
  const copia = citas.map((c) => ({ ...c }));
  computeCabos(citas, AHORA);
  assert.deepEqual(citas, copia);
});
