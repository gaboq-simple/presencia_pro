// ─── Tests de staffRecompra (Barberos · Negocio) — recompra de héroe ──────────
// El filo: recompra AL barbero (no volumen, no repetidores del negocio). Bordes:
// cliente repartido (denominador de dos, numerador de cero), madurez (1-visita
// reciente excluida / madura cuenta como no-recompra), piso (<5 → banda), promedio
// del local pooled, y orden FIJO alfabético (nunca por la métrica). Puro, sin DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStaffRecompra,
  RECOMPRA_MATURE_DAYS,
  RECOMPRA_MIN_COHORT,
  type CompletedVisit,
  type StaffRosterEntry,
} from '../apps/lifestyle/src/lib/staffRecompra';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 15 jul 2026
const DAY = 86_400_000;

/** Una visita `daysAgo` días antes de NOW. */
function v(staffId: string, customerId: string, daysAgo: number): CompletedVisit {
  return { staffId, customerId, startsAt: new Date(NOW - daysAgo * DAY).toISOString() };
}
/** N clientes que RECOMPRARON con un barbero (2 visitas cada uno). */
function recompra(staffId: string, prefix: string, n: number): CompletedVisit[] {
  const out: CompletedVisit[] = [];
  for (let i = 0; i < n; i++) out.push(v(staffId, `${prefix}${i}`, 40), v(staffId, `${prefix}${i}`, 10));
  return out;
}
/** N clientes de UNA visita madura (≥30d) con un barbero → no-recompra. */
function matureSingle(staffId: string, prefix: string, n: number): CompletedVisit[] {
  const out: CompletedVisit[] = [];
  for (let i = 0; i < n; i++) out.push(v(staffId, `${prefix}m${i}`, 40));
  return out;
}
function rateOf(res: ReturnType<typeof computeStaffRecompra>, staffId: string) {
  return res.staff.find((s) => s.staffId === staffId)!.rate;
}
function approx(a: number, b: number, msg?: string) {
  assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} ≈ ${b}`);
}

const ROSTER: StaffRosterEntry[] = [
  { staffId: 'c', staffName: 'Carlos' },
  { staffId: 'a', staffName: 'Andrés' },
];

// ─── Recompra vs no + promedio del local ──────────────────────────────────────

test('tasas por barbero + promedio pooled correcto', () => {
  const visits = [
    ...recompra('c', 'c', 4),      // Carlos: 4 recompraron
    ...matureSingle('c', 'c', 2),  //         2 maduros sin volver  → cohorte 6, ret 4
    ...recompra('a', 'a', 2),      // Andrés: 2 recompraron
    ...matureSingle('a', 'a', 3),  //         3 maduros sin volver  → cohorte 5, ret 2
  ];
  const res = computeStaffRecompra(ROSTER, visits, NOW);

  const c = rateOf(res, 'c');
  const a = rateOf(res, 'a');
  assert.equal(c.status, 'ok');
  assert.equal(a.status, 'ok');
  if (c.status === 'ok') { assert.equal(c.cohortSize, 6); assert.equal(c.retained, 4); approx(c.rate, 4 / 6); }
  if (a.status === 'ok') { assert.equal(a.cohortSize, 5); assert.equal(a.retained, 2); approx(a.rate, 2 / 5); }

  // Promedio del local = pooled: (4+2) / (6+5) = 6/11.
  assert.equal(res.localAverage.status, 'ok');
  if (res.localAverage.status === 'ok') {
    assert.equal(res.localAverage.cohortSize, 11);
    assert.equal(res.localAverage.retained, 6);
    approx(res.localAverage.rate, 6 / 11);
  }
});

// ─── Cliente REPARTIDO: denominador de ambos, numerador de ninguno ────────────

test('cliente repartido baja la tasa de AMBOS barberos (no se atribuye a uno)', () => {
  const base = [...recompra('c', 'c', 5), ...recompra('a', 'a', 5)]; // ambos 5/5 = 100%
  const resBefore = computeStaffRecompra(ROSTER, base, NOW);
  const cBefore = rateOf(resBefore, 'c');
  const aBefore = rateOf(resBefore, 'a');
  if (cBefore.status === 'ok') approx(cBefore.rate, 1);
  if (aBefore.status === 'ok') approx(aBefore.rate, 1);

  // 's1' vio a Carlos UNA vez y a Andrés UNA vez (ambas maduras), nunca volvió.
  const withShared = [...base, v('c', 's1', 40), v('a', 's1', 40)];
  const res = computeStaffRecompra(ROSTER, withShared, NOW);
  const c = rateOf(res, 'c');
  const a = rateOf(res, 'a');

  // En el DENOMINADOR de ambos (cohorte 6), en el NUMERADOR de ninguno (retained 5).
  if (c.status === 'ok') { assert.equal(c.cohortSize, 6); assert.equal(c.retained, 5); approx(c.rate, 5 / 6); }
  if (a.status === 'ok') { assert.equal(a.cohortSize, 6); assert.equal(a.retained, 5); approx(a.rate, 5 / 6); }
  // Bajó en ambos respecto de 100%.
  if (c.status === 'ok' && cBefore.status === 'ok') assert.ok(c.rate < cBefore.rate);
  if (a.status === 'ok' && aBefore.status === 'ok') assert.ok(a.rate < aBefore.rate);
});

// ─── Madurez ──────────────────────────────────────────────────────────────────

test('madurez: 1-visita RECIENTE excluida del denominador; 1-visita MADURA cuenta', () => {
  const roster: StaffRosterEntry[] = [{ staffId: 'c', staffName: 'Carlos' }];
  const fiveRecompra = recompra('c', 'c', 5); // piso alcanzado

  // Cliente de 1 visita RECIENTE (10d < 30d) → fuera del denominador.
  const recent = computeStaffRecompra(roster, [...fiveRecompra, v('c', 'reciente', 10)], NOW);
  const rr = rateOf(recent, 'c');
  if (rr.status === 'ok') { assert.equal(rr.cohortSize, 5, 'reciente NO entra al denominador'); assert.equal(rr.retained, 5); }

  // El mismo cliente pero MADURO (40d ≥ 30d) → entra como no-recompra.
  const mature = computeStaffRecompra(roster, [...fiveRecompra, v('c', 'maduro', 40)], NOW);
  const mr = rateOf(mature, 'c');
  if (mr.status === 'ok') { assert.equal(mr.cohortSize, 6, 'maduro SÍ entra'); assert.equal(mr.retained, 5); approx(mr.rate, 5 / 6); }

  // Chequeo del umbral exacto.
  assert.equal(RECOMPRA_MATURE_DAYS, 30);
});

// ─── Piso de datos ────────────────────────────────────────────────────────────

test('piso: <5 clientes maduros → banda insufficient (sin %)', () => {
  const roster: StaffRosterEntry[] = [
    { staffId: 'a', staffName: 'Andrés' },
    { staffId: 'z', staffName: 'Zoe' }, // sin ninguna visita
  ];
  // Andrés: 4 maduros (2 recompra + 2 single) → cohorte 4 < 5.
  const visits = [...recompra('a', 'a', 2), ...matureSingle('a', 'a', 2)];
  const res = computeStaffRecompra(roster, visits, NOW);

  const a = rateOf(res, 'a');
  const z = rateOf(res, 'z');
  assert.equal(a.status, 'insufficient');
  if (a.status === 'insufficient') assert.equal(a.cohortSize, 4);
  assert.equal(z.status, 'insufficient');
  if (z.status === 'insufficient') assert.equal(z.cohortSize, 0);
  assert.equal(RECOMPRA_MIN_COHORT, 5);

  // Con toda la cohorte bajo el piso, el promedio pooled (4) también es insufficient.
  assert.equal(res.localAverage.status, 'insufficient');
});

// ─── Orden FIJO (no ranking) ──────────────────────────────────────────────────

test('orden FIJO alfabético, NUNCA por la métrica', () => {
  // Roster entra en orden no-alfabético; Carlos tiene MEJOR tasa que Andrés.
  const visits = [
    ...recompra('c', 'c', 5),                               // Carlos 5/5 = 100%
    ...recompra('a', 'a', 2), ...matureSingle('a', 'a', 3), // Andrés 2/5 = 40%
  ];
  const res = computeStaffRecompra(ROSTER, visits, NOW); // ROSTER = [Carlos, Andrés]

  // Alfabético: Andrés (peor tasa) primero, Carlos después. Si fuera por métrica,
  // Carlos iría primero → confirma que el orden NO es la métrica.
  assert.deepEqual(res.staff.map((s) => s.staffName), ['Andrés', 'Carlos']);
});

// ─── Tono vs promedio (color, no puesto) ──────────────────────────────────────

test('tono: above / below vs promedio del local', () => {
  const visits = [
    ...recompra('c', 'c', 4), ...matureSingle('c', 'c', 2), // Carlos 4/6 ≈ 0.667
    ...recompra('a', 'a', 2), ...matureSingle('a', 'a', 3), // Andrés 2/5 = 0.4
  ];
  const res = computeStaffRecompra(ROSTER, visits, NOW); // avg = 6/11 ≈ 0.545
  const c = res.staff.find((s) => s.staffId === 'c')!;
  const a = res.staff.find((s) => s.staffId === 'a')!;
  assert.equal(c.tone, 'above'); // 0.667 > 0.545 + banda
  assert.equal(a.tone, 'below'); // 0.4   < 0.545 - banda
});

test('tono: near cuando la tasa cae dentro de la banda del promedio', () => {
  // Dos barberos con la MISMA tasa → el promedio = esa tasa → ambos neutros.
  const visits = [
    ...recompra('c', 'c', 3), ...matureSingle('c', 'c', 3), // 3/6 = 0.5
    ...recompra('a', 'a', 3), ...matureSingle('a', 'a', 3), // 3/6 = 0.5
  ];
  const res = computeStaffRecompra(ROSTER, visits, NOW); // avg 6/12 = 0.5
  assert.equal(res.staff.find((s) => s.staffId === 'c')!.tone, 'near');
  assert.equal(res.staff.find((s) => s.staffId === 'a')!.tone, 'near');
});
