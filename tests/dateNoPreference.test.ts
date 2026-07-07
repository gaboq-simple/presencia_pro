// Hallazgo 4 — eje FECHA: "cualquier día" / "otro día".
// Gemelo de R4.2 (no-preferencia de barbero) en el eje FECHA. Cubre los DOS fixes:
//   1. qualifyingDatetime: "cualquier día" (interpretation.noPreference, ANTES del
//      clasificador) → SHOWING_SLOTS con requestedDate=HOY. Opción A: SHOWING_SLOTS
//      resuelve el PRIMER día con cupo (chequea hoy, cae a findSlotsInNextDays si vacío).
//   2. confirmingAppointment: "otro día" interceptado ANTES del router → ancla (día
//      mostrado) + 1 → SHOWING_SLOTS. EXIGE parseDate==null (caveat 3: "otro día, el
//      martes" lleva fecha concreta → NO se intercepta, sigue a date_redirect).
//
// El eje lo fija el ESTADO (el intérprete es axis-agnostic): en datetime "cualquiera"
// = FECHA porque el barbero ya se resolvió en QUALIFYING_STAFF.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleQualifyingDatetime } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import {
  handleConfirmingAppointment,
  detectsNextDayRedirect,
} from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { interpret } from '../packages/engine/src/bot/lifestyle/interpreter';
import { localTimeToUTC, getTodayStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City'; // UTC-6 fijo (México sin DST)
const DATE   = '2026-06-15';          // lunes (DOW 1) — día "mostrado" en confirming
const DOW    = 1;
const NOW    = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

// ─── Fake Supabase (idéntico patrón a r42StaffInterpreter) ───────────────────

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
    id:                    `biz-h4-${bizCounter}`, // único por test → aísla cache de catálogo
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

// Tres slots de la tarde del día mostrado (DATE).
const AFTERNOON: LifestylePendingSlot[] = [pslot(1, '16:45'), pslot(2, '17:00'), pslot(3, '17:15')];

// ─── Fix 1: "cualquier día" en qualifyingDatetime → SHOWING_SLOTS (HOY) ─────────

test('Hallazgo 4: "cualquier día" sin barbero → SHOWING_SLOTS, requestedDate=HOY, fuerza autoAssign', async () => {
  // El intérprete marca noPreference (CRUDO); el ESTADO (datetime) lo lee como FECHA.
  assert.equal(interpret({ message: 'cualquier día', now: NOW, timezone: TZ }).noPreference, true);

  const ctx: LifestyleBotContext = { serviceId: SVC }; // sin staff ni autoAssign aún
  const r = await handleQualifyingDatetime(makeMsg('cualquier día'), ctx, depsWith('cualquier día'));
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.requestedDate, getTodayStr(TZ)); // Opción A: SHOWING_SLOTS resuelve el primer cupo
  assert.equal(r.newContext.autoAssign, true);               // sin barbero → auto-asigna
  assert.equal(r.responseText, '');                          // chaining: SHOWING_SLOTS computa
});

test('Hallazgo 4: "cualquier día" con barbero elegido → conserva staffId, NO fuerza autoAssign', async () => {
  const ctx: LifestyleBotContext = { serviceId: SVC, staffId: CARLOS };
  const r = await handleQualifyingDatetime(makeMsg('cualquier día'), ctx, depsWith('cualquier día'));
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.requestedDate, getTodayStr(TZ));
  assert.equal(r.newContext.staffId, CARLOS);       // barbero preservado
  assert.equal(r.newContext.autoAssign, undefined);  // hasStaffChoice → no se fuerza
});

test('Hallazgo 4: fecha concreta GANA — "cualquier día, el martes" usa el martes (no HOY)', async () => {
  // El bloque parseDate corre ANTES del de noPreference → la fecha concreta gana.
  const ctx: LifestyleBotContext = { serviceId: SVC, autoAssign: true };
  const r = await handleQualifyingDatetime(makeMsg('cualquier día, el martes'), ctx, depsWith('cualquier día, el martes'));
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.requestedDate, '2026-06-16'); // martes siguiente, NO hoy
});

// ─── Fix 2 (detector puro): "otro día" → siguiente, exige parseDate==null ───────

test('Hallazgo 4: detectsNextDayRedirect — "otro día"/"otra fecha" sin fecha concreta → true', () => {
  assert.equal(detectsNextDayRedirect('otro día', NOW, TZ), true);
  assert.equal(detectsNextDayRedirect('mejor otro día', NOW, TZ), true);
  assert.equal(detectsNextDayRedirect('otra fecha', NOW, TZ), true);
});

test('Hallazgo 4 caveat (3): "otro día, el martes" lleva fecha concreta → detectsNextDayRedirect false', () => {
  // Con fecha concreta NO es "siguiente": cae al router → date_redirect (parsea el martes).
  assert.equal(detectsNextDayRedirect('otro día, el martes', NOW, TZ), false);
  // Sin keyword tampoco dispara.
  assert.equal(detectsNextDayRedirect('a las 5', NOW, TZ), false);
});

// ─── Fix 2 (handler): "otro día" tras ver slots → ancla+1 → SHOWING_SLOTS ───────

test('Hallazgo 4: "otro día" tras ver slots → SHOWING_SLOTS con requestedDate = día mostrado + 1', async () => {
  const ctx: LifestyleBotContext = {
    serviceId:          SVC,
    autoAssign:         true,
    requestedDate:      DATE,        // día mostrado (lunes 2026-06-15)
    pendingSlots:       AFTERNOON,
    rejection_attempts: 1,           // avanzar de día ES progreso → se resetea
  };
  const r = await handleConfirmingAppointment(makeMsg('otro día'), ctx, depsWith('otro día'));
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.requestedDate, '2026-06-16'); // ancla + 1
  assert.equal(r.newContext.pendingSlots, undefined);     // slots del día viejo limpiados
  assert.equal(r.newContext.requestedTime, undefined);
  assert.equal(r.newContext.rejection_attempts, 0);
  assert.equal(r.responseText, '');                       // chaining
});

test('Hallazgo 4 caveat (3): "otro día, el martes" NO avanza ancla+1 → date_redirect (QUALIFYING_DATETIME)', async () => {
  const ctx: LifestyleBotContext = {
    serviceId:     SVC,
    autoAssign:    true,
    requestedDate: DATE,
    pendingSlots:  AFTERNOON,
  };
  const r = await handleConfirmingAppointment(makeMsg('otro día, el martes'), ctx, depsWith('otro día, el martes'));
  assert.equal(r.newState, 'QUALIFYING_DATETIME');     // router → date_redirect (NO interceptado)
  assert.equal(r.newContext.requestedDate, undefined); // date_redirect limpia el ancla
});
