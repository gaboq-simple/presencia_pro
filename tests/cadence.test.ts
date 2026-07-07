// ─── Tests de cadencia (RFM) sobre fixtures ───────────────────────────────────
// Clientes sintéticos de gap CONOCIDO → aserta mediana, atraso a 1.5×, segmento,
// ranking por valor, exclusión de flagged, degradado <3 visitas, confianza.
// Puro (sin DB): `now` fijo, visitas construidas relativas a él.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCadence,
  computeRetentionFeed,
  feedGroupRank,
  median,
  gapsInDays,
  type CustomerCadenceInput,
} from '../apps/lifestyle/src/lib/cadence';

// ─── Fixtures helpers ─────────────────────────────────────────────────────────

const NOW = new Date('2026-07-07T12:00:00Z');
const NOW_MS = NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;

/** ISO de hace `d` días respecto de NOW. */
function daysAgo(d: number): string {
  return new Date(NOW_MS - d * DAY).toISOString();
}

/** Construye visitas: `n` visitas espaciadas `gap` días, la última hace `lastAgo`. */
function visits(n: number, gap: number, lastAgo: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(daysAgo(lastAgo + (n - 1 - i) * gap));
  return out; // ascendente
}

function mk(partial: Partial<CustomerCadenceInput> & { customerId: string; completedVisits: string[] }): CustomerCadenceInput {
  return {
    name: partial.name ?? partial.customerId,
    monetaryValues: partial.monetaryValues ?? partial.completedVisits.map(() => 200),
    visitCount: partial.visitCount ?? partial.completedVisits.length,
    createdAt: partial.createdAt ?? daysAgo(365),
    isFlagged: partial.isFlagged ?? false,
    noshowCount: partial.noshowCount ?? 0,
    ...partial,
  };
}

// ─── Primitivas puras ─────────────────────────────────────────────────────────

test('median: impar y par', () => {
  assert.equal(median([14, 14, 14]), 14);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([3, 1, 2]), 2); // ordena internamente
});

test('gapsInDays: gaps entre visitas ordenadas', () => {
  const g = gapsInDays(visits(4, 14, 10)); // 4 visitas cada 14 días
  assert.deepEqual(g.map(Math.round), [14, 14, 14]);
});

// ─── Segmentos + atraso ───────────────────────────────────────────────────────

test('Regular en cadencia: no atrasado, no entra al feed', () => {
  const r = computeCadence(mk({ customerId: 'reg', completedVisits: visits(4, 14, 10), visitCount: 4 }), NOW_MS);
  assert.equal(Math.round(r.medianGapDays!), 14);
  assert.equal(r.confidence, 'confident');       // ≥4 visitas
  assert.ok(r.overdueRatio! < 1.5);
  assert.equal(r.isOverdue, false);
  assert.equal(r.segment, 'regulares');
  assert.equal(r.inRescueFeed, false);
});

test('Se están yendo: atrasado 1.5–3×, ámbar, en el feed', () => {
  const r = computeCadence(mk({ customerId: 'yendo', completedVisits: visits(4, 14, 30), visitCount: 4 }), NOW_MS);
  assert.ok(r.overdueRatio! >= 1.5 && r.overdueRatio! <= 3);
  assert.equal(r.isOverdue, true);
  assert.equal(r.segment, 'se_estan_yendo');
  assert.equal(r.urgency, 'leaving');
  assert.equal(r.inRescueFeed, true);
});

test('Campeón enfriándose: atrasado + alta frecuencia → crítico (rojo)', () => {
  const r = computeCadence(mk({ customerId: 'champ', completedVisits: visits(7, 14, 25), visitCount: 10 }), NOW_MS);
  assert.equal(r.isOverdue, true);
  assert.equal(r.urgency, 'critical');           // campeón enfriándose
  assert.equal(r.inRescueFeed, true);
  assert.ok(r.valueScore > 0);
});

test('Perdido: atrasado >3×, gris', () => {
  const r = computeCadence(mk({ customerId: 'perdido', completedVisits: visits(3, 14, 60), visitCount: 3 }), NOW_MS);
  assert.ok(r.overdueRatio! > 3);
  assert.equal(r.segment, 'perdidos');
  assert.equal(r.urgency, 'lost');
  assert.equal(r.inRescueFeed, true);
});

test('Nuevo (<3 visitas): degradado con gracia, sin predicción, no entra al feed', () => {
  const r1 = computeCadence(mk({ customerId: 'nuevo1', completedVisits: visits(1, 0, 5), visitCount: 1 }), NOW_MS);
  assert.equal(r1.segment, 'nuevos');
  assert.equal(r1.confidence, 'none');
  assert.equal(r1.medianGapDays, null);          // NO predicción falsa
  assert.equal(r1.isOverdue, false);
  assert.equal(r1.inRescueFeed, false);

  const r2 = computeCadence(mk({ customerId: 'nuevo2', completedVisits: visits(2, 14, 40), visitCount: 2 }), NOW_MS);
  assert.equal(r2.segment, 'nuevos');             // 2 visitas aún = ruido
  assert.equal(r2.confidence, 'none');
  assert.equal(r2.inRescueFeed, false);
});

test('Confianza: tentativa en 3 visitas, confiable en ≥4', () => {
  const r3 = computeCadence(mk({ customerId: 't3', completedVisits: visits(3, 14, 42), visitCount: 3 }), NOW_MS);
  assert.equal(r3.confidence, 'tentative');
  assert.equal(r3.isOverdue, true);               // ratio 3.0 → atrasado
  assert.equal(r3.inRescueFeed, true);            // entra, pero marcado tentativo

  const r4 = computeCadence(mk({ customerId: 't4', completedVisits: visits(4, 14, 14), visitCount: 4 }), NOW_MS);
  assert.equal(r4.confidence, 'confident');
});

test('Flagged / no-show crónico: atrasado pero EXCLUIDO del feed', () => {
  const r = computeCadence(mk({ customerId: 'flag', completedVisits: visits(4, 14, 40), visitCount: 4, isFlagged: true, noshowCount: 5 }), NOW_MS);
  assert.equal(r.isOverdue, true);                // sí está atrasado
  assert.equal(r.inRescueFeed, false);            // pero NO se sugiere perseguirlo
  assert.equal(r.urgency, 'none');
  assert.equal(r.valueScore, 0);
});

// ─── Feed: ranking por valor + filtrado ───────────────────────────────────────

test('computeRetentionFeed: orden por grupo (campeón → yendo → perdido), excluye no-candidatos', () => {
  const inputs: CustomerCadenceInput[] = [
    mk({ customerId: 'reg',     completedVisits: visits(4, 14, 10), visitCount: 4 }),                   // no atrasado
    mk({ customerId: 'yendo',   completedVisits: visits(4, 14, 30), visitCount: 4 }),                   // feed (leaving)
    mk({ customerId: 'champ',   completedVisits: visits(7, 14, 25), visitCount: 10 }),                  // feed (critical)
    mk({ customerId: 'perdido', completedVisits: visits(3, 14, 60), visitCount: 3 }),                   // feed (lost)
    mk({ customerId: 'nuevo',   completedVisits: visits(1, 0, 5),   visitCount: 1 }),                   // fuera
    mk({ customerId: 'flag',    completedVisits: visits(4, 14, 40), visitCount: 4, isFlagged: true }),  // fuera
  ];
  const feed = computeRetentionFeed(inputs, NOW_MS);

  // Solo candidatos (atrasados, no flagged), en orden de GRUPO
  assert.deepEqual(feed.rows.map((r) => r.customerId), ['champ', 'yendo', 'perdido']);
  assert.equal(feed.porRecuperar, 3);
  // Grupo no-decreciente + valor desc dentro del grupo
  for (let i = 1; i < feed.rows.length; i++) {
    const prev = feed.rows[i - 1]!, cur = feed.rows[i]!;
    assert.ok(feedGroupRank(prev) <= feedGroupRank(cur));
    if (feedGroupRank(prev) === feedGroupRank(cur)) {
      assert.ok(prev.valueScore >= cur.valueScore);
    }
  }
  // topN capea el display sin cambiar el conteo
  const capped = computeRetentionFeed(inputs, NOW_MS, { topN: 2 });
  assert.equal(capped.rows.length, 2);
  assert.equal(capped.porRecuperar, 3);
});

test('Ranking: un perdido de valor ALTO NUNCA rankea arriba de un se-están-yendo de valor menor', () => {
  // perdido_hi: alto valor (más visitas, más caro, muy atrasado) → score continuo alto.
  // yendo_lo: bajo valor. Con la fórmula vieja (score global) perdido_hi ganaba; con el
  // orden por grupo, yendo_lo (se están yendo) va SIEMPRE arriba de perdido_hi (perdido).
  const perdidoHi = mk({
    customerId: 'perdido_hi',
    completedVisits: visits(3, 14, 70),          // ratio 5.0 → perdidos
    visitCount: 5,
    monetaryValues: [500, 500, 500],
  });
  const yendoLo = mk({
    customerId: 'yendo_lo',
    completedVisits: visits(3, 30, 50),          // ratio 1.67 → se_estan_yendo
    visitCount: 3,
    monetaryValues: [100, 100, 100],
  });

  // Sanity: el perdido TIENE más valueScore continuo que el yendo (la trampa vieja).
  const pHi = computeCadence(perdidoHi, NOW_MS);
  const yLo = computeCadence(yendoLo, NOW_MS);
  assert.equal(pHi.segment, 'perdidos');
  assert.equal(yLo.segment, 'se_estan_yendo');
  assert.ok(pHi.valueScore > yLo.valueScore, 'fixture inválido: el perdido debe tener más score continuo');

  // Pero el feed pone al se-están-yendo ARRIBA (grupo primario).
  const feed = computeRetentionFeed([perdidoHi, yendoLo], NOW_MS);
  const iYendo   = feed.rows.findIndex((r) => r.customerId === 'yendo_lo');
  const iPerdido = feed.rows.findIndex((r) => r.customerId === 'perdido_hi');
  assert.ok(iYendo < iPerdido, 'se-están-yendo debe rankear arriba del perdido');
});

test('Explicación humana en idioma barbería', () => {
  const r = computeCadence(mk({ customerId: 'exp', completedVisits: visits(4, 14, 42), visitCount: 4 }), NOW_MS);
  assert.match(r.explanation, /Venía cada .* semanas?, lleva .*/);
});
