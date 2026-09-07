// ─── El período: la misma regla del día, repetida y sumada (M5) ──────────────
// Lo que estos tests protegen no es una cuenta: es que NO EXISTA una segunda
// regla del dinero. El período corre `computeCobrado` por día y suma; si alguien
// escribiera acá una agregación propia, el período y el día dirían números
// distintos y no habría forma de saber a cuál creerle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePeriodo, diasDelRango, lunesDe, rangoDelPeriodo, topeDelPeriodo,
  type CitaDelPeriodo, type MovimientoDelPeriodo,
} from '../apps/lifestyle/src/lib/periodo';
import { computeCobrado } from '../apps/lifestyle/src/lib/cobrado';

const citas: CitaDelPeriodo[] = [
  { fecha: '2026-09-01', amount: 200 },
  { fecha: '2026-09-01', amount: 350 },
  { fecha: '2026-09-03', amount: 180 },
];
const movs: MovimientoDelPeriodo[] = [
  { fecha: '2026-09-01', type: 'entrada', amount: 150 },
  { fecha: '2026-09-02', type: 'salida',  amount: 500 },
];

test('el total del período es la SUMA de los totales diarios, no otra cuenta', () => {
  const p = computePeriodo('2026-09-01', '2026-09-03', citas, movs);
  const suma = p.dias.reduce((t, d) => t + d.cobrado.total, 0);
  assert.equal(p.total, suma);
  // Y ese diario es literalmente el de `lib/cobrado.ts`, no una copia:
  assert.equal(
    p.dias[0]?.cobrado.total,
    computeCobrado([{ amount: 200 }, { amount: 350 }], [{ type: 'entrada', amount: 150 }]).total,
  );
});

test('las salidas van aparte y JAMÁS se restan del total', () => {
  const p = computePeriodo('2026-09-01', '2026-09-03', citas, movs);
  assert.equal(p.total, 880);    // 550 + 150 + 180
  assert.equal(p.salidas, 500);
  assert.notEqual(p.total, 380, 'netear esconde las dos mitades detrás de un número que no es ninguna');
  assert.equal(p.deAgenda, 730);
  assert.equal(p.entradas, 150);
});

test('un día sin nada aparece en la lista, en blanco y sin acusar a nadie', () => {
  const p = computePeriodo('2026-09-01', '2026-09-05', citas, movs);
  assert.equal(p.dias.length, 5, 'el rango sale completo: el hueco se VE');
  assert.equal(p.dias[3]?.enBlanco, true);
  assert.equal(p.diasEnBlanco, 2); // 04 y 05
  // Un día con solo salidas NO está en blanco: alguien registró algo.
  assert.equal(p.dias[1]?.enBlanco, false);
});

// ─── Cerrado ≠ en cero ────────────────────────────────────────────────────────
// La primera versión de este módulo decía que la distinción era imposible y era
// FALSO: `semanaHero` ya la hacía con `staff_availability`. Sin ella, cualquier
// barbería que cierra los domingos vería cuatro huecos falsos por mes, y un aviso
// que grita en falso enseña a ignorarlo.

const ABRE_LUN_A_SAB = new Set([1, 2, 3, 4, 5, 6]);

test('★ un domingo de cierre NO cuenta como día sin registro', () => {
  // 2026-09-06 es domingo.
  const p = computePeriodo('2026-09-05', '2026-09-06', [], [], ABRE_LUN_A_SAB);
  const domingo = p.dias.find((d) => d.fecha === '2026-09-06');
  assert.equal(domingo?.cerrado, true);
  assert.equal(domingo?.enBlanco, true, 'sigue estando vacío…');
  assert.equal(p.diasEnBlanco, 1, '…pero el único que cuenta es el sábado, que abre');
  assert.equal(p.diasCerrados, 1);
});

test('sin horarios cargados NO se pinta todo cerrado', () => {
  // Un negocio nuevo sin `staff_availability` no puede leerse como cerrado
  // siempre: sería una semana en gris por falta de configuración.
  const p = computePeriodo('2026-09-05', '2026-09-06', [], [], new Set());
  assert.equal(p.diasCerrados, 0);
  assert.equal(p.diasEnBlanco, 2);
});

test('un día abierto CON registro no cuenta como hueco aunque el cobrado sea 0', () => {
  // Registrar una salida es registrar: el día no está en blanco.
  const p = computePeriodo('2026-09-04', '2026-09-04',
    [], [{ fecha: '2026-09-04', type: 'salida', amount: 300 }], ABRE_LUN_A_SAB);
  assert.equal(p.diasEnBlanco, 0);
  assert.equal(p.total, 0);
  assert.equal(p.salidas, 300);
});

test('el mejor día ignora los días en blanco', () => {
  const p = computePeriodo('2026-09-01', '2026-09-05', citas, movs);
  assert.equal(p.mejorDia?.fecha, '2026-09-01');
});

test('un período sin un solo registro no inventa un mejor día', () => {
  const p = computePeriodo('2026-09-01', '2026-09-03', [], []);
  assert.equal(p.mejorDia, null);
  assert.equal(p.total, 0);
  assert.equal(p.diasEnBlanco, 3);
});

// ─── La ceguera del corte, que es lo que este paso podía romper ───────────────

test('★ el período NO llega hasta hoy: llegaría al esperado que nadie contó', () => {
  // Si incluyera hoy, su total sería —menos el fondo y sin el reparto por riel—
  // el número que la persona todavía tiene que contar a ciegas.
  assert.equal(topeDelPeriodo('2026-09-06', false), '2026-09-05');
});

test('★ …salvo que el corte de hoy YA esté firmado: ahí el número ya se reveló', () => {
  assert.equal(topeDelPeriodo('2026-09-06', true), '2026-09-06');
});

test('el rango de la semana usa el lunes→domingo del repo, no una tercera definición', () => {
  assert.equal(lunesDe('2026-09-06'), '2026-08-31'); // domingo → su lunes es el 31
  assert.equal(lunesDe('2026-08-31'), '2026-08-31');
  const r = rangoDelPeriodo('semana', '2026-09-06', '2026-09-05');
  assert.deepEqual(r, { desde: '2026-08-31', hasta: '2026-09-05' });
});

test('el mes arranca el 1 y el tope lo corta', () => {
  assert.deepEqual(rangoDelPeriodo('mes', '2026-09-06', '2026-09-05'),
    { desde: '2026-09-01', hasta: '2026-09-05' });
});

test('el día 1 del mes con tope en ayer no produce un rango invertido', () => {
  // Ayer cae en el mes anterior: el rango se colapsa al propio día 1 en vez de ir
  // hacia atrás, que mostraría días que no son de este mes.
  const r = rangoDelPeriodo('mes', '2026-09-01', '2026-08-31');
  assert.deepEqual(r, { desde: '2026-09-01', hasta: '2026-09-01' });
});

test('diasDelRango cruza meses y no se cuelga con un rango invertido', () => {
  assert.deepEqual(diasDelRango('2026-08-30', '2026-09-02'),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  assert.deepEqual(diasDelRango('2026-09-05', '2026-09-01'), []);
});
