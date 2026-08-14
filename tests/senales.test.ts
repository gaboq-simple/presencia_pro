// ─── Tests de las señales (D7) — la tabla del fracaso, calculada ──────────────
// El caso numérico del plan LIGA con el de D5: el mismo corte (cash_diff −50,
// card_diff 0, expected_cash 1,230, fondo 500, expected_card 850) tiene que dar
// 3.2%. Si ese número se mueve, el digest y la card del corte dejan de hablar
// del mismo día.
//
// Lo otro que se fija acá es el denominador: RESTA el fondo. El fondo no entró
// hoy — estaba en el cajón desde antes. Dejarlo adentro haría que todos los días
// se vieran más convergentes de lo que son, y justo en los negocios chicos, que
// son todos los de este producto.
//
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSenales,
  pctDescuadre,
  UMBRAL_RITUAL,
  UMBRAL_CONVERGENCIA_PCT,
  UMBRAL_DUENO_DIAS,
  type CorteParaSenal,
  type DiaDeCaja,
} from '../apps/lifestyle/src/lib/senales';

// 2026-08-13 es JUEVES. La semana [hoy−6, hoy] = vie 7 … jue 13 → 6 hábiles
// (cae un domingo, el 9).
const HOY = '2026-08-13';

function corte(over: Partial<CorteParaSenal> & { corteDate: string }): CorteParaSenal {
  return {
    id: `c-${over.corteDate}-${over.createdAt ?? '1'}`,
    createdAt: `${over.corteDate}T21:00:00.000Z`,
    replacesId: null,
    cashDiff: 0, cardDiff: 0,
    expectedCash: 1230, expectedCard: 850, fondoSnapshot: 500,
    ...over,
  };
}

const SIN_DIAS: DiaDeCaja[] = [];

// ─── El caso numérico del plan ────────────────────────────────────────────────

test('el corte de D5 da 3.2%: 50 / ((1,230 − 500) + 850) = 50/1,580', () => {
  const c = corte({ corteDate: HOY, cashDiff: -50, cardDiff: 0 });
  assert.equal(Math.round(pctDescuadre(c) * 10) / 10, 3.2);
});

test('el fondo se RESTA del denominador — con él adentro daría 2.4%, no 3.2%', () => {
  const c = corte({ corteDate: HOY, cashDiff: -50, cardDiff: 0 });
  const conFondoAdentro = 50 / (1230 + 850) * 100; // 2.4% — el número inflado
  assert.notEqual(Math.round(pctDescuadre(c) * 10) / 10, Math.round(conFondoAdentro * 10) / 10);
});

test('el descuadre usa VALOR ABSOLUTO para medir magnitud (el signo es de la card)', () => {
  const falta = corte({ corteDate: HOY, cashDiff: -50 });
  const sobra = corte({ corteDate: HOY, cashDiff: 50 });
  assert.equal(pctDescuadre(falta), pctDescuadre(sobra));
});

// ─── 1. El ritual ─────────────────────────────────────────────────────────────

test('ritual: 5 cortes en 6 días hábiles → "5 de 6"', () => {
  const fechas = ['2026-08-07', '2026-08-08', '2026-08-10', '2026-08-11', '2026-08-12'];
  const s = computeSenales({
    cortes: fechas.map((f) => corte({ corteDate: f })),
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.ritual.conCorte, 5);
  assert.equal(s.ritual.habiles, 6);
  assert.equal(s.ritual.umbral, UMBRAL_RITUAL);
  assert.match(s.ritual.texto, /^5 de 6 días hábiles con corte · umbral 5$/);
});

test('ritual: el domingo NO cuenta como día hábil (supuesto v1 del plan)', () => {
  // Un corte en domingo no puede subir el numerador de días hábiles.
  const s = computeSenales({
    cortes: [corte({ corteDate: '2026-08-09' })], // domingo
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.ritual.habiles, 6);
  assert.equal(s.ritual.conCorte, 0);
});

test('ritual: dos cortes del MISMO día cuentan una vez (manda el último)', () => {
  const s = computeSenales({
    cortes: [
      corte({ corteDate: '2026-08-12', createdAt: '2026-08-12T21:00:00.000Z' }),
      corte({ corteDate: '2026-08-12', createdAt: '2026-08-12T21:40:00.000Z', replacesId: 'x' }),
    ],
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.ritual.conCorte, 1);
});

// ─── 2. La convergencia ───────────────────────────────────────────────────────

test('convergencia: mediana de la ventana + comparación semana vs previa', () => {
  const s = computeSenales({
    cortes: [
      corte({ corteDate: '2026-08-12', cashDiff: -50 }),  // 3.2% — semana reciente
      corte({ corteDate: '2026-08-11', cashDiff: -50 }),  // 3.2%
      corte({ corteDate: '2026-08-04', cashDiff: -100 }), // 6.3% — semana previa
      corte({ corteDate: '2026-08-03', cashDiff: -100 }), // 6.3%
    ],
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.convergencia.recientePct, 3.2);
  assert.equal(s.convergencia.previaPct, 6.3);
  assert.equal(s.convergencia.medianaPct, 4.7); // (3.2 + 6.3) / 2 sobre los 4
  assert.equal(s.convergencia.umbralPct, UMBRAL_CONVERGENCIA_PCT);
  assert.match(s.convergencia.texto, /mediana 4\.7% · umbral 10% · semana 3\.2% vs 6\.3% la previa/);
});

test('convergencia sin cortes: lo dice, no inventa un 0%', () => {
  const s = computeSenales({ cortes: [], dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY });
  assert.equal(s.convergencia.medianaPct, null);
  assert.match(s.convergencia.texto, /sin cortes en los últimos 14 días/);
});

test('convergencia: un día sin movimiento no revienta la división', () => {
  const c = corte({ corteDate: HOY, cashDiff: 0, cardDiff: 0, expectedCash: 500, expectedCard: 0, fondoSnapshot: 500 });
  assert.equal(pctDescuadre(c), 0);
  assert.ok(Number.isFinite(pctDescuadre(c)));
});

// ─── 3. El teatro ─────────────────────────────────────────────────────────────

test('teatro (a): cortes en cero exacto sobre los de la semana → "0 de 5"', () => {
  const fechas = ['2026-08-07', '2026-08-08', '2026-08-10', '2026-08-11', '2026-08-12'];
  const s = computeSenales({
    cortes: fechas.map((f) => corte({ corteDate: f, cashDiff: -20 })),
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.teatro.ceroExacto, 0);
  assert.equal(s.teatro.cortesRecientes, 5);
  assert.match(s.teatro.texto, /^0 de 5 cortes en cero exacto/);
});

test('teatro (a): el cero exacto EXIGE los dos rieles en cero', () => {
  const s = computeSenales({
    cortes: [
      corte({ corteDate: '2026-08-12', cashDiff: 0, cardDiff: 0 }),   // cuenta
      corte({ corteDate: '2026-08-11', cashDiff: 0, cardDiff: -10 }), // NO cuenta
    ],
    dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY,
  });
  assert.equal(s.teatro.ceroExacto, 1);
});

test('teatro (b): un sábado lleno SIN movimientos es la señal; con uno, no', () => {
  const dias: DiaDeCaja[] = [
    { fecha: '2026-08-08', cobrado: 3000, movimientos: 0 }, // sábado lleno, sin movs
    { fecha: '2026-08-01', cobrado: 3000, movimientos: 2 }, // sábado lleno, con movs
    { fecha: '2026-08-07', cobrado: 1000, movimientos: 1 },
    { fecha: '2026-08-06', cobrado: 1000, movimientos: 1 },
  ];
  const s = computeSenales({ cortes: [], dias, ownerLastSeenAt: null, hoy: HOY });
  assert.equal(s.teatro.sabadosLlenos, 2);
  assert.equal(s.teatro.sabadosLlenosSinMovs, 1);
});

test('teatro (b): un sábado VACÍO no es sospechoso — no tuvo nada que registrar', () => {
  const dias: DiaDeCaja[] = [
    { fecha: '2026-08-08', cobrado: 0, movimientos: 0 },  // sábado cerrado
    { fecha: '2026-08-07', cobrado: 1000, movimientos: 1 },
  ];
  const s = computeSenales({ cortes: [], dias, ownerLastSeenAt: null, hoy: HOY });
  assert.equal(s.teatro.sabadosLlenos, 0);
  assert.equal(s.teatro.sabadosLlenosSinMovs, 0);
});

// ─── 4. El dueño ──────────────────────────────────────────────────────────────

test('dueño: días desde la última visita, en días de calendario local', () => {
  const s = computeSenales({
    cortes: [], dias: SIN_DIAS,
    ownerLastSeenAt: '2026-08-10T23:07:56.000Z', hoy: HOY,
  });
  assert.equal(s.dueno.diasSinVer, 3);
  assert.equal(s.dueno.umbral, UMBRAL_DUENO_DIAS);
  assert.match(s.dueno.texto, /^hace 3 días · umbral 7 días$/);
});

test('dueño: "nunca" cuando la columna está en NULL — no se rinde como 0', () => {
  // 🔴 Esta señal nace de `owner_last_seen_at`, la columna cuyo touch estaba roto
  // hasta D6 (el guard preguntaba por role 'owner', que ninguna sesión viva
  // puede tener). Sin ese fix, este caso sería el ÚNICO que se vería para
  // siempre: "nunca abrió la app" sobre un dueño que entra todos los días.
  const s = computeSenales({ cortes: [], dias: SIN_DIAS, ownerLastSeenAt: null, hoy: HOY });
  assert.equal(s.dueno.diasSinVer, null);
  assert.match(s.dueno.texto, /^nunca abrió la app · umbral 7 días$/);
});

test('dueño: hoy mismo → 0 días, singular correcto en 1', () => {
  const hoyMismo = computeSenales({
    cortes: [], dias: SIN_DIAS, ownerLastSeenAt: `${HOY}T18:00:00.000Z`, hoy: HOY,
  });
  assert.equal(hoyMismo.dueno.diasSinVer, 0);
  const ayer = computeSenales({
    cortes: [], dias: SIN_DIAS, ownerLastSeenAt: '2026-08-12T18:00:00.000Z', hoy: HOY,
  });
  assert.match(ayer.dueno.texto, /^hace 1 día ·/);
});

// ─── Copy: dato + umbral, cero juicio ─────────────────────────────────────────

test('ninguna señal opina: solo dato y umbral', () => {
  const s = computeSenales({
    cortes: [corte({ corteDate: HOY, cashDiff: -900 })],
    dias: [{ fecha: '2026-08-08', cobrado: 5000, movimientos: 0 }],
    ownerLastSeenAt: null, hoy: HOY,
  });
  for (const t of [s.ritual.texto, s.convergencia.texto, s.teatro.texto, s.dueno.texto]) {
    assert.doesNotMatch(t, /grave|alarma|problema|mal|urgente|ojo|cuidado|riesgo|preocup/i);
    assert.match(t, /umbral|sin cortes|sábados/);
  }
});

test('no muta lo que recibe', () => {
  const cortes = [corte({ corteDate: HOY })];
  const dias: DiaDeCaja[] = [{ fecha: HOY, cobrado: 10, movimientos: 1 }];
  const cc = cortes.map((c) => ({ ...c }));
  const dd = dias.map((d) => ({ ...d }));
  computeSenales({ cortes, dias, ownerLastSeenAt: null, hoy: HOY });
  assert.deepEqual(cortes, cc);
  assert.deepEqual(dias, dd);
});
