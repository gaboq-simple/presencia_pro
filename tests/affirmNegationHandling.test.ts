// FIX-AFFIRM-NEGATION — Tests de aceptación/negación en CONFIRMING_APPOINTMENT.
// Cubre:
//   Pieza 1: aceptación normalizada (bug del acento), afirmaciones coloquiales,
//            tokens cortos SOLO como mensaje completo (no embebidos).
//   Pieza 2: negación downstream del router — "no, a las 6" es corrección (la
//            consume el matcher natural), NO entra a la rama de negación.
//   Pieza 3: progresión escalonada de rechazo A→B→C→humano con contador
//            rejection_attempts separado, y reset ante avance.
// Regresión: selección directa + offer_nearest (S5-BOT-01/02) intactos.
//
// Deterministas: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleConfirmingAppointment,
  routeSlotSelection,
} from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
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

function baseContext(pendingSlots: LifestylePendingSlot[]): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF, autoAssign: false, requestedDate: DATE, pendingSlots };
}

const AFTERNOON = [pslot(1, '16:45'), pslot(2, '17:00'), pslot(3, '17:15')];
const MORNING   = [pslot(1, '10:00'), pslot(2, '10:15'), pslot(3, '10:30')];

function handle(body: string, ctx: LifestyleBotContext, deps: never) {
  return handleConfirmingAppointment(makeMsg(body), ctx, deps);
}

// Contexto con una oferta pendiente concreta (nearestOfferSlot = 17:00).
function offerCtx(): LifestyleBotContext {
  return { ...baseContext(AFTERNOON), nearestOfferSlot: localISO('17:00') };
}

// ─── Pieza 1: aceptación normalizada ──────────────────────────────────────────

test('Pieza1: "sí" con acento acepta la oferta (bug original del \\b)', async () => {
  const r = await handle('sí', offerCtx(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

for (const word of [
  'dale', 'va', 'ok', 'okay', 'sale', 'vale', 'claro', 'perfecto',
  'órale', 'me sirve', 'de acuerdo', 'simón', 'correcto', 'afirmativo',
]) {
  test(`Pieza1: afirmación coloquial "${word}" acepta la oferta`, async () => {
    const r = await handle(word, offerCtx(), makeDeps());
    assert.equal(r.newState, 'AWAITING_BOOKING_NAME', `"${word}" debería aceptar`);
    assert.equal(r.newContext.selectedSlot, localISO('17:00'));
  });
}

test('Pieza1: token corto embebido "¿va a estar?" NO acepta', async () => {
  const r = await handle('¿va a estar?', offerCtx(), makeDeps());
  assert.notEqual(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT'); // cae al clarify natural
});

test('Pieza1: token corto embebido "ok pero a otra hora" NO auto-acepta', async () => {
  // "ok pero a otra hora" no es mensaje completo "ok" → no acepta la oferta.
  const r = await handle('ok pero a otra hora', offerCtx(), makeDeps());
  assert.notEqual(r.newState, 'AWAITING_BOOKING_NAME');
});

// ─── Pieza 2: negación downstream del router ──────────────────────────────────

test('Pieza2 (router): "no, a las 6" → offer_nearest (corrección, NO negación)', () => {
  const r = routeSlotSelection('no, a las 6', AFTERNOON, NOW, TZ);
  assert.equal(r.action, 'offer_nearest');
});

test('Pieza2 (router): "no, mejor las 7" → offer_nearest (corrección)', () => {
  const r = routeSlotSelection('no, mejor las 7', AFTERNOON, NOW, TZ);
  assert.equal(r.action, 'offer_nearest');
});

test('Pieza2 (router): "no" solo → none (negación la maneja el handler)', () => {
  assert.equal(routeSlotSelection('no', AFTERNOON, NOW, TZ).action, 'none');
});

test('Pieza2 (regresión crítica): "no, a las 6" NO entra a la rama de negación', async () => {
  // Con slots de la mañana, 6 no está disponible → offer_nearest, NO rechazo.
  const r = await handle('no, a las 6', baseContext(MORNING), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // offer_nearest resetea rejection_attempts a 0 (avance/corrección), no lo sube.
  assert.equal(r.newContext.rejection_attempts, 0);
  assert.notEqual(r.newContext.nearestOfferSlot, null); // hubo oferta real
});

// ─── Pieza 3: progresión escalonada de rechazo ────────────────────────────────

test('Pieza3: "no" solo dispara A (reconoce + re-ofrece alternativas del día)', async () => {
  const r = await handle('no', offerCtx(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.rejection_attempts, 1);
  assert.match(r.responseText, /sin problema/i);          // reconoce el "no"
  assert.match(r.responseText, /4:45|5:15/);              // alternativas (excluye 17:00)
  assert.equal(r.newContext.nearestOfferSlot, null);      // limpia la oferta única
});

test('Pieza3: "no"→"no"→"no" progresa A→B→C', async () => {
  const deps = makeDeps();
  const a = await handle('no', offerCtx(), deps);
  assert.equal(a.newContext.rejection_attempts, 1);
  assert.match(a.responseText, /sin problema/i);

  const b = await handle('no', a.newContext, deps);
  assert.equal(b.newContext.rejection_attempts, 2);
  assert.match(b.responseText, /entiendo/i);
  assert.match(b.responseText, /hora/i);

  const c = await handle('no', b.newContext, deps);
  assert.equal(c.newContext.rejection_attempts, 3);
  assert.match(c.responseText, /otro dia|particular/i);   // cambio de eje
  assert.equal(c.newState, 'CONFIRMING_APPOINTMENT');
});

test('Pieza3: cuarto "no" deriva a humano (ESCALATED)', async () => {
  const ctx = { ...baseContext(AFTERNOON), rejection_attempts: 3 };
  const r = await handle('no', ctx, makeDeps());
  assert.equal(r.newState, 'ESCALATED');
  assert.equal(r.newContext.rejection_attempts, 0);
  assert.match(r.responseText, /equipo/i);
});

test('Pieza3: "no"→"a las 4"(avanza)→"no" RESETEA a A (no salta a B)', async () => {
  const deps = makeDeps();
  const a = await handle('no', baseContext(MORNING), deps);
  assert.equal(a.newContext.rejection_attempts, 1);

  // "a las 4" → 16:00 (no mostrado) → offer_nearest, resetea rejection a 0.
  const adv = await handle('a las 4', a.newContext, deps);
  assert.equal(adv.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(adv.newContext.rejection_attempts, 0);

  // Siguiente "no" debe volver a A (rej 0→1), NO saltar a B.
  const a2 = await handle('no', adv.newContext, deps);
  assert.equal(a2.newContext.rejection_attempts, 1);
  assert.match(a2.responseText, /sin problema/i);
});

test('Pieza3: negaciones claras "nel" / "no gracias" disparan A', async () => {
  const r1 = await handle('nel', offerCtx(), makeDeps());
  assert.equal(r1.newContext.rejection_attempts, 1);
  const r2 = await handle('no gracias', offerCtx(), makeDeps());
  assert.equal(r2.newContext.rejection_attempts, 1);
});

test('Pieza3: negación implícita "asi esta bien gracias" NO se fuerza a rechazo', async () => {
  const r = await handle('asi esta bien gracias', baseContext(MORNING), makeDeps());
  // No es rechazo claro → cae al clarify natural, rejection_attempts no sube.
  assert.notEqual(r.newContext.rejection_attempts, 1);
});

// ─── Regresión: selección directa y offer_nearest intactos (S5-BOT-01/02) ─────

test('regresión: selección directa "5 de la tarde" avanza a AWAITING_BOOKING_NAME', async () => {
  const r = await handle('5 de la tarde', baseContext(AFTERNOON), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('17:00'));
});

test('regresión: aceptar oferta con "sí" tras offer_nearest agenda el slot', async () => {
  const deps = makeDeps();
  const offer  = await handle('a las 4', baseContext(MORNING), deps); // → ofrece 16:00
  assert.equal(offer.newContext.nearestOfferSlot, localISO('16:00'));
  const accept = await handle('sí', offer.newContext, deps);
  assert.equal(accept.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(accept.newContext.selectedSlot, localISO('16:00'));
});
