// ─── Tests de "El equipo · esta semana" (dv3-4') — matemática pura ───────────
// El caso numérico del paso: la suma de los $ de las filas ES el total del
// encabezado. No es una coincidencia que haya que cuidar — el total se deriva de
// las mismas filas, y este test lo deja atado.
//
// Lo demás que fijan estos tests:
//   · staff sin citas NO se lista (una fila en cero ocupa lo mismo y no informa);
//   · pero un barbero con SOLO faltas sí se lista — trabajó la semana, y filtrar
//     por dinero lo borraría junto con su dato;
//   · el orden de las filas es por ingreso DESC, y el COLOR no sale de ese orden
//     (es identidad: tiene que coincidir con el riel de arriba);
//   · sin faltas, la línea del pie no existe (un "0 faltas" se lee como elogio).
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeEquipoSemana,
  lineaDeFaltas,
  type EquipoStaffInput,
} from '../apps/lifestyle/src/lib/equipoSemana';
import { staffColorIndex } from '../apps/lifestyle/src/lib/staffColors';

const STAFF = [
  { id: 'mig', name: 'Miguel' },
  { id: 'car', name: 'Carlos' },
  { id: 'bet', name: 'Beto' },
  { id: 'and', name: 'Andrés' },
  { id: 'die', name: 'Diego' },
  { id: 'asi', name: 'Asistente' },
];
const COLOR = staffColorIndex(STAFF);

/** Los números de la maqueta. Total $8,690. */
const SEMANA: EquipoStaffInput[] = [
  { staffId: 'mig', name: 'Miguel',    revenue: 3740, completed: 17, noShow: 1 },
  { staffId: 'car', name: 'Carlos',    revenue: 1680, completed: 8,  noShow: 0 },
  { staffId: 'bet', name: 'Beto',      revenue: 1660, completed: 8,  noShow: 1 },
  { staffId: 'and', name: 'Andrés',    revenue: 1030, completed: 5,  noShow: 0 },
  { staffId: 'die', name: 'Diego',     revenue: 580,  completed: 3,  noShow: 0 },
  { staffId: 'asi', name: 'Asistente', revenue: 0,    completed: 0,  noShow: 0 },
];

test('la suma de las filas ES el total del encabezado', () => {
  const r = computeEquipoSemana(SEMANA, COLOR);
  assert.equal(r.total, 8690);
  assert.equal(r.filas.reduce((t, f) => t + f.revenue, 0), r.total);
});

test('staff sin citas no se lista', () => {
  const r = computeEquipoSemana(SEMANA, COLOR);
  assert.equal(r.filas.length, 5);
  assert.equal(r.filas.some((f) => f.staffId === 'asi'), false);
});

test('un barbero con SOLO faltas sí se lista (trabajó, y su falta es el dato)', () => {
  const r = computeEquipoSemana(
    [{ staffId: 'die', name: 'Diego', revenue: 0, completed: 0, noShow: 2 }],
    COLOR,
  );
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0]!.revenue, 0);
  assert.equal(r.faltas, 'Diego 2 faltas.');
});

test('orden por ingreso DESC; el color NO sale de ese orden', () => {
  const r = computeEquipoSemana(SEMANA, COLOR);
  assert.deepEqual(r.filas.map((f) => f.name), ['Miguel', 'Carlos', 'Beto', 'Andrés', 'Diego']);
  // Alfabético: Andrés 0 · Asistente 1 · Beto 2 · Carlos 3 · Diego 4 · Miguel 5.
  assert.deepEqual(r.filas.map((f) => f.colorIndex), [5, 3, 2, 0, 4]);
});

test('la barra es proporcional al máximo de la serie, no al total', () => {
  const r = computeEquipoSemana(SEMANA, COLOR);
  assert.equal(r.filas[0]!.pct, 100);                       // Miguel manda la escala
  assert.equal(r.filas[1]!.pct, Math.round((1680 / 3740) * 10000) / 100);
  // El share sí es contra el total (es lo que va en el texto accesible).
  assert.equal(Math.round(r.filas[0]!.share * 1000) / 1000, 0.43);
});

test('un valor > 0 nunca desaparece por redondeo (piso visual del kit)', () => {
  const r = computeEquipoSemana([
    { staffId: 'mig', name: 'Miguel', revenue: 10000, completed: 40, noShow: 0 },
    { staffId: 'die', name: 'Diego',  revenue: 20,    completed: 1,  noShow: 0 },
  ], COLOR);
  assert.ok(r.filas[1]!.pct >= 2);
});

test('sin faltas no hay línea de faltas', () => {
  const sinFaltas = SEMANA.map((e) => ({ ...e, noShow: 0 }));
  assert.equal(computeEquipoSemana(sinFaltas, COLOR).faltas, '');
});

test('la línea de faltas nombra a quien faltó y cierra con el resto', () => {
  const r = computeEquipoSemana(SEMANA, COLOR);
  assert.equal(r.faltas, 'Miguel 1 falta · Beto 1 falta · el resto sin faltas.');
});

test('si TODOS tuvieron faltas, no se agrega "el resto"', () => {
  const r = computeEquipoSemana([
    { staffId: 'car', name: 'Carlos', revenue: 100, completed: 1, noShow: 1 },
    { staffId: 'bet', name: 'Beto',   revenue: 50,  completed: 1, noShow: 3 },
  ], COLOR);
  assert.equal(r.faltas, 'Carlos 1 falta · Beto 3 faltas.');
  assert.equal(lineaDeFaltas([]), '');
});

test('semana sin nadie: estado vacío, no cinco ceros', () => {
  const r = computeEquipoSemana(
    STAFF.map((s) => ({ staffId: s.id, name: s.name, revenue: 0, completed: 0, noShow: 0 })),
    COLOR,
  );
  assert.equal(r.vacio, true);
  assert.deepEqual(r.filas, []);
  assert.equal(r.total, 0);
});
