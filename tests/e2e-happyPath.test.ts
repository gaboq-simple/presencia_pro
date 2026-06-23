// R1 Pieza B — e2e happy-path del flujo de agendamiento.
//
// Recorre la costura completa GREETING → QUALIFYING_STAFF → QUALIFYING_DATETIME
// → SHOWING_SLOTS → CONFIRMING_APPOINTMENT → AWAITING_BOOKING_NAME → CONFIRMED
// a través del choke-point real `dispatch()`, encadenando newContext turno a
// turno como lo haría handler.ts. Afirma las transiciones de estado y que la
// reserva final quede poblada (serviceId / staffId / selectedSlot / bookingName
// / appointmentId).
//
// Determinista: Supabase fake (sin red) + classifier inyectado por lookup
// userMessage→clasificación (R1 Pieza A habilitó la inyección). Sin Anthropic:
// con anthropicKey='' los generadores caen a su fallback determinista.
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { weekdayFromDateStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestyleBotState } from '../packages/engine/src/types/lifestyle.types';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ  = 'America/Mexico_City';              // UTC-6 fijo (México sin DST)
const NOW = new Date('2026-07-06T15:00:00.000Z'); // lunes ~09:00 local

const SVC      = '22222222-2222-2222-2222-222222222222';
const CARLOS   = '11111111-1111-1111-1111-111111111111';
const ANDRES   = '33333333-3333-3333-3333-333333333333';

// "mañana" relativo a NOW → fecha y día de semana de la disponibilidad.
const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tables: TableData) {
  let seq = 0;
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    let inserted: { id: string } | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      gt:     () => builder,
      lt:     () => builder,
      lte:    () => builder,
      neq:    () => builder,
      not:    () => builder,
      order:  () => builder,
      limit:  () => builder,
      insert: () => { seq += 1; inserted = { id: `${table}-${seq}` }; return builder; },
      update: () => builder,
      single:      () => Promise.resolve({ data: inserted ?? rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function availRow(staffId: string) {
  return {
    staff_id: staffId, day_of_week: DOW,
    start_time: '10:00:00', end_time: '20:00:00',
    break_start: null, break_end: null,
  };
}

// customers vacío a propósito: greeting siempre trata al cliente como nuevo
// (RETURNING_CHECK → null → INSERT) y handleConfirmationResponse corta temprano
// (sin customer → null), de modo que el router normal procesa cada turno.
function tables(): TableData {
  return {
    customers: [],
    services: [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff: [
      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] },
      { id: ANDRES, name: 'Andrés', whatsapp_id: '5210000000002', staff_services: [{ service_id: SVC }] },
    ],
    staff_availability:        [availRow(CARLOS), availRow(ANDRES)],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS, service_id: SVC }, { staff_id: ANDRES, service_id: SVC }],
  };
}

// Classifier inyectado: solo el primer turno necesita multi-intent (servicio).
// El resto del flujo avanza por los fast-paths deterministas de cada handler.
function makeClassifier() {
  return {
    classifyMultiIntent: async ({ userMessage }: { userMessage: string }): Promise<MultiIntentClassification> => {
      if (userMessage === 'Quiero un corte de cabello') {
        return { serviceMatch: { value: 'Corte de cabello', confidence: 1 } };
      }
      return { unclear: true };
    },
    classifyIntent: async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}

function makeDeps() {
  const business = {
    id:                    `biz-e2e-${Date.now()}`, // único → aísla la cache del catálogo
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Zlot',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'Te comunico con el equipo.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  return {
    business,
    supabase:     makeSupabase(tables()),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeClassifier(),
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     `wamid.${body}`,
  } as never;
}

// ─── e2e ──────────────────────────────────────────────────────────────────────

test('happy-path: GREETING → … → CONFIRMED con la reserva poblada', async () => {
  const deps = makeDeps();

  // 1. GREETING: el cliente pide el servicio → QUALIFYING_STAFF.
  const r1 = await dispatch('GREETING', makeMsg('Quiero un corte de cabello'), {}, deps);
  assert.equal(r1.newState, 'QUALIFYING_STAFF' as LifestyleBotState);
  assert.equal(r1.newContext.serviceId, SVC);

  // 2. QUALIFYING_STAFF: elige a Carlos → QUALIFYING_DATETIME (sin fecha aún).
  const r2 = await dispatch('QUALIFYING_STAFF', makeMsg('Carlos'), r1.newContext, deps);
  assert.equal(r2.newState, 'QUALIFYING_DATETIME' as LifestyleBotState);
  assert.equal(r2.newContext.staffId, CARLOS);

  // 3. QUALIFYING_DATETIME: "mañana" → SHOWING_SLOTS. Carlos (barbero fijo) tiene
  //    slots en AMBAS franjas → disponibilidad honesta pregunta la franja binaria
  //    en vez de volcar 3 horarios a ciegas (no auto-confirma, no oculta opciones).
  const r3 = await dispatch('QUALIFYING_DATETIME', makeMsg('mañana'), r2.newContext, deps);
  assert.equal(r3.newState, 'SHOWING_SLOTS' as LifestyleBotState);
  assert.equal(r3.newContext.requestedDate, REQ_DATE);
  assert.equal(r3.newContext.pendingFranjaChoice, true, 'pregunta la franja (ambas con slots)');

  // 3b. SHOWING_SLOTS: la respuesta se parsea LOCAL ("en la tarde" = franja tarde,
  //     NO fecha) → presenta horarios de la tarde → CONFIRMING_APPOINTMENT.
  const r3b = await dispatch('SHOWING_SLOTS', makeMsg('en la tarde'), r3.newContext, deps);
  assert.equal(r3b.newState, 'CONFIRMING_APPOINTMENT' as LifestyleBotState);
  assert.ok((r3b.newContext.pendingSlots ?? []).length > 0, 'debe presentar al menos un slot');

  // 4. CONFIRMING_APPOINTMENT: "la primera" → AWAITING_BOOKING_NAME con el slot.
  const r4 = await dispatch('CONFIRMING_APPOINTMENT', makeMsg('la primera'), r3b.newContext, deps);
  assert.equal(r4.newState, 'AWAITING_BOOKING_NAME' as LifestyleBotState);
  assert.ok(r4.newContext.selectedSlot, 'el slot elegido debe quedar fijado');

  // 5. AWAITING_BOOKING_NAME: el nombre → CONFIRMED (encadena handleConfirmed,
  //    que crea la cita).
  const r5 = await dispatch('AWAITING_BOOKING_NAME', makeMsg('Gabriel'), r4.newContext, deps);
  assert.equal(r5.newState, 'CONFIRMED' as LifestyleBotState);

  // ── Reserva final poblada ──────────────────────────────────────────────────
  const final: LifestyleBotContext = r5.newContext;
  assert.equal(final.serviceId, SVC);
  assert.equal(final.staffId,   CARLOS);
  assert.ok(final.selectedSlot,  'selectedSlot poblado');
  assert.equal(final.bookingName, 'Gabriel');
  assert.ok(final.appointmentId, 'appointmentId poblado tras el INSERT');

  // El mensaje de confirmación final no debe ser vacío.
  assert.ok(r5.responseText.trim().length > 0);
});
