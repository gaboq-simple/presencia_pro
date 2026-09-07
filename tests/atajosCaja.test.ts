// ─── Atajos de caja: el orden y los montos los pone el negocio (M3) ───────────
// El catálogo de salidas pasó de 3 conceptos a 7 para dejar de registrar la renta
// como un retiro. Más opciones no cuestan taps, pero sí lectura — y el riesgo de
// un catálogo lento no es que moleste, es que la gente deje de registrar. Estos
// tests fijan las reglas que lo evitan sin inventar nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularAtajos, sinAnulados, ordenDelCatalogo,
  MIN_MOVS_PARA_MONTOS, MAX_MONTOS,
  type MovimientoHistorico,
} from '../apps/lifestyle/src/lib/atajosCaja';
import { CONCEPTOS_POR_TIPO } from '../apps/lifestyle/src/lib/caja';

let n = 0;
function mov(concept: string, amount: number, type = 'salida', reversesId: string | null = null): MovimientoHistorico {
  return { id: `m${++n}`, type, concept, amount, reversesId };
}

test('el concepto más usado va primero, y el catálogo sale COMPLETO', () => {
  const { orden } = calcularAtajos([
    mov('renta', 12000), mov('renta', 12000), mov('insumos', 300),
  ]);
  assert.equal(orden.salida[0], 'renta');
  assert.equal(orden.salida.length, CONCEPTOS_POR_TIPO.salida.length,
    'reordenar no puede esconder una opción: el que nunca se usó igual tiene que estar');
});

test('`otro` NO está fijado al final: si es lo que más se usa, va primero', () => {
  // Penalizar el escape es la forma más rápida de que alguien deje de anotar. Y
  // que `otro` domine es información para el dueño, no algo que haya que esconder.
  const { orden } = calcularAtajos([mov('otro', 50), mov('otro', 60), mov('insumos', 300)]);
  assert.equal(orden.salida[0], 'otro');
});

test('empate → orden del catálogo, para que el pulgar no aprenda una posición que se mueve', () => {
  const a = calcularAtajos([mov('renta', 1), mov('servicios', 1)]).orden.salida;
  const b = calcularAtajos([mov('servicios', 1), mov('renta', 1)]).orden.salida;
  assert.deepEqual(a, b, 'el mismo uso tiene que dar el mismo orden, entre y dentro de renders');
  assert.ok(a.indexOf('renta') < a.indexOf('servicios'), 'desempate por el catálogo');
});

test('sin histórico, el orden es el del catálogo (no un orden inventado)', () => {
  assert.deepEqual(calcularAtajos([]).orden, ordenDelCatalogo());
});

test('un monto que se repite es un atajo; uno que aparece una vez, no', () => {
  const { montos } = calcularAtajos([
    mov('insumos', 300), mov('insumos', 300), mov('insumos', 77),
  ]);
  assert.deepEqual(montos['insumos'], [300]);
});

test('sin historia suficiente no se ofrece NADA: dos filas son coincidencia, no hábito', () => {
  const { montos } = calcularAtajos([mov('renta', 12000), mov('renta', 12000)]);
  assert.equal(montos['renta'], undefined,
    `con menos de ${MIN_MOVS_PARA_MONTOS} movimientos el concepto no propone montos`);
});

test('nunca más de tres montos: el atajo compite con el teclado, no lo reemplaza', () => {
  const movs = [10, 10, 20, 20, 30, 30, 40, 40, 50, 50].map((v) => mov('insumos', v));
  const { montos } = calcularAtajos(movs);
  assert.equal(montos['insumos']?.length, MAX_MONTOS);
});

test('empate de repeticiones → monto menor primero (determinista)', () => {
  const movs = [200, 200, 100, 100, 50].map((v) => mov('insumos', v));
  assert.deepEqual(calcularAtajos(movs).montos['insumos'], [100, 200]);
});

test('una anulación descarta las DOS filas: la contraentrada y lo que anuló', () => {
  const original = mov('insumos', 999);
  const contra = { id: 'c1', type: 'entrada', concept: 'otro', amount: 999, reversesId: original.id };
  const utiles = sinAnulados([original, contra, mov('insumos', 300)]);
  assert.equal(utiles.length, 1);
  assert.equal(utiles[0]?.amount, 300);
});

test('un movimiento anulado no enseña su monto como atajo', () => {
  // Una anulación es la marca de un error, no un hábito.
  const malos = [mov('insumos', 999), mov('insumos', 999), mov('insumos', 999)];
  const contras = malos.map((m, i) => ({
    id: `c${i}`, type: 'entrada', concept: 'otro', amount: 999, reversesId: m.id,
  }));
  const { montos } = calcularAtajos([...malos, ...contras]);
  assert.equal(montos['insumos'], undefined);
});

test('entradas y salidas se ordenan por separado: sus conceptos no se cruzan', () => {
  const { orden } = calcularAtajos([
    mov('walkin', 200, 'entrada'), mov('walkin', 200, 'entrada'), mov('renta', 1),
  ]);
  assert.equal(orden.entrada[0], 'walkin');
  assert.equal(orden.salida[0], 'renta');
  for (const c of orden.entrada) assert.ok(!CONCEPTOS_POR_TIPO.salida.includes(c as never) || c === 'otro');
});
