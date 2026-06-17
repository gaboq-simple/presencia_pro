// S5-BOT-07 — Desambiguación del dígito pelado ambiguo (handler-level).
// Cubre el ciclo completo: ask_hour (set de la bandera) → consumo del turno
// siguiente (sí → hora vía offer_nearest, no → índice, otra cosa → fall-through).
// Verifica la exclusión mutua con S5-BOT-03 (pendingDigitDisambig vs
// nearestOfferSlot) y que rejection_attempts NUNCA se cruza.
//
// Deterministas: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
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
function makeDeps() {
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

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

function pslot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + durMin * 60_000);
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}

// {12:00, 12:15, 12:30} — "1" como hora (1pm/13:00) cae a bestD=30 → en banda.
const NOON15 = [pslot(1, '12:00'), pslot(2, '12:15'), pslot(3, '12:30')];

function baseContext(pendingSlots: LifestylePendingSlot[]): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF, autoAssign: false, requestedDate: DATE, pendingSlots };
}

// Contexto con desambiguación pendiente (el bot ya preguntó "¿la 1pm?").
function disambigCtx(): LifestyleBotContext {
  return {
    ...baseContext(NOON15),
    pendingDigitDisambig: { requestedMinutes: 13 * 60, indexChoice: 1 },
    nearestOfferSlot:     null, // exclusión mutua: nunca activa junto a la bandera
  };
}

function handle(body: string, ctx: LifestyleBotContext, deps: never) {
  return handleConfirmingAppointment(makeMsg(body), ctx, deps);
}

// ─── Disparo: "1" ambiguo → ask_hour (set de la bandera) ──────────────────────

test('disparo: "1" ante {12:00,12:15,12:30} pregunta la hora y setea la bandera', async () => {
  const r = await handle('1', baseContext(NOON15), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /1 de la tarde/);           // copy: ¿Te refieres a la 1 de la tarde?
  assert.deepEqual(r.newContext.pendingDigitDisambig, { requestedMinutes: 780, indexChoice: 1 });
  assert.equal(r.newContext.nearestOfferSlot, null);       // CRÍTICO: exclusión mutua
});

// ─── Consumo: "sí" → la HORA (offer_nearest a la 1pm) ─────────────────────────

test('"sí" tras ask_hour → ofrece la 1pm (offer_nearest, reusa requery S5-BOT-02)', async () => {
  const r = await handle('sí', disambigCtx(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /1 de la tarde/);           // 13:00 disponible
  assert.match(r.responseText, /agendo/);                  // isExact → "Te la agendo?"
  assert.equal(r.newContext.nearestOfferSlot, localISO('13:00'));
  assert.equal(r.newContext.pendingDigitDisambig, null);   // bandera limpia
});

// ─── Consumo: "no" → el ÍNDICE (default conservador, 12:00) ───────────────────

test('"no" tras ask_hour → índice 1 (12:00), NO incrementa rejection_attempts', async () => {
  const r = await handle('no', disambigCtx(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');       // avanza (selección)
  assert.equal(r.newContext.selectedSlot, localISO('12:00'));
  assert.equal(r.newContext.rejection_attempts, 0);        // NO cruzar contadores
  assert.equal(r.newContext.pendingDigitDisambig, null);   // bandera limpia
});

// ─── Consumo: otra cosa → fall-through al ruteo normal ────────────────────────

test('"la primera" tras ask_hour → fall-through a parseOrdinal → 12:00', async () => {
  const r = await handle('la primera', disambigCtx(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('12:00'));
  assert.equal(r.newContext.pendingDigitDisambig, null);   // bandera limpia
});

test('"3pm" tras ask_hour → fall-through; el matcher consume la corrección', async () => {
  // "3pm" no es afirmación ni negación → limpia la bandera y cae al matcher.
  // 15:00 no está entre los pendingSlots {12:00,12:15,12:30} → offer_nearest.
  const r = await handle('3pm', disambigCtx(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.pendingDigitDisambig, null);   // bandera limpia
});
