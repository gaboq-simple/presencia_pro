// Paso 6 (rediseño barbero) — "el día se corrió".
// Tests del módulo puro dayDrift: el atraso nace SOLO de completed_at, la cita en
// curso proyecta contra el ahora (cero corrimiento propio), la pasada sin marcar
// se excluye (es "no marcó", NO atraso infinito), los huecos absorben, y los
// solapes intencionales no fabrican atraso (dos pasadas: real − forma del horario).
//
// Deterministas: instantes UTC fijos, sin red, sin Intl. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDayDrift,
  DRIFT_THRESHOLD_MIN,
  type DriftAppt,
} from '../apps/lifestyle/src/lib/dayDrift';
import { todayStrInTz, isTodayInTz } from '../apps/lifestyle/src/lib/dayWindow';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 'HH:MM' del día fijo de prueba → ISO UTC. */
function at(hhmm: string): string {
  return `2026-07-18T${hhmm}:00.000Z`;
}
function ms(hhmm: string): number {
  return Date.parse(at(hhmm));
}

let seq = 0;
function appt(
  start: string,
  end: string,
  status: string,
  extra: Partial<DriftAppt> = {},
): DriftAppt {
  return { id: `a${++seq}`, starts_at: at(start), ends_at: at(end), status, ...extra };
}

// ─── Sin hechos → sin atraso ──────────────────────────────────────────────────

test('sin citas → cero corrimiento', () => {
  const d = computeDayDrift([], ms('13:00'));
  assert.equal(d.driftMin, 0);
  assert.equal(d.projections.length, 0);
});

test('completed SIN completed_at (histórica, pre-migración) → cero corrimiento', () => {
  const d = computeDayDrift(
    [appt('13:00', '13:30', 'completed'), appt('13:45', '14:30', 'confirmed')],
    ms('13:40'),
  );
  assert.equal(d.driftMin, 0);
});

test('cierre A TIEMPO (completed_at ≤ ends_at) → cero corrimiento', () => {
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:28') }),
      appt('13:30', '14:15', 'confirmed'),
    ],
    ms('13:29'),
  );
  assert.equal(d.driftMin, 0);
});

test('cierre TEMPRANO nunca adelanta a los siguientes', () => {
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:10') }),
      appt('13:30', '14:15', 'confirmed'),
    ],
    ms('13:15'),
  );
  assert.equal(d.driftMin, 0);
  assert.equal(d.projections.length, 0);
});

// ─── El caso del prompt: terminó tarde y el día se corre en cadena ────────────

test('cierre tarde → la siguiente se proyecta desde completed_at y la cadena propaga', () => {
  // El escenario del prompt: la de 13:00–13:45 se marcó Terminó a las 13:59 (+14).
  // Miguel 13:45–14:30 → entra 13:59. Juan 14:30–15:15 (pegado) → entra 14:44.
  const d = computeDayDrift(
    [
      appt('13:00', '13:45', 'completed', { completed_at: at('13:59') }),
      appt('13:45', '14:30', 'confirmed'),
      appt('14:30', '15:15', 'confirmed'),
    ],
    ms('13:59'),
  );
  assert.equal(d.driftMin, 14);
  assert.equal(d.projections.length, 2);
  assert.equal(d.projections[0]!.projectedStartMs, ms('13:59'));
  assert.equal(d.projections[0]!.shiftMin, 14);
  assert.equal(d.projections[1]!.projectedStartMs, ms('14:44'));
  assert.equal(d.projections[1]!.shiftMin, 14);
});

test('el hueco absorbe el corrimiento (total o parcialmente)', () => {
  // Terminó +20 tarde (13:50), pero la siguiente es a las 14:30 → nada que avisar.
  const total = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:50') }),
      appt('14:30', '15:15', 'confirmed'),
    ],
    ms('13:50'),
  );
  assert.equal(total.driftMin, 0);

  // Parcial: siguiente 13:45 → entra 13:50 (+5); la tercera con hueco propio no se corre.
  const parcial = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:50') }),
      appt('13:45', '14:30', 'confirmed'),
      appt('15:00', '15:45', 'confirmed'),
    ],
    ms('13:50'),
  );
  assert.equal(parcial.driftMin, 5);
  assert.equal(parcial.projections.length, 1);
});

test('driftMin = el corrimiento de la PRÓXIMA afectada (máximo de la cadena)', () => {
  // +14 en la próxima, +4 en la que sigue (un hueco de 10 absorbe parte).
  const d = computeDayDrift(
    [
      appt('13:00', '13:45', 'completed', { completed_at: at('13:59') }),
      appt('13:45', '14:30', 'confirmed'),
      appt('14:40', '15:25', 'confirmed'),
    ],
    ms('13:59'),
  );
  assert.equal(d.driftMin, 14);
  assert.equal(d.projections[1]!.shiftMin, 4);
  assert.ok(d.projections[0]!.shiftMin >= d.projections[1]!.shiftMin);
});

// ─── En curso y pasada sin marcar (la decisión 🔴 del prompt) ─────────────────

test('cita EN CURSO dentro de su ventana → cero corrimiento propio', () => {
  const d = computeDayDrift(
    [appt('13:00', '13:30', 'confirmed'), appt('13:30', '14:15', 'confirmed')],
    ms('13:20'),
  );
  assert.equal(d.driftMin, 0);
});

test('pasada SIN MARCAR → excluida: NO genera atraso infinito', () => {
  // Son las 13:44 y la de 13:00–13:30 sigue confirmed (no marcó). El hero ya
  // pregunta "¿Terminó?" — acá NO se inventa un atraso.
  const d = computeDayDrift(
    [appt('13:00', '13:30', 'confirmed'), appt('13:45', '14:30', 'confirmed')],
    ms('13:44'),
  );
  assert.equal(d.driftMin, 0);
  assert.equal(d.projections.length, 0);
});

test('…y el atraso se cuenta recién cuando marca', () => {
  // La misma cita, marcada a las 13:50 → ahora sí: la de 13:45 entra 13:50 (+5).
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:50') }),
      appt('13:45', '14:30', 'confirmed'),
    ],
    ms('13:50'),
  );
  assert.equal(d.driftMin, 5);
});

test('el ancla alcanza a la que su ventana contiene el ahora, y arrastra a la pegada', () => {
  // Cerró 13:50 la de 13:00–13:40 (+10). La de 13:45–14:15 (su ventana contiene
  // el ahora 13:55) entra 13:50 (+5) y termina 14:20 → la de 14:15 entra 14:20 (+5).
  const d = computeDayDrift(
    [
      appt('13:00', '13:40', 'completed', { completed_at: at('13:50') }),
      appt('13:45', '14:15', 'confirmed'),
      appt('14:15', '15:00', 'confirmed'),
    ],
    ms('13:55'),
  );
  assert.equal(d.driftMin, 5);
  assert.equal(d.projections.length, 2);
  assert.equal(d.projections[0]!.projectedStartMs, ms('13:50'));
  assert.equal(d.projections[1]!.projectedStartMs, ms('14:20'));
});

// ─── Solapes intencionales y estados no activos ───────────────────────────────

test('solape intencional SIN atraso real → cero corrimiento (no fabricar drama)', () => {
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:30') }),
      appt('14:00', '15:00', 'confirmed'),
      appt('14:30', '15:00', 'confirmed'), // encimada a propósito (allow_overlap)
    ],
    ms('13:30'),
  );
  assert.equal(d.driftMin, 0);
  assert.equal(d.projections.length, 0);
});

test('canceladas y no_show no participan', () => {
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:44') }),
      appt('13:45', '14:30', 'cancelled'),
      appt('13:45', '14:30', 'no_show'),
      appt('14:45', '15:30', 'confirmed'),
    ],
    ms('13:44'),
  );
  // La única futura activa es la de 14:45 — y el hueco absorbe el +14.
  assert.equal(d.driftMin, 0);
});

test('adjusted_starts_at manda como inicio efectivo', () => {
  // El cliente avisó retraso: su cita de 13:45 quedó acordada a las 14:00.
  // El barbero cerró 13:55 (+25 sobre su fin 13:30) → contra la hora ACORDADA
  // (14:00) no hay corrimiento.
  const d = computeDayDrift(
    [
      appt('13:00', '13:30', 'completed', { completed_at: at('13:55') }),
      appt('13:45', '14:30', 'confirmed', { adjusted_starts_at: at('14:00') }),
    ],
    ms('13:55'),
  );
  assert.equal(d.driftMin, 0);
});

// ─── El umbral es contrato de la UI ───────────────────────────────────────────

test('el umbral exportado es 10 min (decisión cerrada)', () => {
  assert.equal(DRIFT_THRESHOLD_MIN, 10);
});

// ─── todayStrInTz / isTodayInTz — el "hoy" es el del NEGOCIO, no el del server ─
// El bug: Vercel corre UTC; a las 00:30 UTC del 19 son las 18:30 del 18 en México.
// El default naive (toDateStr(new Date())) mandaba al barbero al día siguiente,
// vacío. La fuente única de "hoy" resuelve en la tz IANA del negocio.

test('todayStrInTz: apenas pasada la medianoche UTC, el hoy de México sigue siendo AYER (UTC)', () => {
  const instant = new Date('2026-07-19T00:30:00Z'); // 18:30 del 18 en MX
  assert.equal(todayStrInTz('America/Mexico_City', instant), '2026-07-18');
  assert.equal(todayStrInTz('UTC', instant), '2026-07-19');
});

test('isTodayInTz se define sobre la misma fuente', () => {
  const instant = new Date('2026-07-19T00:30:00Z');
  assert.equal(isTodayInTz('2026-07-18', 'America/Mexico_City', instant), true);
  assert.equal(isTodayInTz('2026-07-19', 'America/Mexico_City', instant), false);
  assert.equal(isTodayInTz('2026-07-19', 'UTC', instant), true);
});
