// ─── Tests del corte de caja (D5) — matemática pura ───────────────────────────
// El caso numérico del plan, a mano, es el test principal: si esto se mueve, el
// número que el dueño recibe por WhatsApp deja de ser el que la card muestra.
//
// Lo demás que se fija acá son las tres reglas que el módulo hereda a toda la
// capa: el fondo suma SOLO al efectivo, las transferencias quedan fuera de la
// comparación, y el descuadre lleva signo siempre (jamás valor absoluto).
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedByRail,
  signedDiff,
  fmtSigned,
  fmtMonto,
  horaCorta,
  buildAvisoCorte,
  resolverCortes,
  type CitaCobrada,
  type MovimientoDelCorte,
} from '../apps/lifestyle/src/lib/corte';

// ─── El caso numérico del plan, tal cual ──────────────────────────────────────
// fondo $500. Citas de HOY: $200 ef + $320 ef + $180 ef + $150 tj + $450 tj.
// Movimientos: entrada walk-in $150 ef, entrada producto $250 tj, salida
// insumos $120 ef.  →  esperado ef = 500+700+150−120 = 1,230 · tj = 600+250 = 850
// Contado 1,180 y 850 → diffs −50 y 0.

const CITAS: CitaCobrada[] = [
  { amount: 200, method: 'efectivo' },
  { amount: 320, method: 'efectivo' },
  { amount: 180, method: 'efectivo' },
  { amount: 150, method: 'tarjeta' },
  { amount: 450, method: 'tarjeta' },
];

const MOVS: MovimientoDelCorte[] = [
  { type: 'entrada', amount: 150, method: 'efectivo' },
  { type: 'entrada', amount: 250, method: 'tarjeta' },
  { type: 'salida',  amount: 120, method: 'efectivo' },
];

test('el caso numérico del plan: esperado ef $1,230 · tj $850', () => {
  const e = expectedByRail(CITAS, MOVS, 500);
  assert.equal(e.efectivo, 1230);
  assert.equal(e.tarjeta, 850);
});

test('el caso numérico del plan: contado 1,180/850 → diffs −50 y 0', () => {
  const e = expectedByRail(CITAS, MOVS, 500);
  assert.equal(signedDiff(1180, e.efectivo), -50);
  assert.equal(signedDiff(850, e.tarjeta), 0);
});

// ─── Las tres reglas ──────────────────────────────────────────────────────────

test('el fondo suma SOLO al efectivo — una terminal no tiene fondo de cambio', () => {
  const e = expectedByRail([{ amount: 100, method: 'tarjeta' }], [], 500);
  assert.equal(e.tarjeta, 100);
  assert.equal(e.efectivo, 500);
  assert.equal(e.fondo, 500);
});

test('sin fondo configurado (0) el esperado de efectivo es solo lo cobrado', () => {
  const e = expectedByRail([{ amount: 100, method: 'efectivo' }], [], 0);
  assert.equal(e.efectivo, 100);
});

test('las transferencias NO entran a la comparación: van aparte', () => {
  const e = expectedByRail(
    [{ amount: 900, method: 'transferencia' }, { amount: 100, method: 'efectivo' }],
    [{ type: 'entrada', amount: 50, method: 'transferencia' }],
    0,
  );
  assert.equal(e.transferencias, 950);
  assert.equal(e.efectivo, 100, 'la transferencia no puede colarse al efectivo');
  assert.equal(e.tarjeta, 0);
});

test('las salidas RESTAN en su propio riel y no tocan los otros', () => {
  const e = expectedByRail([], [
    { type: 'salida', amount: 120, method: 'efectivo' },
    { type: 'salida', amount: 80,  method: 'tarjeta' },
  ], 500);
  assert.equal(e.efectivo, 380);
  assert.equal(e.tarjeta, -80, 'un riel puede quedar negativo; el dato no se maquilla');
});

test('la contraentrada de D4 se neutraliza sola (entrada + salida = 0)', () => {
  const e = expectedByRail([], [
    { type: 'entrada', amount: 250, method: 'tarjeta' },
    { type: 'salida',  amount: 250, method: 'tarjeta' },  // su anulación
  ], 0);
  assert.equal(e.tarjeta, 0);
});

test('el signo es diagnóstico: falta efectivo es NEGATIVO, sobra es POSITIVO', () => {
  assert.equal(signedDiff(1180, 1230), -50);  // falta: salida sin registrar o fuga
  assert.equal(signedDiff(1280, 1230), 50);   // sobra: ingreso sin capturar
  assert.equal(signedDiff(1230, 1230), 0);
});

test('centavos exactos, sin ruido de float', () => {
  const e = expectedByRail([
    { amount: 0.1, method: 'efectivo' },
    { amount: 0.2, method: 'efectivo' },
  ], [], 0);
  assert.equal(e.efectivo, 0.3);
  assert.equal(signedDiff(0.3, 0.1), 0.2);
});

test('día sin nada: todo en cero salvo el fondo', () => {
  const e = expectedByRail([], [], 500);
  assert.deepEqual(e, { efectivo: 500, tarjeta: 0, transferencias: 0, sinRiel: 0, fondo: 500 });
});

test('una cita SIN riel registrado no se adivina: queda aparte, no en efectivo', () => {
  // Fila legada (pre-D2): payment_method NULL. Asumir efectivo inventaría un
  // faltante en el cajón; excluida, el conteo sale por encima y el descuadre
  // POSITIVO dice la verdad — entró dinero que no se sabe atribuir.
  const e = expectedByRail(
    [{ amount: 300, method: '' }, { amount: 100, method: 'efectivo' }],
    [], 500,
  );
  assert.equal(e.sinRiel, 300);
  assert.equal(e.efectivo, 600, 'la cita sin riel NO puede colarse al efectivo');
  assert.equal(signedDiff(900, e.efectivo), 300, 'el descuadre positivo la delata');
});

// ─── Cómo se rinde ────────────────────────────────────────────────────────────

test('fmtSigned SIEMPRE lleva signo salvo el cero (que no tiene dirección)', () => {
  assert.equal(fmtSigned(-50), '−$50');
  assert.equal(fmtSigned(50), '+$50');
  assert.equal(fmtSigned(0), '$0');
  assert.equal(fmtSigned(-1250.5), '−$1,250.5');
});

test('fmtSigned nunca rinde un descuadre en valor absoluto', () => {
  // El bug que el plan prohíbe por nombre: si esto pasara, "faltan 50" y
  // "sobran 50" —problemas opuestos— se verían idénticos.
  assert.notEqual(fmtSigned(-50), fmtSigned(50));
});

test('fmtMonto es para lo que no tiene dirección (contado, esperado)', () => {
  assert.equal(fmtMonto(1180), '$1,180');
  assert.equal(fmtMonto(0), '$0');
});

test('la hora se rinde en la del NEGOCIO, no en la del servidor', () => {
  // 2026-08-14 03:04Z = 21:04 del 13 en México (UTC−6).
  const iso = '2026-08-14T03:04:00.000Z';
  assert.equal(horaCorta(iso, 'America/Mexico_City'), '9:04pm');
  assert.equal(horaCorta(iso, 'UTC'), '3:04am');
});

test('el aviso al dueño dice contado, descuadre con signo, quién y a qué hora', () => {
  const texto = buildAvisoCorte({
    cashCounted: 1180, cardCounted: 850, cashDiff: -50, cardDiff: 0,
    firmadoPor: 'Marcos', at: '2026-08-14T03:04:00.000Z', timeZone: 'America/Mexico_City',
  });
  assert.equal(
    texto,
    'Corte de hoy · Efectivo $1,180 (−$50) · Tarjeta $850 ($0) · firmado por Marcos 9:04pm',
  );
});

test('el aviso no juzga: cero adjetivos sobre el descuadre', () => {
  const texto = buildAvisoCorte({
    cashCounted: 100, cardCounted: 0, cashDiff: -900, cardDiff: 0,
    firmadoPor: 'Ana', at: '2026-08-14T03:04:00.000Z', timeZone: 'America/Mexico_City',
  });
  assert.match(texto, /−\$900/);
  assert.doesNotMatch(texto, /grave|alerta|problema|mal|revisar|urgente|ojo/i);
});

// ─── La última fila por día manda ─────────────────────────────────────────────

const c = (id: string, corteDate: string, createdAt: string, replacesId: string | null = null) =>
  ({ id, corteDate, createdAt, replacesId });

test('de dos cortes del mismo día vale el último, y se sabe que hubo corrección', () => {
  const r = resolverCortes([
    c('a', '2026-08-13', '2026-08-13T21:00:00Z'),
    c('b', '2026-08-13', '2026-08-13T21:40:00Z', 'a'),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.corte.id, 'b');
  assert.equal(r[0]!.correcciones, 1);
});

test('días distintos no se pisan, y salen del más reciente al más viejo', () => {
  const r = resolverCortes([
    c('x', '2026-08-11', '2026-08-11T21:00:00Z'),
    c('z', '2026-08-13', '2026-08-13T21:00:00Z'),
    c('y', '2026-08-12', '2026-08-12T21:00:00Z'),
  ]);
  assert.deepEqual(r.map((e) => e.corte.id), ['z', 'y', 'x']);
  assert.deepEqual(r.map((e) => e.correcciones), [0, 0, 0]);
});

test('sin cortes no revienta', () => {
  assert.deepEqual(resolverCortes([]), []);
});

test('no muta lo que recibe', () => {
  const citas = [...CITAS];
  const movs = [...MOVS];
  const copiaC = citas.map((x) => ({ ...x }));
  const copiaM = movs.map((x) => ({ ...x }));
  expectedByRail(citas, movs, 500);
  assert.deepEqual(citas, copiaC);
  assert.deepEqual(movs, copiaM);
});
