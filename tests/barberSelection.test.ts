// S5-BOT-10 — Tests del detector de selección de barbero en CONFIRMING + del
// reinicio centralizado de la selección de reserva (clearBookingSelection).
// Puros y deterministas: sin red, sin Supabase, sin Anthropic.
// Ejecutar: npm test
//
// Cubre:
//   BUG 1 (barbero perdido): detectBarberSelection reconoce "Con Carlos" /
//     "Carlos porfa" → anota la intención de barbero.
//   DECISIÓN B (anti-homonimia): la Regla 2 (nombre pelado) solo dispara con
//     presentBy='staff', evitando que "Mayo"/"Junio" se lean como barbero.
//   Invariante requestedStaffId: clearBookingSelection() SIEMPRE lo borra (no
//     sobrevive una corrección de servicio ni un /reset).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectBarberSelection } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { clearBookingSelection } from '../packages/engine/src/bot/lifestyle/utils';
import type { LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';

const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '22222222-2222-2222-2222-222222222222';
const MAYO   = '33333333-3333-3333-3333-333333333333';

const roster = [
  { id: CARLOS, name: 'Carlos' },
  { id: ANDRES, name: 'Andrés' },
];

function pending(staffId: string, staffName: string): LifestylePendingSlot {
  return {
    index:     1,
    staffId,
    staffName,
    startsAt:  '2026-06-15T23:00:00.000Z',
    endsAt:    '2026-06-15T23:30:00.000Z',
  };
}

const offeredBoth = [pending(CARLOS, 'Carlos'), pending(ANDRES, 'Andrés')];

// ─── Regla 1: "con <nombre>" contra el roster completo ────────────────────────

test('Regla 1: "Con Carlos" → Carlos', () => {
  const r = detectBarberSelection('Con Carlos', roster, offeredBoth, 'time');
  assert.deepEqual(r, { staffId: CARLOS, staffName: 'Carlos' });
});

test('Regla 1: "con andres porfa" (sin acento, palabra extra) → Andrés', () => {
  const r = detectBarberSelection('con andres porfa', roster, offeredBoth, 'time');
  assert.deepEqual(r, { staffId: ANDRES, staffName: 'Andrés' });
});

test('Regla 1: resuelve contra el roster aunque el barbero NO esté en los slots ofrecidos', () => {
  const onlyCarlos = [pending(CARLOS, 'Carlos')];
  const r = detectBarberSelection('con Andrés', roster, onlyCarlos, 'time');
  assert.deepEqual(r, { staffId: ANDRES, staffName: 'Andrés' });
});

test('Regla 1: "con quién?" no resuelve ningún nombre → null', () => {
  const r = detectBarberSelection('con quién?', roster, offeredBoth, 'staff');
  assert.equal(r, null);
});

// ─── Regla 2: nombre pelado SOLO con presentBy=staff ──────────────────────────

test('Regla 2: presentBy=staff + "Carlos" pelado → Carlos', () => {
  const r = detectBarberSelection('Carlos', roster, offeredBoth, 'staff');
  assert.deepEqual(r, { staffId: CARLOS, staffName: 'Carlos' });
});

test('Regla 2: "Carlos porfa" pelado con presentBy=staff → Carlos', () => {
  const r = detectBarberSelection('Carlos porfa', roster, offeredBoth, 'staff');
  assert.deepEqual(r, { staffId: CARLOS, staffName: 'Carlos' });
});

test('Regla 2 NO dispara con presentBy=time (anti-homonimia)', () => {
  const r = detectBarberSelection('Carlos', roster, offeredBoth, 'time');
  assert.equal(r, null);
});

test('Regla 2 NO dispara sin presentBy (default)', () => {
  const r = detectBarberSelection('Carlos', roster, offeredBoth, undefined);
  assert.equal(r, null);
});

// ─── Anti-homonimia: "Mayo" como barbero solo dentro de presentBy=staff ───────

test('homonimia: "mayo" NO se lee como barbero con presentBy=time', () => {
  const offeredMayo = [pending(MAYO, 'Mayo')];
  const r = detectBarberSelection('mayo', [{ id: MAYO, name: 'Mayo' }], offeredMayo, 'time');
  assert.equal(r, null);
});

test('homonimia: "mayo" SÍ se lee como barbero cuando el bot presentó a Mayo (presentBy=staff)', () => {
  const offeredMayo = [pending(MAYO, 'Mayo')];
  const r = detectBarberSelection('mayo', [{ id: MAYO, name: 'Mayo' }], offeredMayo, 'staff');
  assert.deepEqual(r, { staffId: MAYO, staffName: 'Mayo' });
});

// ─── Sin mención de barbero ───────────────────────────────────────────────────

test('"a las 5" no menciona barbero → null', () => {
  const r = detectBarberSelection('a las 5', roster, offeredBoth, 'staff');
  assert.equal(r, null);
});

test('"la primera" no menciona barbero → null', () => {
  const r = detectBarberSelection('la primera', roster, offeredBoth, 'staff');
  assert.equal(r, null);
});

// ─── Invariante requestedStaffId: clearBookingSelection lo borra ──────────────

test('clearBookingSelection() borra requestedStaffId (no sobrevive corrección/reset)', () => {
  const cleared = clearBookingSelection();
  assert.ok('requestedStaffId' in cleared, 'la clave debe estar presente para sobrescribir el spread');
  assert.equal(cleared.requestedStaffId, undefined);
});

test('clearBookingSelection() borra también serviceId/staffId y resetea contadores', () => {
  const cleared = clearBookingSelection();
  assert.equal(cleared.serviceId, undefined);
  assert.equal(cleared.staffId, undefined);
  assert.equal(cleared.pendingSlots, undefined);
  assert.equal(cleared.nearestOfferSlot, null);
  assert.equal(cleared.clarification_attempts, 0);
  assert.equal(cleared.rejection_attempts, 0);
});

test('aplicar clearBookingSelection sobre un contexto con requestedStaffId lo elimina', () => {
  const ctx = { serviceId: 'svc', staffId: CARLOS, requestedStaffId: CARLOS, requestedDate: '2026-06-15' };
  const next = { ...ctx, ...clearBookingSelection() };
  assert.equal(next.requestedStaffId, undefined);
  assert.equal(next.serviceId, undefined);
  assert.equal(next.requestedDate, undefined);
});
