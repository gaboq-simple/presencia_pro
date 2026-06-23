// ─── Guarda de prioridad: flujo conversacional vs. confirmación pasiva ────────
// Bug de confianza del smoke R3: el "sí" con que el cliente ACEPTA un slot
// negociado (CONFIRMING_APPOINTMENT) lo interceptaba `handleConfirmationResponse`
// (router.ts, ANTES del switch — handler pasivo de recordatorios). Si el cliente
// tenía una cita confirmada/pending en las próximas 3h, el pasivo clasificaba el
// "sí" como confirmación de ESE recordatorio y respondía "te esperamos a las 10"
// en vez de agendar el slot negociado de las 17:00. Dice 5pm, agenda 10.
//
// El fix (router.ts): si el state es de flujo activo (ACTIVE_FLOW_STATES, los 8
// mid-flow), NO llamar al pasivo — el flujo SIEMPRE gana. El pasivo sigue
// interviniendo en reposo (GREETING/CONFIRMED/terminales), que es su caso real.
//
// CLAVE: el bug vive en el ROUTER, no en un handler de estado. Por eso estos
// tests van por `dispatch()` (no llaman a los handlers directo como r3Negotiable).
// El pasivo solo dispara si hay fila `customers` + cita próxima en el fake, así
// que ambos se siembran. El "sí" suelto cae al clasificador del pasivo, así que
// se inyecta un classifier mock que devuelve CONFIRM_YES — espeja producción,
// donde el LLM clasifica el "sí" (con key vacía no reproduciría).
//
// Deterministas: Supabase fake (sin red), classifier mockeado. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';                  // UTC-6 fijo (MX sin DST)
const NOW    = new Date('2026-07-06T15:00:00.000Z');   // lunes ~09:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const CUST   = '99999999-9999-9999-9999-999999999999';

// Slot NEGOCIADO que el cliente acepta con "sí" (17:00 local MX = 23:00 UTC).
const SLOT_17     = '2026-07-06T23:00:00.000Z';
const SLOT_17_END = '2026-07-06T23:30:00.000Z';
// Cita PRÓXIMA preexistente que el pasivo confunde (10:00 local = 16:00 UTC,
// dentro de las 3h desde NOW).
const APPT_10 = '2026-07-06T16:00:00.000Z';

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────
// Soporta lo que toca el pasivo: customers/appointments query (.in/.gte/.lte/
// .order/.limit/.maybeSingle), .update (confirmar), .insert (bot_logs best-effort).

type TableData = Record<string, unknown[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const rows = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      insert: () => builder, update: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  // rpc: el pasivo solo lo usa en late-arrival, que estos casos no ejercitan.
  return { from, rpc: async () => ({ data: null, error: null }) } as never;
}

// Classifier mock: el pasivo manda el "sí" suelto al clasificador → CONFIRM_YES
// alto, como haría el LLM en producción. classifyMultiIntent inerte (no se usa
// en estos caminos, pero se provee por completitud del tipo ClassifierFns).
function makeYesClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => ({
      intent: 'CONFIRM_YES', confidence: 0.95, value: null, side_question_answer: null,
    }),
  };
}

let bizCounter = 0;
function makeDeps() {
  bizCounter += 1;
  const business = {
    id:                    `biz-pcg-${bizCounter}`, // único por test → aísla cache de catálogo
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
  // El cliente EXISTE y tiene una cita próxima de las 10:00 → el pasivo se activa.
  const tablesData: TableData = {
    customers:    [{ id: CUST }],
    appointments: [{
      id:         'appt-10',
      starts_at:  APPT_10,
      staff:      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
      service:    { name: 'Corte' },
      customer:   { id: CUST, name: 'Juan' },
    }],
    services:     [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    bot_logs:     [],
  };
  return {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeYesClassifier(),
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.pcg-test',
  } as never;
}

// Contexto de un cliente MID-NEGOCIACIÓN: un solo slot propuesto (17:00) en
// pendingSlots, sin nearestOfferSlot → el "sí" cae en el P1 de confirming.
function negotiatingCtx(): LifestyleBotContext {
  return {
    serviceId:    SVC,
    pendingSlots: [{ index: 1, staffId: CARLOS, staffName: 'Carlos', startsAt: SLOT_17, endsAt: SLOT_17_END }],
  };
}

// ─── 1. REPRO del bug ─────────────────────────────────────────────────────────
// Mid-negociación (CONFIRMING, slot 17:00) + cita próxima de 10:00 + "sí" →
// debe agendar el slot NEGOCIADO (17:00, AWAITING_BOOKING_NAME), NO confirmar la
// cita de las 10:00. SIN la guarda este test FALLA (el pasivo gana → CONFIRMED,
// selectedSlot undefined, "te esperamos a las 10"). Es la prueba de que reproduce.

test('REPRO: "sí" tras negociar 17:00 agenda el slot negociado, no confirma la cita de las 10:00', async () => {
  const r = await dispatch('CONFIRMING_APPOINTMENT', makeMsg('sí'), negotiatingCtx(), makeDeps());

  // El flujo gana: avanza a nombre con el slot negociado de las 17:00.
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, SLOT_17);
  // Y NO responde con la hora de la cita preexistente (el síntoma "dice 5pm, agenda 10").
  assert.doesNotMatch(r.responseText, /a las 10/i);
});

// ─── 2. NO-REGRESIÓN del recordatorio ─────────────────────────────────────────
// Cliente EN REPOSO (GREETING, sin flujo activo) con cita próxima + "sí" → el
// pasivo SIGUE confirmando el recordatorio. La guarda no toca GREETING, así que
// este test pasa igual antes y después del fix (no rompimos el recordatorio).

test('NO-REGRESIÓN: "sí" en reposo (GREETING) con cita próxima → el pasivo confirma el recordatorio', async () => {
  const r = await dispatch('GREETING', makeMsg('sí'), {}, makeDeps());

  // El pasivo intervino y confirmó la cita del recordatorio.
  assert.equal(r.newState, 'CONFIRMED');
  assert.match(r.responseText, /te esperamos/i);
});
