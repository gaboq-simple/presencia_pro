// ─── Tests del héroe de la semana (dv3-3') — matemática pura ──────────────────
// El caso numérico del plan REHECHO por la capa de dinero: el héroe ya no suma
// agenda × precio de lista, suma **Cobrado** (lo que alguien firmó), así que a
// los días entra también el dinero de fuera de agenda.
//
// Lo que estos tests fijan y no se puede mover sin romper el significado:
//   · el strip pinta SOLO el pasado (el futuro es pista vacía, no un cero);
//   · el delta compara el MISMO TRAMO (lun→hoy vs lun→mismo día), porque contra
//     una semana completa un lunes siempre parecería un desastre;
//   · sin nada la semana pasada NO hay comparación (ni "+100%" ni "vs $0").
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSemanaHero,
  etiquetaTramo,
  type DiaSemana,
} from '../apps/lifestyle/src/lib/semanaCalc';

/** Lunes 2026-08-10 … domingo 2026-08-16. Hoy = miércoles 12. */
const L = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
const LP = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const HOY = L[2]!; // miércoles

function semana(fechas: readonly string[], montos: readonly number[], cerrados: readonly number[] = [6]): DiaSemana[] {
  return fechas.map((fecha, i) => ({ fecha, cobrado: montos[i] ?? 0, cerrado: cerrados.includes(i) }));
}

// ─── El caso numérico, rehecho con Cobrado ────────────────────────────────────
// lun: 2 citas cobradas (200 + 320) = 520
// mar: 1 cita (400, cobro editado sobre lista 450) + 1 entrada de caja (150) = 550
// mié (hoy): 1 cita (200) = 200
// → días [520, 550, 200, 0, 0, 0, 0] · titular 1,270
// Semana pasada mismo tramo (lun→mié) = 300 + 400 + 200 = 900 → delta +370

test('el caso del plan, con Cobrado: titular 1,270 y delta +370', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [520, 550, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [300, 400, 200, 380, 410, 600, 0]),
    hoy: HOY,
  });
  assert.equal(h.titular, 1270);
  assert.equal(h.tramoPasado, 900, 'compara lun→mié, no la semana entera');
  assert.equal(h.delta, 370);
});

test('la entrada de caja del martes ESTÁ dentro del titular (es Cobrado, no agenda)', () => {
  const conEntrada = computeSemanaHero({
    estaSemana:   semana(L,  [520, 550, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [0, 0, 0, 0, 0, 0, 0]),
    hoy: HOY,
  });
  const soloAgenda = computeSemanaHero({
    estaSemana:   semana(L,  [520, 400, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [0, 0, 0, 0, 0, 0, 0]),
    hoy: HOY,
  });
  assert.equal(conEntrada.titular - soloAgenda.titular, 150);
});

// ─── El strip: solo el pasado ─────────────────────────────────────────────────

test('los días posteriores a hoy son FUTURO: pista vacía, no ceros', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [520, 550, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [1, 1, 1, 1, 1, 1, 0]),
    hoy: HOY,
  });
  assert.deepEqual(h.celdas.map((c) => c.esFuturo), [false, false, false, true, true, true, true]);
  assert.deepEqual(h.celdas.map((c) => c.esHoy), [false, false, true, false, false, false, false]);
});

test('la altura es relativa al MEJOR día de la semana, y el cerrado no compite', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L, [520, 550, 200, 0, 0, 0, 9999]), // el domingo cerrado no manda
    semanaPasada: semana(LP, [0, 0, 0, 0, 0, 0, 0]),
    hoy: HOY,
  });
  assert.equal(h.celdas[1]!.altura, 1);                 // el martes es el máximo
  assert.equal(Math.round(h.celdas[0]!.altura * 100), 95);
  assert.equal(h.celdas[6]!.altura, 0, 'el día cerrado no tiene barra');
});

test('una semana sin nada cobrado: todas las alturas en 0, sin dividir por cero', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L, [0, 0, 0, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [0, 0, 0, 0, 0, 0, 0]),
    hoy: HOY,
  });
  assert.equal(h.titular, 0);
  assert.equal(h.diasConCobro, 0);
  assert.ok(h.celdas.every((c) => c.altura === 0));
});

// ─── El delta: honesto o ausente ──────────────────────────────────────────────

test('sin nada la semana pasada NO hay comparación (ni "+100%" ni "vs $0")', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [520, 550, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [0, 0, 0, 900, 900, 900, 0]), // hubo, pero DESPUÉS del tramo
    hoy: HOY,
  });
  assert.equal(h.tramoPasado, null, 'el tramo espejo está vacío: no se compara contra el resto');
  assert.equal(h.delta, null);
});

test('el delta puede ser negativo y se rinde tal cual (dato, no juicio)', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [100, 0, 0, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [500, 0, 0, 0, 0, 0, 0]),
    hoy: L[0]!,
  });
  assert.equal(h.delta, -400);
});

test('el lunes compara solo el lunes', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [520, 999, 999, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [300, 999, 999, 0, 0, 0, 0]),
    hoy: L[0]!,
  });
  assert.equal(h.titular, 520);
  assert.equal(h.tramoPasado, 300);
  assert.equal(etiquetaTramo(h), 'lun');
});

test('el domingo compara la semana entera', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [1, 1, 1, 1, 1, 1, 1], []),
    semanaPasada: semana(LP, [2, 2, 2, 2, 2, 2, 2], []),
    hoy: L[6]!,
  });
  assert.equal(h.titular, 7);
  assert.equal(h.tramoPasado, 14);
  assert.equal(etiquetaTramo(h), 'lun–dom');
});

// ─── Degradado ────────────────────────────────────────────────────────────────

test('un "hoy" fuera de la semana degrada a futuro completo, no revienta', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [520, 550, 200, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [1, 1, 1, 1, 1, 1, 1]),
    hoy: '2026-01-01',
  });
  assert.equal(h.titular, 0);
  assert.equal(h.delta, null);
  assert.equal(etiquetaTramo(h), '');
  assert.ok(h.celdas.every((c) => !c.esHoy && !c.esFuturo));
});

test('centavos exactos, sin ruido de float', () => {
  const h = computeSemanaHero({
    estaSemana:   semana(L,  [0.1, 0.2, 0, 0, 0, 0, 0]),
    semanaPasada: semana(LP, [0.1, 0, 0, 0, 0, 0, 0]),
    hoy: HOY,
  });
  assert.equal(h.titular, 0.3);
  assert.equal(h.delta, 0.2);
});

test('no muta lo que recibe', () => {
  const a = semana(L, [1, 2, 3, 0, 0, 0, 0]);
  const b = semana(LP, [1, 1, 1, 0, 0, 0, 0]);
  const ca = a.map((x) => ({ ...x }));
  const cb = b.map((x) => ({ ...x }));
  computeSemanaHero({ estaSemana: a, semanaPasada: b, hoy: HOY });
  assert.deepEqual(a, ca);
  assert.deepEqual(b, cb);
});
