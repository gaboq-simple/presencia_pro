// ─── Gastos fijos: cuándo toca la puerta (M4) ────────────────────────────────
// La regla de la que cuelga todo: un fijo NUNCA se registra solo. Este módulo
// calcula qué vence; quien confirma es una persona. Estos tests fijan las tres
// decisiones que hacen que el recordatorio no se vuelva una automatización que
// esconde: el período como unidad, el clamp de fin de mes, y que un pendiente
// ENVEJEZCA en vez de desvanecerse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  venceMensual, venceSemanal, mismoPeriodo, diasEntre, estadoDelFijo,
  ordenarEstados, textoDeVencimiento, lunesDeLaSemana, ultimosPagosVigentes,
  type Fijo, type PagoDeFijo,
} from '../apps/lifestyle/src/lib/fijos';

const renta: Fijo = {
  id: 'f1', label: 'Renta', concept: 'renta', amountSugerido: 12000,
  methodSugerido: 'transferencia', cadencia: 'mensual', diaDelMes: 3,
  diaDeSemana: null, active: true,
};
const raya: Fijo = {
  id: 'f2', label: 'Raya', concept: 'nomina', amountSugerido: 4000,
  methodSugerido: 'efectivo', cadencia: 'semanal', diaDelMes: null,
  diaDeSemana: 6, active: true, // sábado
};

// ─── Vencimiento ──────────────────────────────────────────────────────────────

test('el día 31 se resuelve al último del mes, no se corre al siguiente', () => {
  // "Vence el 31" en un mes de 30 significa el 30 — no el 1 del otro mes, que
  // sería mover el gasto de período.
  assert.equal(venceMensual('2026-02-15', 31), '2026-02-28');
  assert.equal(venceMensual('2026-04-15', 31), '2026-04-30');
  assert.equal(venceMensual('2024-02-15', 31), '2024-02-29'); // bisiesto
  assert.equal(venceMensual('2026-01-15', 31), '2026-01-31');
});

test('el semanal cae en su día dentro de la semana lunes→domingo del repo', () => {
  // 2026-09-06 es domingo. Su semana empieza el lunes 31 de agosto.
  assert.equal(lunesDeLaSemana('2026-09-06'), '2026-08-31');
  assert.equal(venceSemanal('2026-09-06', 6), '2026-09-05'); // sábado
  assert.equal(venceSemanal('2026-09-06', 0), '2026-09-06'); // domingo = fin de semana
  assert.equal(venceSemanal('2026-09-06', 1), '2026-08-31'); // lunes = principio
});

// ─── El período es la unidad, no la fecha exacta ─────────────────────────────

test('pagar el 5 satisface a un fijo que vencía el 3: la vida no paga en fecha', () => {
  const e = estadoDelFijo(renta, { occurredOn: '2026-09-05', amount: 12000 }, '2026-09-20');
  assert.equal(e.pendiente, false);
});

test('pagar el mes pasado NO satisface a este mes', () => {
  const e = estadoDelFijo(renta, { occurredOn: '2026-08-03', amount: 12000 }, '2026-09-20');
  assert.equal(e.pendiente, true);
});

test('el mes se compara por mes, no por 30 días', () => {
  assert.ok(mismoPeriodo('mensual', '2026-09-01', '2026-09-30'));
  assert.ok(!mismoPeriodo('mensual', '2026-08-31', '2026-09-01'));
});

// ─── Ni antes de tiempo, ni desapareciendo ────────────────────────────────────

test('un fijo que vence el 3 NO molesta el 2', () => {
  const e = estadoDelFijo(renta, null, '2026-09-02');
  assert.equal(e.pendiente, false, 'todavía no vence');
  assert.equal(e.diasDeAtraso, -1);
});

test('vence hoy: pendiente, sin atraso', () => {
  const e = estadoDelFijo(renta, null, '2026-09-03');
  assert.equal(e.pendiente, true);
  assert.equal(e.diasDeAtraso, 0);
  assert.equal(textoDeVencimiento(e), 'vence hoy');
});

test('si nadie confirma, ENVEJECE a la vista — no se desvanece', () => {
  // Es la diferencia entre un recordatorio y una automatización que esconde.
  const e = estadoDelFijo(renta, null, '2026-09-13');
  assert.equal(e.pendiente, true);
  assert.equal(e.diasDeAtraso, 10);
  assert.equal(textoDeVencimiento(e), 'venció hace 10 días');
});

test('un fijo desactivado no reclama nada', () => {
  const e = estadoDelFijo({ ...renta, active: false }, null, '2026-09-13');
  assert.equal(e.pendiente, false);
});

// ─── Aritmética de calendario, sin instantes ─────────────────────────────────

test('los días se cuentan en calendario, incluso cruzando meses y años', () => {
  assert.equal(diasEntre('2026-09-03', '2026-09-13'), 10);
  assert.equal(diasEntre('2026-08-31', '2026-09-01'), 1);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.equal(diasEntre('2024-02-28', '2024-03-01'), 2); // bisiesto
  assert.equal(diasEntre('2026-09-13', '2026-09-03'), -10);
});

// ─── El orden de la cola ──────────────────────────────────────────────────────

test('primero lo pendiente, y arriba lo más atrasado', () => {
  const a = estadoDelFijo(renta, null, '2026-09-13');                                  // 10 días
  const b = estadoDelFijo(raya, null, '2026-09-06');                                   // 1 día
  const c = estadoDelFijo(renta, { occurredOn: '2026-09-05', amount: 1 }, '2026-09-13'); // al día
  const orden = ordenarEstados([c, b, a]);
  assert.deepEqual(orden.map((e) => e.diasDeAtraso), [10, 1, 10]);
  assert.equal(orden[2]?.pendiente, false, 'lo satisfecho va al final aunque su fecha sea vieja');
});

test('el texto no dramatiza: es un recordatorio, no un reproche', () => {
  const pagado = estadoDelFijo(renta, { occurredOn: '2026-09-05', amount: 1 }, '2026-09-13');
  assert.equal(textoDeVencimiento(pagado), 'pagado este período');
  assert.equal(textoDeVencimiento(estadoDelFijo(renta, null, '2026-09-04')), 'venció ayer');
});

// ─── Un pago anulado no apaga el recordatorio ────────────────────────────────
// Anular no borra: la caja es append-only y la corrección es una contraentrada,
// que además NO lleva `fijo_id`. Sin descartar el pago anulado, el fijo se
// quedaría CALLADO todo el período sin que nadie haya pagado nada — justo el modo
// de fallo que M4 vino a evitar. Salió al limpiar el sondeo en vivo, no de un
// razonamiento previo.

const pagos: PagoDeFijo[] = [
  { id: 'p2', fijoId: 'f1', occurredOn: '2026-09-06', amount: 12500 },
  { id: 'p1', fijoId: 'f1', occurredOn: '2026-08-03', amount: 12000 },
];

test('el último pago vigente ignora al anulado y cae al anterior', () => {
  const vigentes = ultimosPagosVigentes(pagos, new Set(['p2']));
  assert.deepEqual(vigentes.get('f1'), { occurredOn: '2026-08-03', amount: 12000 });
});

test('sin anulaciones, el último pago es el más nuevo', () => {
  assert.deepEqual(ultimosPagosVigentes(pagos, new Set()).get('f1'),
    { occurredOn: '2026-09-06', amount: 12500 });
});

test('anular el ÚNICO pago del período devuelve el fijo a pendiente', () => {
  const soloUno: PagoDeFijo[] = [{ id: 'p2', fijoId: 'f1', occurredOn: '2026-09-06', amount: 12500 }];
  const vigente = ultimosPagosVigentes(soloUno, new Set(['p2'])).get('f1') ?? null;
  const e = estadoDelFijo(renta, vigente, '2026-09-06');
  assert.equal(e.pendiente, true, 'nadie pagó nada: el recordatorio tiene que volver');
});

test('todos los pagos anulados = ningún pago, no un mapa a medias', () => {
  assert.equal(ultimosPagosVigentes(pagos, new Set(['p1', 'p2'])).size, 0);
});
