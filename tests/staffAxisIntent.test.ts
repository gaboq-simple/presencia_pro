// S5-BOT-04 (A1) — Eje de interés (hora vs barbero) + presentación por barbero.
// Puros y deterministas: sin red, sin Supabase real, sin Anthropic.
// Ejecutar: npm test
//
// Cubre:
//   1. Detector puro staffAxisIntent (los 3 ejes: a / b / c).
//   2. Saneo de NO_PREFERENCE: "¿qué barbero está disponible?" ya no auto-asigna
//      mudo → va al eje barbero (presentBy:'staff').
//   3. Presentación por barbero en SHOWING_SLOTS: muestra los nombres (no los
//      suprime) y no pierde barberos que comparten hora.
//   4. Guard de interrogación en routeSlotSelection (ask_who) + 4 no-regresiones.
//   5. CRÍTICO: camino (c) "cualquiera" byte-idéntico (sin presentBy).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wantsToChooseStaff, asksWhoOnly } from '../packages/engine/src/bot/lifestyle/staffAxisIntent';
import { handleQualifyingStaff } from '../packages/engine/src/bot/lifestyle/states/qualifyingStaff';
import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { routeSlotSelection, type SelectionRoute } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── 1. Detector puro ─────────────────────────────────────────────────────────

test('eje (a) wantsToChooseStaff: reconoce intención de elegir barbero', () => {
  const positives = [
    'qué barberos hay',
    'que barberos tienen',
    'cuáles barberos hay',
    'quiénes atienden hoy',
    'quienes hay',
    'puedo elegir barbero?',
    'puedo escoger',
    'opciones de barbero',
    'con quién puedo agendar',
  ];
  for (const p of positives) {
    assert.equal(wantsToChooseStaff(p), true, `debe detectar elección: "${p}"`);
  }
});

test('eje (a) wantsToChooseStaff: NO confunde no-preferencia, hora ni nombre concreto', () => {
  const negatives = [
    'cualquiera',
    'el que sea',
    'a las 12',
    'las 12',
    'quiero con Carlos',
    'sí',
    '',
    '   ',
  ];
  for (const n of negatives) {
    assert.equal(wantsToChooseStaff(n), false, `NO debe detectar: "${n}"`);
  }
});

test('eje (b) asksWhoOnly: pregunta-sobre-quién ambigua (¿/? + token de barbero)', () => {
  const positives = [
    '¿con quién sería?',
    '¿quién me toca?',
    '¿qué barbero está disponible para las 12?',
    'con quien me agendas?',
  ];
  for (const p of positives) {
    assert.equal(asksWhoOnly(p), true, `debe detectar pregunta-quién: "${p}"`);
  }
});

test('eje (b) asksWhoOnly: el "?" solo NO basta — exige token de barbero', () => {
  assert.equal(asksWhoOnly('¿a las 6?'), false);          // duda de hora, sin barbero
  assert.equal(asksWhoOnly('¿el viernes?'), false);
  assert.equal(asksWhoOnly('con quién puedo'), false);    // sin interrogación → no es (b)
  assert.equal(asksWhoOnly('quiero con Carlos'), false);  // sin interrogación
  assert.equal(asksWhoOnly(''), false);
});

test('caso mixto del smoke: "¿qué barbero está disponible para las 12?" gana el eje (b)', () => {
  assert.equal(asksWhoOnly('¿qué barbero está disponible para las 12?'), true);
});

// ─── Infra para handler tests (fake Supabase, sin red) ────────────────────────

const TZ    = 'America/Mexico_City';
const DATE  = '2026-06-15';                          // lunes (DOW 1)
const DOW   = 1;
const NOW   = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const SVC   = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

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
function makeDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-axis-${bizCounter}`, // único por test → aísla cache de catálogo
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
  return { business, supabase: makeSupabase(tables()), anthropicKey: '', model: 'haiku' } as never;
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

// ─── 2. Saneo de NO_PREFERENCE + cableado del eje en QUALIFYING_STAFF ─────────

test('eje (a): "qué barberos hay" → SHOWING_SLOTS con presentBy=staff (no auto-asigna mudo)', async () => {
  const ctx: LifestyleBotContext = { serviceId: SVC };
  const r = await handleQualifyingStaff(makeMsg('qué barberos hay'), ctx, makeDeps());
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.presentBy, 'staff');
  assert.equal(r.newContext.autoAssign, true);
  assert.equal(r.newContext.staffId, undefined);
});

test('saneo: "¿qué barbero está disponible para las 12?" → eje (b) staff, NO no-preferencia', async () => {
  const ctx: LifestyleBotContext = { serviceId: SVC };
  const r = await handleQualifyingStaff(makeMsg('¿qué barbero está disponible para las 12?'), ctx, makeDeps());
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.presentBy, 'staff'); // antes: 'disponible' → auto-asigna mudo
});

test('CRÍTICO regresión (c): "cualquiera" sigue byte-idéntico (auto-asigna, SIN presentBy)', async () => {
  const ctx: LifestyleBotContext = { serviceId: SVC };
  const r = await handleQualifyingStaff(makeMsg('cualquiera'), ctx, makeDeps());
  assert.equal(r.newState, 'QUALIFYING_DATETIME'); // sin requestedDate → pide fecha
  assert.equal(r.newContext.autoAssign, true);
  assert.equal(r.newContext.presentBy, undefined); // NO se setea en el camino (c)
});

// ─── 3. Presentación por barbero en SHOWING_SLOTS ────────────────────────────

test('presentBy=staff: muestra el nombre de cada barbero (no los suprime), aun compartiendo hora', async () => {
  const ctx: LifestyleBotContext = {
    serviceId:     SVC,
    requestedDate: DATE,
    autoAssign:    true,
    presentBy:     'staff',
  };
  const r = await handleShowingSlots(makeMsg(''), ctx, makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // Conserva a AMBOS barberos (no se dedup por hora) y los nombra.
  assert.equal(r.newContext.pendingSlots?.length, 2);
  assert.match(r.responseText, /Carlos/);
  assert.match(r.responseText, /Andres/);
});

test('default (presentBy ausente): autoAssign día completo → muestra honesta de amplitud (NO slot único)', async () => {
  // HONESTIDAD UNIVERSAL (smoke R4.2): antes el dedup por barbero+hora colapsaba el día
  // completo (ambos 10–20) a 1 slot ("las 10") y escondía la tarde → perdía citas. Ahora
  // la unión por HORA muestra la amplitud real, SIN nombres (presentBy ausente → el cliente
  // elige HORA, no barbero). R3 (slot único negociable) queda ACOTADO al caso de UNA sola
  // hora libre (cubierto en r3Negotiable.test.ts).
  const ctx: LifestyleBotContext = {
    serviceId:     SVC,
    requestedDate: DATE,
    autoAssign:    true,
  };
  const r = await handleShowingSlots(makeMsg(''), ctx, makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.ok((r.newContext.pendingSlots?.length ?? 0) > 1, 'varias horas, no colapsa a 1');
  assert.match(r.responseText, /desde temprano hasta la noche/i, 'amplitud honesta');
  assert.doesNotMatch(r.responseText, /¿te sirve o preferis otra hora\?/i, 'ya no es la propuesta de slot único');
  assert.doesNotMatch(r.responseText, /Carlos|Andres/, 'presentBy ausente → sin nombres de barbero');
});

// ─── 4. Guard de interrogación (ask_who) en routeSlotSelection ───────────────

function pslot(index: number, localHHMM: string, staffId: string, staffName: string): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + 30 * 60_000);
  return { index, staffId, staffName, startsAt: start.toISOString(), endsAt: end.toISOString() };
}

const SLOTS = [pslot(1, '10:00', CARLOS, 'Carlos'), pslot(2, '12:00', ANDRES, 'Andres')];

function route(body: string): SelectionRoute {
  return routeSlotSelection(body, SLOTS, NOW, TZ);
}

test('ask_who: "a las 12" (sin pregunta) → select (NO ask_who)', () => {
  assert.equal(route('a las 12').action, 'select');
});

test('ask_who: "no, a las 6" → corrección consumida por el matcher (offer_nearest, NO ask_who)', () => {
  assert.equal(route('no, a las 6').action, 'offer_nearest');
});

test('ask_who: "¿a las 6?" (duda sin token de barbero) → NO ask_who', () => {
  const r = route('¿a las 6?');
  assert.notEqual(r.action, 'ask_who'); // cae al matcher (offer_nearest)
});

test('ask_who: "¿a las 12 con quién?" → ask_who', () => {
  assert.equal(route('¿a las 12 con quién?').action, 'ask_who');
});

test('ask_who: "¿qué barbero?" → ask_who', () => {
  assert.equal(route('¿qué barbero?').action, 'ask_who');
});

test('ask_who: nombre concreto con interrogación "¿con Andres?" → ask_who (re-presentación A1)', () => {
  assert.equal(route('¿con Andres?').action, 'ask_who');
});
