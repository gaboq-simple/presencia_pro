// ─── AUD-07e: memoria conversacional ──────────────────────────────────────────
// 4 fricciones de "bot sordo/desmemoriado":
//   1. Waitlist deja de ser el estado más frágil: "mejor el viernes" como
//      respuesta a la oferta ya no va a FALLBACK (parsea la fecha y busca
//      horarios de ESE día en el mismo turno); lo ambiguo gana UN clarify.
//   2. Reset >24h reconoce el contexto previo ("quedamos a medias con tu cita
//      de X") en vez de saludar como si nada.
//   3. Cliente recurrente: si el perfil de WA no sirve, el nombre ya registrado
//      (customers.name) se pre-llena — no se re-pregunta en cada reserva.
//   4. "gracias" tras una side-question contestada no dispara el fast-path de
//      venta ("Perfecto, Corte…" al que solo dio las gracias).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { handleQualifyingWaitlist } from '../packages/engine/src/bot/lifestyle/states/waitlist';
import { handleLifestyleMessage } from '../packages/engine/src/bot/lifestyle/handler';
import { buildBookingNameQuestion } from '../packages/engine/src/bot/lifestyle/utils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';
import { interpret } from '../packages/engine/src/bot/lifestyle/interpreter';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');   // lunes 12:00 local
const SVC    = '22222222-2222-4222-8222-222222222222';
const CARLOS = '11111111-1111-4111-8111-111111111111';
const CUST   = '99999999-9999-4999-8999-999999999999';
const PHONE  = '5215500000000';

// ─── Fake Supabase (filtrado real + grabadora) ───────────────────────────────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;
type Write = { table: string; payload: Row };

function makeSupabase(tablesData: TableData, writes: Write[] = []) {
  const from = (table: string) => {
    let rows = [...(tablesData[table] ?? [])];
    const filter = (col: string, pass: (a: unknown) => boolean) => {
      rows = rows.filter((r) => (col in r ? pass(r[col]) : true));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:  (c: string, v: unknown) => { filter(c, (a) => a === v); return builder; },
      gt:  (c: string, v: unknown) => { filter(c, (a) => (a as string) >  (v as string)); return builder; },
      gte: (c: string, v: unknown) => { filter(c, (a) => (a as string) >= (v as string)); return builder; },
      lt:  (c: string, v: unknown) => { filter(c, (a) => (a as string) <  (v as string)); return builder; },
      lte: (c: string, v: unknown) => { filter(c, (a) => (a as string) <= (v as string)); return builder; },
      in: () => builder, neq: () => builder, not: () => builder, order: () => builder,
      limit: (n: number) => { rows = rows.slice(0, n); return builder; },
      upsert: (payload: Row) => { writes.push({ table, payload }); return builder; },
      insert: (payload: Row) => { writes.push({ table, payload }); return builder; },
      update: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as never;
}

const REAL_UNCLEAR: IntentClassification = {
  intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
};

function makeClassifier(multi?: MultiIntentClassification) {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => multi ?? ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => REAL_UNCLEAR,
  };
}

let bizCounter = 0;
function makeSetup(opts?: { conversationRow?: Row; multi?: MultiIntentClassification }) {
  bizCounter += 1;
  const bizId = `biz-mem-${bizCounter}`;
  const business = {
    id:                    bizId,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'No te entendí bien.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  const writes: Write[] = [];
  const tablesData: TableData = {
    bot_conversations: opts?.conversationRow ? [{ business_id: bizId, ...opts.conversationRow }] : [],
    customers:    [{ id: CUST, business_id: bizId, phone: PHONE, name: 'Juan', favorite_staff_id: null, favorite_service_id: null, last_visit: null, favorite_staff: null, favorite_service: null }],
    appointments: [],
    staff:        [{ id: CARLOS, business_id: bizId, name: 'Carlos', role: 'barber', active: true, whatsapp_id: '5210000000001' }],
    staff_services: [{ staff_id: CARLOS, service_id: SVC }],
    services:     [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs:     [],
  };
  const deps = {
    business,
    supabase:     makeSupabase(tablesData, writes),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeClassifier(opts?.multi),
  } as never;
  return { business, bizId, deps, writes, supabase: makeSupabase(tablesData, writes) };
}

function makeMsg(body: string, bizId = 'biz'): never {
  return {
    businessId:    bizId,
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.mem-nuevo',
  } as never;
}

// deps directos para el handler de waitlist (unit) con interpretation inyectada.
function waitlistDeps(base: { deps: never }, body: string): never {
  const d = base.deps as Record<string, unknown>;
  return {
    ...d,
    interpretation: interpret({ message: body, now: NOW, timezone: TZ }),
  } as never;
}

const WAITLIST_CTX: LifestyleBotContext = {
  customerId:    CUST,
  serviceId:     SVC,
  requestedDate: '2026-07-21',
};

// ─── 1a. Waitlist: "mejor el viernes" busca horarios de ESE día ──────────────

test('waitlist + "mejor el viernes" → SHOWING_SLOTS con esa fecha (antes: FALLBACK)', async () => {
  const setup = makeSetup();
  const r = await handleQualifyingWaitlist(
    makeMsg('mejor el viernes', setup.bizId),
    WAITLIST_CTX,
    waitlistDeps(setup, 'mejor el viernes'),
  );

  assert.equal(r.newState, 'SHOWING_SLOTS');
  assert.equal(r.newContext.requestedDate, '2026-07-24');   // viernes
  assert.notEqual(r.responseText, 'No te entendí bien.');
});

// ─── 1b. Waitlist: lo ambiguo gana UN clarify antes de FALLBACK ──────────────

test('waitlist + mensaje ambiguo → 1 clarify; al 2º sí cae a FALLBACK', async () => {
  const setup = makeSetup();
  const r1 = await handleQualifyingWaitlist(
    makeMsg('mmm dejame ver', setup.bizId), WAITLIST_CTX, waitlistDeps(setup, 'mmm dejame ver'),
  );
  assert.equal(r1.newState, 'QUALIFYING_WAITLIST');
  assert.match(r1.responseText, /Te anoto en la lista de espera/);
  assert.equal(r1.newContext.clarification_attempts, 1);

  const r2 = await handleQualifyingWaitlist(
    makeMsg('este pues', setup.bizId), r1.newContext, waitlistDeps(setup, 'este pues'),
  );
  assert.equal(r2.newState, 'FALLBACK');
});

// ─── 2. Reset >24h reconoce el agendamiento que quedó a medias ───────────────

test('reset >24h con serviceId previo → preámbulo "quedamos a medias con tu cita"', async () => {
  const { business, bizId, supabase } = makeSetup({
    conversationRow: {
      id:              'conv-1',
      customer_phone:  PHONE,
      state:           'QUALIFYING_DATETIME',
      context:         { customerId: CUST, serviceId: SVC },
      last_message:    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),  // hace 25h
      last_message_id: 'wamid.previo',
    },
  });
  const r = await handleLifestyleMessage({
    msg: makeMsg('hola', bizId), business: business as never, supabase, anthropicKey: '',
  });

  assert.match(r.message, /quedamos a medias con tu cita de Corte de cabello/);
});

test('reset >24h SIN reserva a medias → saludo normal sin preámbulo', async () => {
  const { business, bizId, supabase } = makeSetup({
    conversationRow: {
      id:              'conv-1',
      customer_phone:  PHONE,
      state:           'GREETING',
      context:         { customerId: CUST },
      last_message:    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      last_message_id: 'wamid.previo',
    },
  });
  const r = await handleLifestyleMessage({
    msg: makeMsg('hola', bizId), business: business as never, supabase, anthropicKey: '',
  });

  assert.doesNotMatch(r.message, /quedamos a medias/);
});

// ─── 3. Nombre del recurrente pre-llenado desde customers.name ───────────────

test('buildBookingNameQuestion: perfil WA inservible + nombre registrado → pre-llena', () => {
  const r = buildBookingNameQuestion(null, 'Juan');
  assert.equal(r.pendingBookingName, 'Juan');
  assert.match(r.nameQuestion, /a nombre de Juan, como la vez pasada/);

  // Perfil con emoji (apodo de WA) también cae al nombre registrado.
  const r2 = buildBookingNameQuestion('🔥💈', 'Juan');
  assert.equal(r2.pendingBookingName, 'Juan');

  // Sin nada → pregunta directa (comportamiento histórico).
  const r3 = buildBookingNameQuestion(null, null);
  assert.equal(r3.pendingBookingName, null);
  assert.match(r3.nameQuestion, /¿A nombre de quién queda la cita\?/);

  // El perfil real de WA sigue teniendo prioridad.
  const r4 = buildBookingNameQuestion('Juan Pérez', 'Otro');
  assert.equal(r4.pendingBookingName, 'Juan Pérez');
});

// ─── 4. Cortesía tras side-question contestada ≠ intención de reserva ────────

test('"gracias" tras side-question contestada → cierre cálido, no venta', async () => {
  const { deps } = makeSetup();
  const ctx: LifestyleBotContext = { customerId: CUST, last_side_question: '¿dónde están?' };
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('gracias'), ctx, deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /Con gusto/);
  assert.doesNotMatch(r.responseText, /Perfecto|barbero/);
});

test('"sí" SIN side-question previa sigue avanzando (S4-BOT-09 intacto)', async () => {
  const { deps } = makeSetup();
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('sí'), {}, deps);

  assert.notEqual(r.newState, 'GREETING');
  assert.doesNotMatch(r.responseText, /Con gusto! Aquí ando/);
});
