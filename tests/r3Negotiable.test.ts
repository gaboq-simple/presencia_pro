// R3 — Propuesta negociable de slot único (autoAssign).
// Antes: autoAssign + 1 hora única → salto directo a AWAITING_BOOKING_NAME
// (auto-confirmaba el slot y cerraba la puerta a "preferís otra hora").
// Ahora: se PROPONE el slot manteniéndolo en pendingSlots y se va a
// CONFIRMING_APPOINTMENT con frase negociable. Un "sí" avanza a nombre en UN
// paso (handler P1 de confirmingAppointment); una hora distinta rutea a
// offer_nearest.
//
// Deterministas: Supabase fake (sin red), Anthropic con key vacía (cae al
// fallback determinista). Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
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

function availRow(staffId: string, start: string, end: string) {
  return { staff_id: staffId, day_of_week: DOW, start_time: start, end_time: end, break_start: null, break_end: null };
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

// Por defecto: ambos barberos 10:00–20:00 → mismo slot más temprano (10:00) →
// tras dedup por hora queda UN solo slot único (el caso de la propuesta).
const BOTH_10_20 = [availRow(CARLOS, '10:00:00', '20:00:00'), availRow(ANDRES, '10:00:00', '20:00:00')];

function tables(avail: unknown[]): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [CARLOS_ROW, ANDRES_ROW],
    staff_availability:        avail,
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
  };
}

let bizCounter = 0;
function makeDeps(avail: unknown[] = BOTH_10_20) {
  bizCounter += 1;
  const business = {
    id:                    `biz-r3-${bizCounter}`, // único por test → aísla cache de catálogo
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
  return { business, supabase: makeSupabase(tables(avail)), anthropicKey: '', model: 'haiku' } as never;
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

const AUTO_CTX: LifestyleBotContext = { serviceId: SVC, requestedDate: DATE, autoAssign: true };

// ─── 1. "el que sea" + 1 slot único → propone negociable (no auto-confirma) ───

test('1 slot único autoAssign → propuesta negociable en CONFIRMING (no salta a nombre)', async () => {
  const r = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, makeDeps());

  // No auto-confirma: se queda en CONFIRMING con el slot conservado en pendingSlots.
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.pendingSlots?.length, 1);
  // Frase negociable, no "te asigno" ni pedir nombre.
  assert.match(r.responseText, /¿te sirve o preferis otra hora\?/i);
  assert.doesNotMatch(r.responseText, /te asigno/i);
  assert.doesNotMatch(r.responseText, /nombre/i);
  // No setea las banderas del cierre todavía (eso ocurre al aceptar).
  assert.equal(r.newContext.selectedSlot, undefined);
  assert.equal(r.newContext.pendingBookingName, undefined);
});

// ─── 2. Tras la propuesta, una hora distinta ("7pm") → ofrece la más cercana ──

test('tras propuesta, "7pm" → offer_nearest re-consulta y ofrece cercana (no repite)', async () => {
  const deps     = makeDeps();
  const proposal = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);
  assert.equal(proposal.newState, 'CONFIRMING_APPOINTMENT');

  const r = await handleConfirmingAppointment(makeMsg('7pm'), proposal.newContext, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // Re-consultó disponibilidad real del día y ofrece el slot de las 19:00.
  assert.equal(r.newContext.nearestOfferSlot, localISO('19:00'));
  assert.equal(r.newContext.pendingSlots?.[0]?.startsAt, localISO('19:00'));
  // Es una oferta a la espera de "sí", no la propuesta original de las 10:00.
  assert.match(r.responseText, /agendo|cercano/i);
  assert.doesNotMatch(r.responseText, /a las 10/i);
});

// ─── 3. Tras la propuesta, "sí" → avanza a nombre en UN paso (fluidez) ────────

test('tras propuesta, "sí" → AWAITING_BOOKING_NAME con el slot (un solo paso)', async () => {
  const deps     = makeDeps();
  const proposal = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);

  const r = await handleConfirmingAppointment(makeMsg('sí'), proposal.newContext, deps);

  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('10:00'));
});

// ─── 4. "el que sea" con varias horas → lista en CONFIRMING (sin regresión) ───

test('varios slots autoAssign → presenta lista (sin propuesta negociable de slot único)', async () => {
  // Carlos más temprano 10:00, Andres más temprano 12:00 → 2 horas distintas.
  const deps = makeDeps([availRow(CARLOS, '10:00:00', '20:00:00'), availRow(ANDRES, '12:00:00', '20:00:00')]);
  const r    = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.pendingSlots?.length, 2);
  // Camino de lista: NO usa la frase de propuesta de slot único.
  assert.doesNotMatch(r.responseText, /preferis otra hora/i);
});
