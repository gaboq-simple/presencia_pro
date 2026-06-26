// R4.2 — qualifyingStaff + confirmingAppointment consumen `interpretation.noPreference`.
// Un solo concern: NO-PREFERENCIA ("cualquiera"/"el que sea"/…). La detección de
// keyword se movió al intérprete (fuente ÚNICA, antes duplicada y divergida entre
// los 2 estados: confirming reconocía 'no tengo tema'/'el que este' que staff no).
//
// La malla previa (staffAxisIntent, slotSelection) arma deps/llamadas SIN
// interpretation → ejercita el FALLBACK local. Este archivo cubre la vía NUEVA
// (interpretation poblado como en dispatch()) y la PARIDAD intérprete↔fallback.
//
// FRONTERA R4.2 verificada aquí: el guard SHIFT_OR_EXTREME de confirming NO se
// movió al intérprete — "cualquiera de la tarde" sigue siendo preferencia de turno
// (NO no-preferencia) en confirming, AUN con interpretation.noPreference=true. La
// detección es neutra (intérprete); la política es del estado.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleQualifyingStaff } from '../packages/engine/src/bot/lifestyle/states/qualifyingStaff';
import { routeSlotSelection } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { interpret } from '../packages/engine/src/bot/lifestyle/interpreter';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City'; // UTC-6 fijo (México sin DST)
const DATE   = '2026-06-15';          // lunes (DOW 1)
const DOW    = 1;
const NOW    = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

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

const CARLOS_ROW: StaffRow = { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' };
const ANDRES_ROW: StaffRow = { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002' };

// Dos barberos activos → qualifyingStaff NO short-circuitea por activeStaff<=1 y
// llega al check de no-preferencia.
function tables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [CARLOS_ROW, ANDRES_ROW],
    staff_availability:        [
      { staff_id: CARLOS, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null },
      { staff_id: ANDRES, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null },
    ],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
  };
}

let bizCounter = 0;
function makeBaseDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-r42-${bizCounter}`, // único por test → aísla cache de catálogo
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

function pslot(index: number, localHHMM: string): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + 30 * 60_000);
  return { index, staffId: CARLOS, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}

// Tres slots de la tarde (mismo fixture que slotSelection).
const AFTERNOON: LifestylePendingSlot[] = [pslot(1, '16:45'), pslot(2, '17:00'), pslot(3, '17:15')];

// ─── qualifyingStaff: no-preferencia vía interpretation ───────────────────────

test('R4.2 qualifyingStaff: "cualquiera" auto-asigna vía interpretation.noPreference', async () => {
  assert.equal(interpret({ message: 'cualquiera', now: NOW, timezone: TZ }).noPreference, true);

  const ctx: LifestyleBotContext = { serviceId: SVC };
  const r = await handleQualifyingStaff(makeMsg('cualquiera'), ctx, depsWith('cualquiera'));
  assert.equal(r.newState, 'QUALIFYING_DATETIME'); // sin requestedDate → pide fecha
  assert.equal(r.newContext.autoAssign, true);
  assert.equal(r.newContext.staffId, undefined);
  assert.equal(r.newContext.presentBy, undefined); // camino (c), NO eje barbero
});

test('R4.2 qualifyingStaff: superset "no tengo tema" auto-asigna (NO estaba en la lista vieja de staff)', async () => {
  assert.equal(interpret({ message: 'no tengo tema', now: NOW, timezone: TZ }).noPreference, true);

  const ctx: LifestyleBotContext = { serviceId: SVC };
  const r = await handleQualifyingStaff(makeMsg('no tengo tema'), ctx, depsWith('no tengo tema'));
  assert.equal(r.newState, 'QUALIFYING_DATETIME');
  assert.equal(r.newContext.autoAssign, true);
});

test('R4.2 qualifyingStaff paridad: "el que sea" → mismo resultado con y sin interpretation', async () => {
  const withI = await handleQualifyingStaff(makeMsg('el que sea'), { serviceId: SVC }, depsWith('el que sea'));
  const noI   = await handleQualifyingStaff(makeMsg('el que sea'), { serviceId: SVC }, depsNoInterp());
  assert.equal(withI.newState, noI.newState);
  assert.equal(withI.newContext.autoAssign, noI.newContext.autoAssign);
  assert.equal(withI.newContext.staffId, noI.newContext.staffId);
});

// ─── confirmingAppointment: el guard SHIFT_OR_EXTREME SOBREVIVE (política de estado) ──

test('R4.2 confirming: "cualquiera" → no_preference vía interpretation', () => {
  const r = routeSlotSelection('cualquiera', AFTERNOON, NOW, TZ, interpret({ message: 'cualquiera', now: NOW, timezone: TZ }));
  assert.equal(r.action, 'no_preference');
});

test('R4.2 confirming: guard SOBREVIVE — "cualquiera de la tarde" NO es no_preference, aun con noPreference=true', () => {
  // El intérprete marca noPreference=true (CRUDO); el guard de ESTADO lo veta:
  // "de la tarde" = preferencia de turno (hay slots mostrados), no no-preferencia.
  assert.equal(interpret({ message: 'cualquiera de la tarde', now: NOW, timezone: TZ }).noPreference, true);

  const r = routeSlotSelection(
    'cualquiera de la tarde', AFTERNOON, NOW, TZ,
    interpret({ message: 'cualquiera de la tarde', now: NOW, timezone: TZ }),
  );
  assert.notEqual(r.action, 'no_preference'); // filtra a la tarde, no auto-asigna el primero
});

test('R4.2 confirming paridad: "cualquiera de la tarde" → mismo route con y sin interpretation', () => {
  const withI = routeSlotSelection(
    'cualquiera de la tarde', AFTERNOON, NOW, TZ,
    interpret({ message: 'cualquiera de la tarde', now: NOW, timezone: TZ }),
  );
  const noI = routeSlotSelection('cualquiera de la tarde', AFTERNOON, NOW, TZ);
  assert.deepEqual(withI, noI);
});
