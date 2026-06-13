// FIX-SLOT-AVAIL — Tests del fix de disponibilidad real del día.
// Cubre los dos bugs corregidos:
//   Bug 1 (rollover): findSlotsInNextDays reenvía requestedTime → el día
//     alternativo ofrece slots cercanos a la hora pedida, no los cronológicos.
//   Bug 2 (matcher ciego): la rama offer_nearest de CONFIRMING_APPOINTMENT
//     consulta la disponibilidad REAL del día (ambas direcciones) en vez de
//     solo los ≤3 pendingSlots mostrados. CRÍTICO: NO auto-confirma — presenta
//     la hora encontrada y espera "sí" explícito (anti Bug-B).
//
// Deterministas: Supabase fake (sin red), sin Anthropic (offer_nearest no llama
// al LLM). Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { findSlotsInNextDays } from '../packages/engine/src/bot/lifestyle/scheduling';
import { localTimeToUTC, noonUTCDate, utcToLocalMinutes } from '../packages/engine/src/bot/lifestyle/tzUtils';
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

function makeSupabase(tables: TableData) {
  const from = (table: string) => {
    const data = tables[table] ?? [];
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

function availRow(start: string, end: string) {
  return { staff_id: STAFF, day_of_week: DOW, start_time: start, end_time: end, break_start: null, break_end: null };
}

function appt(localStart: string, localEnd: string) {
  return {
    staff_id:  STAFF,
    starts_at: localTimeToUTC(DATE, localStart, TZ).toISOString(),
    ends_at:   localTimeToUTC(DATE, localEnd, TZ).toISOString(),
  };
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

function pslot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + durMin * 60_000);
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}

let bizCounter = 0;
function tables(appointments: unknown[] = []): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF_ROW],
    staff_availability:        [availRow('10:00:00', '20:00:00')],
    appointments:              appointments,
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF }],
  };
}

function makeDeps(appointments: unknown[] = []) {
  bizCounter += 1;
  const business = {
    id:                    `biz-${bizCounter}`, // único por test → aísla la cache del catálogo
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
  return { business, supabase: makeSupabase(tables(appointments)), anthropicKey: '', model: 'haiku' } as never;
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

function baseContext(pendingSlots: LifestylePendingSlot[]): LifestyleBotContext {
  return {
    serviceId:     SVC,
    staffId:       STAFF,
    autoAssign:    false,
    requestedDate: DATE,
    pendingSlots,
  };
}

// Slots mostrados por defecto: tres de la mañana (simula la presentación
// cronológica temprana que originaba el bug). Ninguno cae en la tarde.
const MORNING = [pslot(1, '10:00'), pslot(2, '10:15'), pslot(3, '10:30')];

// ─── Bug 2: hora pedida que SÍ existe en el día pero no estaba mostrada ───────

test('Bug2: "a las 4" — 16:00 libre (no mostrado) → ofrece 16:00 y ESPERA confirmación (no auto-agenda)', async () => {
  const deps = makeDeps([]); // sin citas → 16:00 libre
  const ctx  = baseContext(MORNING);

  const r = await handleConfirmingAppointment(makeMsg('a las 4'), ctx, deps);

  // No auto-confirma: sigue en CONFIRMING_APPOINTMENT, no salta a AWAITING_BOOKING_NAME.
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // pendingSlots reemplazados con la disponibilidad real; el más cercano = 16:00 exacto.
  assert.equal(r.newContext.pendingSlots![0]!.startsAt, localISO('16:00'));
  assert.equal(r.newContext.nearestOfferSlot, localISO('16:00'));
  // Mensaje de oferta con confirmación pendiente (anti Bug-B), no "agendada".
  assert.match(r.responseText, /agendo/i);
  assert.doesNotMatch(r.responseText, /lo mas cercano/i);
});

// ─── Bug 2: aceptación "sí" tras la oferta funciona ──────────────────────────

test('Bug2: aceptar con "sí" la hora ofrecida → AWAITING_BOOKING_NAME con ese slot', async () => {
  const deps = makeDeps([]);
  const ctx  = baseContext(MORNING);

  const offer = await handleConfirmingAppointment(makeMsg('a las 4'), ctx, deps);
  // El slot ofrecido vive en pendingSlots reemplazados → la rama AFFIRM lo recoge.
  const accept = await handleConfirmingAppointment(makeMsg('dale'), offer.newContext, deps);

  assert.equal(accept.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(accept.newContext.selectedSlot, localISO('16:00'));
});

// ─── Bug 2: hora NO disponible → ofrece la real más cercana (dirección ANTES) ─

test('Bug2: "5 de la tarde" con 17:00 ocupado → ofrece 16:30 real (antes), no un slot de la mañana', async () => {
  const deps = makeDeps([appt('17:00', '17:30')]); // 5pm ocupado
  const ctx  = baseContext(MORNING);

  // "5 de la tarde" fuerza PM (17:00); con slots de la mañana en pantalla,
  // "a las 5" a secas se desambiguaría a 5 AM (decisión f del router).
  const r = await handleConfirmingAppointment(makeMsg('5 de la tarde'), ctx, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.nearestOfferSlot, localISO('16:30'));
  assert.equal(r.newContext.pendingSlots![0]!.startsAt, localISO('16:30'));
  // El ofrecido NO es ninguno de los slots de la mañana mostrados (matcher real).
  const morningISOs = MORNING.map((s) => s.startsAt);
  assert.ok(!morningISOs.includes(r.newContext.nearestOfferSlot!));
  assert.match(r.responseText, /lo mas cercano/i);
});

// ─── Bug 2: hora NO disponible → ofrece la real más cercana (dirección DESPUÉS) ─

test('Bug2: "a las 12" con 11:00–13:00 ocupado → ofrece 13:00 real (después), no mostrado', async () => {
  const deps = makeDeps([appt('11:00', '13:00')]);
  const ctx  = baseContext(MORNING);

  const r = await handleConfirmingAppointment(makeMsg('a las 12'), ctx, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.nearestOfferSlot, localISO('13:00'));
  // 13:00 (después de las 12) no estaba entre los slots de la mañana mostrados.
  const morningISOs = MORNING.map((s) => s.startsAt);
  assert.ok(!morningISOs.includes(localISO('13:00')));
  assert.match(r.responseText, /lo mas cercano/i);
});

// ─── Regresión: selección directa entre los mostrados (S5-BOT-01, caso a/b) ───

test('regresión: "5 de la tarde" entre slots mostrados → AWAITING_BOOKING_NAME (select directo intacto)', async () => {
  const deps = makeDeps([]);
  const afternoon = [pslot(1, '16:45'), pslot(2, '17:00'), pslot(3, '17:15')];
  const ctx  = baseContext(afternoon);

  const r = await handleConfirmingAppointment(makeMsg('5 de la tarde'), ctx, deps);

  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

// ─── Bug 1: rollover reenvía requestedTime al día alternativo ─────────────────

test('Bug1: findSlotsInNextDays con requestedTime ofrece cerca de la hora pedida, no el más temprano', async () => {
  const supabase = makeSupabase(tables([])) as never;
  const baseOpts = {
    businessId:          'biz-rollover',
    serviceId:           SVC,
    durationMinutes:     30,
    walkInBufferMinutes: 60,
    staffToQuery:        [STAFF_ROW],
    supabase,
    tz:                  TZ,
  };
  const start = noonUTCDate(DATE); // lunes; busca a partir del día siguiente

  // Con requestedTime '17:00' → el slot del día alternativo más cercano a 17:00.
  const withTime = await findSlotsInNextDays(start, 5, { ...baseOpts, requestedTime: '17:00' });
  assert.ok(withTime, 'debe encontrar un día alternativo con disponibilidad');
  assert.equal(utcToLocalMinutes(withTime!.slots[0]!.startsAt, TZ), 17 * 60);

  // Sin requestedTime → el más temprano (10:00), comportamiento cronológico.
  const noTime = await findSlotsInNextDays(start, 5, baseOpts);
  assert.ok(noTime);
  assert.equal(utcToLocalMinutes(noTime!.slots[0]!.startsAt, TZ), 10 * 60);
});
