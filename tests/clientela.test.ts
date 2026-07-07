// ─── Tests de Clientela (agregados de la base) sobre fixtures ─────────────────
// Clientes sintéticos de segmento CONOCIDO → aserta conteo por segmento, crecimiento
// (total + este mes), delta por segmento, degradado con gracia y reconciliación.
// Puro (sin DB): reusa computeClientelaStats, `now` fijo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeClientelaStats,
  computeRetention,
  type CustomerCadenceInput,
  type RfmSegment,
} from '../apps/lifestyle/src/lib/cadence';

// ─── Fixtures helpers (mismo patrón que cadence.test.ts) ──────────────────────

const NOW = new Date('2026-07-07T12:00:00Z'); // mes en curso: julio 2026 (inicio 07-01)
const NOW_MS = NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(d: number): string {
  return new Date(NOW_MS - d * DAY).toISOString();
}

/** `n` visitas espaciadas `gap` días, la última hace `lastAgo`. Ascendente. */
function visits(n: number, gap: number, lastAgo: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(daysAgo(lastAgo + (n - 1 - i) * gap));
  return out;
}

function mk(partial: Partial<CustomerCadenceInput> & { customerId: string; completedVisits: string[] }): CustomerCadenceInput {
  return {
    name: partial.name ?? partial.customerId,
    monetaryValues: partial.monetaryValues ?? partial.completedVisits.map(() => 200),
    visitCount: partial.visitCount ?? partial.completedVisits.length,
    createdAt: partial.createdAt ?? daysAgo(400),
    isFlagged: partial.isFlagged ?? false,
    noshowCount: partial.noshowCount ?? 0,
    ...partial,
  };
}

function sumCounts(c: Record<RfmSegment, number>): number {
  return c.nuevos + c.campeones + c.regulares + c.se_estan_yendo + c.perdidos;
}

// ─── Conteo por segmento ──────────────────────────────────────────────────────

test('segmentCounts: cuenta cada segmento de la base (incluye flagged en su segmento)', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'champ',   completedVisits: visits(7, 14, 7),  visitCount: 10 }),                  // campeones (freq alta, NO atrasado)
    mk({ customerId: 'reg',     completedVisits: visits(4, 14, 10), visitCount: 4 }),                   // regulares
    mk({ customerId: 'yendo',   completedVisits: visits(4, 14, 30), visitCount: 4 }),                   // se_estan_yendo
    mk({ customerId: 'perdido', completedVisits: visits(3, 14, 60), visitCount: 3 }),                   // perdidos
    mk({ customerId: 'nuevo',   completedVisits: visits(1, 0, 5),   visitCount: 1 }),                   // nuevos
    mk({ customerId: 'flag',    completedVisits: visits(4, 14, 40), visitCount: 4, isFlagged: true }),  // se_estan_yendo (flagged: contado igual)
  ];

  const s = computeClientelaStats(inputs, NOW_MS);

  assert.equal(s.segmentCounts.campeones, 1);
  assert.equal(s.segmentCounts.regulares, 1);
  assert.equal(s.segmentCounts.se_estan_yendo, 2, 'flagged se cuenta en su segmento (la foto incluye a todos)');
  assert.equal(s.segmentCounts.perdidos, 1);
  assert.equal(s.segmentCounts.nuevos, 1);
  assert.equal(s.totalCustomers, 6);
  // Invariante: la suma de segmentos = total (nadie sin clasificar, nadie doble).
  assert.equal(sumCounts(s.segmentCounts), s.totalCustomers);
});

// ─── Crecimiento (total + este mes) ───────────────────────────────────────────

test('crecimiento: total histórico + llegados en el mes calendario en curso', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'viejo1', completedVisits: visits(4, 14, 10), createdAt: daysAgo(400) }),          // no este mes
    mk({ customerId: 'viejo2', completedVisits: visits(1, 0, 5),   createdAt: daysAgo(20) }),           // 06-17 → no este mes
    mk({ customerId: 'nuevo1', completedVisits: visits(1, 0, 3),   createdAt: daysAgo(3) }),            // 07-04 → este mes
    mk({ customerId: 'nuevo2', completedVisits: visits(1, 0, 1),   createdAt: daysAgo(6) }),            // 07-01 12:00 → este mes
  ];

  const s = computeClientelaStats(inputs, NOW_MS);

  assert.equal(s.totalCustomers, 4);
  assert.equal(s.newThisMonth, 2, 'solo los creados desde el 1° del mes en curso (UTC)');
});

test('frontera del mes: created antes del 1° NO cuenta; en/después del 1° sí', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'jun30', completedVisits: [], createdAt: daysAgo(7) }),  // 06-30 12:00 → fuera
    mk({ customerId: 'jul01', completedVisits: [], createdAt: daysAgo(6) }),  // 07-01 12:00 → dentro
  ];
  const s = computeClientelaStats(inputs, NOW_MS);
  assert.equal(s.newThisMonth, 1);
});

// ─── Delta por segmento (reconcilia con el +N) ────────────────────────────────

test('newThisMonthBySegment: los recién llegados por su segmento; suma = newThisMonth', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'nuevo1', completedVisits: visits(1, 0, 2), createdAt: daysAgo(3) }),   // este mes → nuevos
    mk({ customerId: 'nuevo2', completedVisits: visits(2, 5, 1), createdAt: daysAgo(2) }),   // este mes → nuevos (<3)
    mk({ customerId: 'viejoReg', completedVisits: visits(4, 14, 10), createdAt: daysAgo(400) }), // viejo → regulares
  ];

  const s = computeClientelaStats(inputs, NOW_MS);

  assert.equal(s.newThisMonth, 2);
  assert.equal(s.newThisMonthBySegment.nuevos, 2);
  assert.equal(s.newThisMonthBySegment.regulares, 0, 'el regular viejo NO cuenta como llegado este mes');
  // Reconciliación: la suma de deltas = newThisMonth (reconcilia con el crecimiento).
  assert.equal(sumCounts(s.newThisMonthBySegment), s.newThisMonth);
});

// ─── Degradado con gracia ─────────────────────────────────────────────────────

test('degradado: negocio sin visitas completadas → todos Nuevos, sin error', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'a', completedVisits: [], createdAt: daysAgo(3) }),
    mk({ customerId: 'b', completedVisits: [], createdAt: daysAgo(10) }),
    mk({ customerId: 'c', completedVisits: [], visitCount: 1, createdAt: daysAgo(400) }), // visit_count stale, 0 completadas
  ];

  const s = computeClientelaStats(inputs, NOW_MS);

  assert.equal(s.totalCustomers, 3);
  assert.equal(s.segmentCounts.nuevos, 3);
  assert.equal(s.segmentCounts.campeones + s.segmentCounts.regulares + s.segmentCounts.se_estan_yendo + s.segmentCounts.perdidos, 0);
  assert.equal(s.newThisMonth, 1); // solo 'a' (daysAgo 3)
});

test('vacío: sin clientes → todo en cero, sin crash', () => {
  const s = computeClientelaStats([], NOW_MS);
  assert.equal(s.totalCustomers, 0);
  assert.equal(s.newThisMonth, 0);
  assert.equal(sumCounts(s.segmentCounts), 0);
  assert.equal(sumCounts(s.newThisMonthBySegment), 0);
});

// ─── createdAt inválido no rompe ni infla el conteo del mes ───────────────────

test('createdAt inválido: cuenta en total pero NO como llegado del mes', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'bad', completedVisits: [], createdAt: 'no-es-fecha' }),
  ];
  const s = computeClientelaStats(inputs, NOW_MS);
  assert.equal(s.totalCustomers, 1);
  assert.equal(s.newThisMonth, 0);
  assert.equal(s.segmentCounts.nuevos, 1);
});

// ─── Retención por cohortes (PR-B) ────────────────────────────────────────────

test('nuevos que vuelven: cohorte madura [30–90]d, 2ª visita ≤30d = retenido', () => {
  const inputs: CustomerCadenceInput[] = [
    // Cohorte (1ª visita 30–90d atrás) — retenidos (2ª visita ≤30d de la 1ª):
    mk({ customerId: 'n1', completedVisits: [daysAgo(40), daysAgo(20)] }), // gap 20 → retenido
    mk({ customerId: 'n2', completedVisits: [daysAgo(50), daysAgo(25)] }), // gap 25 → retenido
    mk({ customerId: 'n3', completedVisits: [daysAgo(45), daysAgo(30)] }), // gap 15 → retenido
    // Cohorte — NO retenidos:
    mk({ customerId: 'n4', completedVisits: [daysAgo(60)] }),              // 1 sola visita → no volvió
    mk({ customerId: 'n5', completedVisits: [daysAgo(35), daysAgo(2)] }),  // gap 33 > 30 → no cuenta como retorno
    // EXCLUIDOS de la cohorte (no deben mover el tamaño):
    mk({ customerId: 'reciente', completedVisits: [daysAgo(10)] }),        // <30d: aún en tiempo, NO desinfla
    mk({ customerId: 'viejo',    completedVisits: [daysAgo(120)] }),       // >90d: ya no es "nuevo"
  ];

  const { newReturn } = computeRetention(inputs, NOW_MS);
  assert.equal(newReturn.status, 'ok');
  if (newReturn.status !== 'ok') return;
  assert.equal(newReturn.cohortSize, 5, 'los <30d y >90d quedan FUERA de la cohorte');
  assert.equal(newReturn.retained, 3);
  assert.equal(newReturn.rate, 0.6);
});

test('recompra de base: establecidos ≥3 visitas, visita en últimos 60d = recompra', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'b1', completedVisits: visits(3, 20, 10) }), // última 10d → recompra
    mk({ customerId: 'b2', completedVisits: visits(4, 15, 5) }),  // última 5d  → recompra
    mk({ customerId: 'b3', completedVisits: visits(3, 30, 20) }), // última 20d → recompra
    mk({ customerId: 'b4', completedVisits: visits(5, 10, 30) }), // última 30d → recompra
    mk({ customerId: 'b5', completedVisits: visits(3, 20, 90) }), // última 90d > 60 → NO recompra
    mk({ customerId: 'noBase', completedVisits: visits(2, 14, 5) }), // <3 visitas → fuera de base
  ];

  const { baseRepeat } = computeRetention(inputs, NOW_MS);
  assert.equal(baseRepeat.status, 'ok');
  if (baseRepeat.status !== 'ok') return;
  assert.equal(baseRepeat.cohortSize, 5, 'solo los de ≥3 visitas; el de 2 visitas queda fuera');
  assert.equal(baseRepeat.retained, 4);
  assert.equal(baseRepeat.rate, 0.8);
});

test('piso de datos: cohorte < 5 → banda "sin datos", NUNCA un %', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'n1', completedVisits: [daysAgo(40), daysAgo(20)] }),
    mk({ customerId: 'n2', completedVisits: [daysAgo(50), daysAgo(25)] }),
    mk({ customerId: 'n3', completedVisits: [daysAgo(45)] }),
    mk({ customerId: 'n4', completedVisits: [daysAgo(60)] }), // 4 en cohorte, base 0
  ];

  const { newReturn, baseRepeat } = computeRetention(inputs, NOW_MS);
  assert.equal(newReturn.status, 'insufficient');
  assert.equal(newReturn.cohortSize, 4);
  assert.equal(baseRepeat.status, 'insufficient');
  assert.equal(baseRepeat.cohortSize, 0);
});

test('degradado: sin visitas completadas → ambas cohortes insuficientes (0), sin crash', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'a', completedVisits: [] }),
    mk({ customerId: 'b', completedVisits: [] }),
  ];
  const s = computeClientelaStats(inputs, NOW_MS);
  assert.equal(s.retention.newReturn.status, 'insufficient');
  assert.equal(s.retention.newReturn.cohortSize, 0);
  assert.equal(s.retention.baseRepeat.status, 'insufficient');
  assert.equal(s.retention.baseRepeat.cohortSize, 0);
});

test('computeClientelaStats incluye retention (integración PR-A + PR-B)', () => {
  const inputs: CustomerCadenceInput[] = [mk({ customerId: 'x', completedVisits: visits(4, 14, 10) })];
  const s = computeClientelaStats(inputs, NOW_MS);
  assert.ok(s.retention, 'la foto de clientela ahora trae retención');
  assert.ok('newReturn' in s.retention && 'baseRepeat' in s.retention);
});
