// R4.1 — CONFIRMING_APPOINTMENT consume `deps.interpretation` (afirmación/hora).
// La malla previa arma `deps` SIN interpretation, así que ejercita el camino de
// FALLBACK (extractRawTime/isAffirmation locales). Este archivo cubre la vía NUEVA:
// deps con interpretation poblado (como lo inyecta dispatch() en producción) y la
// PARIDAD intérprete-vs-fallback (mismo resultado por ambos caminos).
//
// Frontera R4.1: SOLO afirmación/hora. No toca side-question/post-CONFIRMED/otros
// estados. Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleConfirmingAppointment,
  routeSlotSelection,
} from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { interpret } from '../packages/engine/src/bot/lifestyle/interpreter';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ    = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
const DATE  = '2026-06-15';          // lunes (DOW 1)
const DOW   = 1;
const NOW   = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const STAFF = '11111111-1111-1111-1111-111111111111';
const SVC   = '22222222-2222-2222-2222-222222222222';

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const data = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      lt:     () => builder,
      neq:    () => builder,
      order:  () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_ROW: StaffRow = { id: STAFF, name: 'Carlos', whatsapp_id: '5210000000000' };

function tables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF_ROW],
    staff_availability:        [{ staff_id: STAFF, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF }],
  };
}

let bizCounter = 0;
function makeBaseDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-r41-${bizCounter}`, // único por test → aísla la cache del catálogo
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'Te comunico con el equipo.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  return { business, supabase: makeSupabase(tables()), anthropicKey: '', model: 'haiku' };
}

// Deps CON interpretation (como dispatch() en producción): interpret() del mismo
// msg.body, NOW y TZ que verá el handler.
function depsWith(body: string): never {
  const d = makeBaseDeps() as Record<string, unknown>;
  d.interpretation = interpret({ message: body, now: NOW, timezone: TZ });
  return d as never;
}

// Deps SIN interpretation → fuerza el fallback local (como la malla previa).
function depsNoInterp(): never {
  return makeBaseDeps() as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.test',
  } as never;
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

function pslot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + durMin * 60_000);
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}

function baseContext(pendingSlots: LifestylePendingSlot[]): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF, autoAssign: false, requestedDate: DATE, pendingSlots };
}

const AFTERNOON = [pslot(1, '16:45'), pslot(2, '17:00'), pslot(3, '17:15')];

// Contexto con una oferta pendiente concreta (nearestOfferSlot = 17:00).
function offerCtx(): LifestyleBotContext {
  return { ...baseContext(AFTERNOON), nearestOfferSlot: localISO('17:00') };
}

// Handler con interpretation poblado / con fallback.
function handleI(body: string, ctx: LifestyleBotContext) {
  return handleConfirmingAppointment(makeMsg(body), ctx, depsWith(body));
}
function handleNoI(body: string, ctx: LifestyleBotContext) {
  return handleConfirmingAppointment(makeMsg(body), ctx, depsNoInterp());
}

// ─── Afirmación vía interpretation ─────────────────────────────────────────────

test('R4.1 afirmación: "sí" acepta la oferta pendiente (interpretation.affirmation=true)', async () => {
  // Precondición: el intérprete marca afirmación.
  assert.equal(interpret({ message: 'sí', now: NOW, timezone: TZ }).affirmation, true);

  const r = await handleI('sí', offerCtx());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00')); // el slot ofrecido
});

test('R4.1 afirmación: "dale" acepta el único slot pendiente (P1, interpretation)', async () => {
  assert.equal(interpret({ message: 'dale', now: NOW, timezone: TZ }).affirmation, true);

  const r = await handleI('dale', baseContext([pslot(1, '17:00')]));
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

test('R4.1 negación: "no" entra a la progresión de rechazo (interpretation.affirmation=false)', async () => {
  assert.equal(interpret({ message: 'no', now: NOW, timezone: TZ }).affirmation, false);

  const r = await handleI('no', baseContext(AFTERNOON));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.rejection_attempts, 1);          // 0 → 1 (paso A)
  assert.match(r.responseText, /Sin problema/);              // reconoce el "no"
});

// ─── Hora vía interpretation ───────────────────────────────────────────────────

test('R4.1 hora: "a las 5" selecciona 17:00 vía interpretation.time (desambigua PM por slots)', async () => {
  // interpretation.time es CRUDA: hora 5 sin período (la política PM la aplica el
  // estado con resolveTargetMinutes contra los slots).
  assert.deepEqual(interpret({ message: 'a las 5', now: NOW, timezone: TZ }).time, { hour: 5, minute: 0, period: null });

  const r = await handleI('a las 5', baseContext(AFTERNOON));
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

test('R4.1 hora: "5 de la tarde" selecciona 17:00 vía interpretation.time (período explícito pm)', async () => {
  assert.deepEqual(interpret({ message: '5 de la tarde', now: NOW, timezone: TZ }).time, { hour: 5, minute: 0, period: 'pm' });

  const r = await handleI('5 de la tarde', baseContext(AFTERNOON));
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

// ─── Paridad intérprete ↔ fallback ─────────────────────────────────────────────
// El valor de interpretation.time == extractRawTime(msg) (mismo parser), así que
// routeSlotSelection con y sin interpretation debe dar el MISMO SelectionRoute.
// Incluye una variante con espacios alrededor para probar que el .trim() (única
// diferencia de entrada entre ambos caminos) no cambia el resultado.

test('R4.1 paridad hora: routeSlotSelection da el mismo route con y sin interpretation', () => {
  const phrases = ['a las 5', '5pm', '5 de la tarde', '5:15', 'el de las 5', '  a las 5  ', 'la primera', 'cualquiera'];
  for (const body of phrases) {
    const withInterp = routeSlotSelection(body, AFTERNOON, NOW, TZ, interpret({ message: body, now: NOW, timezone: TZ }));
    const noInterp   = routeSlotSelection(body, AFTERNOON, NOW, TZ);
    assert.deepEqual(withInterp, noInterp, `divergencia en "${body}"`);
  }
});

test('R4.1 paridad afirmación: el handler decide igual con y sin interpretation', async () => {
  // "sí" sobre una oferta pendiente: ambos caminos aceptan el mismo slot.
  const withI   = await handleI('sí', offerCtx());
  const noI     = await handleNoI('sí', offerCtx());
  assert.equal(withI.newState, noI.newState);
  assert.equal(withI.responseText, noI.responseText);
  assert.equal(withI.newContext.selectedSlot, noI.newContext.selectedSlot);

  // "no" sin señal de selección: ambos caminos entran al mismo paso de rechazo.
  const rejWith = await handleI('no', baseContext(AFTERNOON));
  const rejNo   = await handleNoI('no', baseContext(AFTERNOON));
  assert.equal(rejWith.newState, rejNo.newState);
  assert.equal(rejWith.responseText, rejNo.responseText);
});
