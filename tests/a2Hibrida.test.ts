// S5-BOT-05 (A2) — Respuesta híbrida al caso ambiguo + follow-up.
// La capa conversacional multi-barbero: ante "¿con quién?" el bot RESPONDE
// (quién atiende la hora preguntada / el barbero nombrado) y ofrece el otro eje
// sin forzar; el follow-up ("sí" / "sí con Andrés" / "mejor Carlos" / "no") se
// rutea sin re-disparar el matcher ávido ni cruzar los contadores de S5-BOT-03.
// Incluye el residual de 08b: conmutación REAL de barbero en el cierre.
//
// Deterministas: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleConfirmingAppointment,
  routeSlotSelection,
} from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { handleAwaitingBookingName } from '../packages/engine/src/bot/lifestyle/states/awaitingBookingName';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
const DATE   = '2026-06-15';          // lunes (DOW 1)
const DOW    = 1;
const NOW    = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';
const SVC    = '22222222-2222-2222-2222-222222222222';

// ─── Fake Supabase (patrón digitDisambiguation: builder encadenable) ─────────

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
      lte:    () => builder,
      gt:     () => builder,
      neq:    () => builder,
      not:    () => builder,
      order:  () => builder,
      limit:  () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

function tables(): TableData {
  return {
    services: [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff: [
      { id: ANDRES, name: 'Andrés', whatsapp_id: '5210000000002' },
      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
    ],
    staff_availability: [
      { staff_id: CARLOS, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null },
      { staff_id: ANDRES, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null },
    ],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
    customers:                 [],
  };
}

let bizCounter = 0;
function makeDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-a2-${bizCounter}`, // único por test → aísla caches de catálogo
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
  return { business, supabase: makeSupabase(tables()), anthropicKey: '' } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.a2-test',
  } as never;
}

function pslot(index: number, staffId: string, staffName: string, localHHMM: string): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + 30 * 60_000);
  return { index, staffId, staffName, startsAt: start.toISOString(), endsAt: end.toISOString() };
}

// Presentación con dos barberos: Carlos 12:00, Andrés 13:00.
const CARLOS_12 = pslot(1, CARLOS, 'Carlos', '12:00');
const ANDRES_13 = pslot(2, ANDRES, 'Andrés', '13:00');
const TWO_BARBERS = [CARLOS_12, ANDRES_13];

function baseContext(extra?: Partial<LifestyleBotContext>): LifestyleBotContext {
  return {
    serviceId:     SVC,
    autoAssign:    true,
    requestedDate: DATE,
    pendingSlots:  TWO_BARBERS,
    ...extra,
  };
}

function handle(body: string, ctx: LifestyleBotContext, deps: never) {
  return handleConfirmingAppointment(makeMsg(body), ctx, deps);
}

// ─── 1. Router: ask_who enriquecido (aditivo, la acción no cambia) ───────────

test('router: "¿a las 12 con quién?" → ask_who con la hora preguntada', () => {
  const r = routeSlotSelection('¿a las 12 con quién?', TWO_BARBERS, NOW, TZ);
  assert.equal(r.action, 'ask_who');
  assert.equal((r as { requestedMinutes?: number }).requestedMinutes, 12 * 60);
});

test('router: "¿Carlos a la 1?" → ask_who con barbero nombrado + hora (1pm por política AM/PM)', () => {
  const r = routeSlotSelection('¿Carlos a la 1?', TWO_BARBERS, NOW, TZ);
  assert.equal(r.action, 'ask_who');
  const rr = r as { requestedMinutes?: number; named?: { staffId: string } };
  assert.equal(rr.named?.staffId, CARLOS);
  assert.equal(rr.requestedMinutes, 13 * 60);
});

test('router: "¿qué barbero?" → ask_who sin hora ni nombre (retrocompatible)', () => {
  const r = routeSlotSelection('¿qué barbero?', TWO_BARBERS, NOW, TZ);
  assert.equal(r.action, 'ask_who');
  const rr = r as { requestedMinutes?: number; named?: unknown };
  assert.equal(rr.requestedMinutes, undefined);
  assert.equal(rr.named, undefined);
});

// ─── 2. Híbrida: "¿con quién?" responde + ofrece el otro eje ─────────────────

test('híbrida: "¿con quién sería?" nombra a ambos, deja el primero en oferta y NO toca rejection', async () => {
  const r = await handle('¿con quién sería?', baseContext({ rejection_attempts: 1 }), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /Carlos/);
  assert.match(r.responseText, /Andrés/);
  assert.match(r.responseText, /¿Te agendo con Carlos o prefieres cambiar\?/);
  assert.equal(r.newContext.nearestOfferSlot, CARLOS_12.startsAt);
  assert.equal(r.newContext.presentBy, 'staff');
  assert.equal(r.newContext.clarification_attempts, 0);
  assert.equal(r.newContext.rejection_attempts, 1); // frontera S5-BOT-03: intacto
});

test('híbrida centrada en hora: "¿a las 12 con quién?" responde quién atiende ESA hora', async () => {
  const r = await handle('¿a las 12 con quién?', baseContext(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /te atendería Carlos/);
  assert.match(r.responseText, /también está Andrés/);
  assert.equal(r.newContext.nearestOfferSlot, CARLOS_12.startsAt);
});

// ─── 3. Barbero-primero (hallazgos smoke A1): sin mezclar barberos ───────────

test('"¿Carlos a las 12?" (su hora está en la mesa) → respuesta directa SÍ, sin mencionar a Andrés', async () => {
  const r = await handle('¿Carlos a las 12?', baseContext(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /Sí, Carlos tiene la/);
  assert.doesNotMatch(r.responseText, /Andrés/);
  assert.equal(r.newContext.nearestOfferSlot, CARLOS_12.startsAt);
  assert.equal(r.newContext.requestedStaffId, CARLOS);
});

test('"¿Carlos a la 1?" (no está en la mesa) → re-consulta acotada a Carlos, respuesta directa con SU nombre', async () => {
  const r = await handle('¿Carlos a la 1?', baseContext(), makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // La disponibilidad real de Carlos ese día SÍ tiene la 1pm → "Sí, tengo…con Carlos".
  assert.match(r.responseText, /con Carlos/);
  assert.doesNotMatch(r.responseText, /Andrés/);
  assert.ok(r.newContext.nearestOfferSlot, 'la oferta queda pendiente de su "sí"');
  assert.equal(r.newContext.requestedStaffId, CARLOS);
});

// ─── 4. Follow-up de la híbrida ──────────────────────────────────────────────

test('follow-up "sí" acepta lo ofrecido (Carlos 12) → AWAITING_BOOKING_NAME', async () => {
  const hibrida = await handle('¿con quién sería?', baseContext(), makeDeps());
  const r = await handle('sí', hibrida.newContext, makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, CARLOS_12.startsAt);
  assert.equal(r.newContext.staffId, CARLOS);
});

test('follow-up "sí con Andrés" NO acepta lo ofrecido: confirma el slot de ANDRÉS', async () => {
  const hibrida = await handle('¿con quién sería?', baseContext(), makeDeps());
  const r = await handle('sí con Andrés', hibrida.newContext, makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, ANDRES_13.startsAt);
  assert.equal(r.newContext.staffId, ANDRES);
});

test('follow-up "mejor Andrés" → oferta directa del slot de Andrés (sin re-consultar)', async () => {
  const hibrida = await handle('¿con quién sería?', baseContext(), makeDeps());
  const r = await handle('mejor Andrés', hibrida.newContext, makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /Andrés te atendería a las 1 de la tarde/);
  assert.match(r.responseText, /¿Te la agendo\?/);
  assert.equal(r.newContext.nearestOfferSlot, ANDRES_13.startsAt);
  assert.equal(r.newContext.requestedStaffId, ANDRES);
});

test('follow-up "no" pelado → progresión de rechazo A (contadores sin cruzarse)', async () => {
  const hibrida = await handle('¿con quién sería?', baseContext(), makeDeps());
  const r = await handle('no', hibrida.newContext, makeDeps());
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.rejection_attempts, 1);
  assert.equal(r.newContext.clarification_attempts, 0);
  assert.match(r.responseText, /También tengo/); // A: re-ofrece la alternativa (Andrés 1pm)
});

// ─── 5. Residual 08b: conmutación real de barbero en el cierre ───────────────

function cierreContext(): LifestyleBotContext {
  return {
    serviceId:     SVC,
    staffId:       CARLOS,
    autoAssign:    false,
    requestedDate: DATE,
    pendingSlots:  [CARLOS_12],
    selectedSlot:  CARLOS_12.startsAt,
  };
}

test('cierre: "con Andrés" (NO ofrecido) → conmuta de verdad: SHOWING_SLOTS acotado a Andrés', async () => {
  const r = await handleAwaitingBookingName(makeMsg('con Andrés'), cierreContext(), makeDeps());
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.staffId, ANDRES);
  assert.equal(r.newContext.requestedStaffId, ANDRES);
  assert.equal(r.newContext.presentBy, 'staff');
  assert.equal(r.newContext.selectedSlot, undefined);
  assert.equal(r.newContext.pendingBookingName, null);
  // El nombre corrupto de 08b no puede volver: no se guardó booking name.
  assert.equal(r.newContext.bookingName, undefined);
});

test('cierre: "con el otro" con roster de 2 → conmuta al que no es', async () => {
  const r = await handleAwaitingBookingName(makeMsg('con el otro'), cierreContext(), makeDeps());
  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.staffId, ANDRES);
});

test('cierre: "con Carlos" (el MISMO barbero) → no conmuta; retoma el nombre', async () => {
  const r = await handleAwaitingBookingName(makeMsg('con Carlos'), cierreContext(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.match(r.responseText, /Tu cita ya es con Carlos/);
});

test('cierre: "con Rodolfo" (no existe) → copy honesto, sin corromper el nombre', async () => {
  const r = await handleAwaitingBookingName(makeMsg('con Rodolfo'), cierreContext(), makeDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.match(r.responseText, /No ubiqué/);
  assert.equal(r.newContext.bookingName, undefined);
});
