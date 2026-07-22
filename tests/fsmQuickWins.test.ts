// ─── AUD-07c: quick wins de fricción FSM (bundle mecánico) ────────────────────
// 5 fricciones chicas de alto roce diario:
//   1. Negocio uni-barbero: greeting ya no pregunta "¿tienes barbero de
//      preferencia?" cuando no hay nada que elegir (round-trip inútil en CADA
//      reserva del perfil típico del cliente fundador).
//   2. Pregunta de precio al pedir el nombre → se responde (copy.ts) y se
//      repite la pregunta SIN gastar retry (antes: "No capté el nombre" ×2 →
//      fallback).
//   3. isClosingMessage solo aplica a mensajes ≤3 palabras ("ok quiero agendar
//      otra para mi hijo" ya no se traga como despedida).
//   4. El contador estructural no castiga side-questions contestadas (6
//      preguntas legítimas seguidas ya no fuerzan ESCALATED).
//   5. "el sábado" dicho un sábado = HOY, no la próxima semana en silencio.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');   // lunes 12:00 local
const SVC    = '22222222-2222-4222-8222-222222222222';
const CARLOS = '11111111-1111-4111-8111-111111111111';
const ANDRES = '33333333-3333-4333-8333-333333333333';
const PHONE  = '5215500000000';

const SLOT_17     = '2026-07-22T23:00:00.000Z';
const SLOT_17_END = '2026-07-22T23:30:00.000Z';

// ─── Fake Supabase ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    let rows = [...(tablesData[table] ?? [])];
    const filter = (col: string, pass: (a: unknown) => boolean) => {
      rows = rows.filter((r) => (col in r ? pass(r[col]) : true));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:  (c: string, v: unknown) => { filter(c, (a) => a === v); return builder; },
      gt:  () => builder, gte: () => builder, lt: () => builder, lte: () => builder,
      in: () => builder, neq: () => builder, not: () => builder, order: () => builder,
      limit: (n: number) => { rows = rows.slice(0, n); return builder; },
      insert: () => builder, update: () => builder, upsert: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as never;
}

function makeClassifier(single: IntentClassification, multi: MultiIntentClassification) {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => multi,
    classifyIntent:      async (): Promise<IntentClassification> => single,
  };
}

const REAL_UNCLEAR: IntentClassification = {
  intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
};

let bizCounter = 0;
function makeDeps(opts?: {
  twoBarbers?: boolean;
  twoServices?: boolean;
  single?: IntentClassification;
  multi?:  MultiIntentClassification;
}) {
  bizCounter += 1;
  const bizId = `biz-qw-${bizCounter}`;
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
  const staff: Row[] = [
    { id: CARLOS, business_id: bizId, name: 'Carlos', role: 'barber', active: true, whatsapp_id: '5210000000001' },
  ];
  if (opts?.twoBarbers) {
    staff.push({ id: ANDRES, business_id: bizId, name: 'Andres', role: 'barber', active: true, whatsapp_id: '5210000000002' });
  }
  const tablesData: TableData = {
    customers:    [],
    appointments: [],
    staff,
    staff_services: [
      { staff_id: CARLOS, service_id: SVC },
      ...(opts?.twoBarbers ? [{ staff_id: ANDRES, service_id: SVC }] : []),
    ],
    services: [
      { id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true },
      ...(opts?.twoServices
        ? [{ id: '55555555-5555-4555-8555-555555555555', business_id: bizId, name: 'Afeitado', description: null, duration_minutes: 20, price: 150, currency: 'MXN', active: true }]
        : []),
    ],
    bot_logs:     [],
  };
  return {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeClassifier(opts?.single ?? REAL_UNCLEAR, opts?.multi ?? { unclear: true }),
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.qw-test',
  } as never;
}

// ─── 1. Uni-barbero: greeting no pregunta lo que no se puede elegir ──────────

test('uni-barbero: greeting salta la pregunta de barbero y pide el día', async () => {
  const deps = makeDeps({
    multi: { serviceMatch: { value: 'Corte de cabello', confidence: 0.95 } },
  });
  const r = await dispatch('GREETING', makeMsg('quiero un corte'), {}, deps);

  assert.notEqual(r.newState, 'QUALIFYING_STAFF');
  assert.equal(r.newState, 'QUALIFYING_DATETIME');
  assert.equal(r.newContext.staffId, CARLOS);          // pre-asignado
  assert.doesNotMatch(r.responseText, /barbero de preferencia/);
  assert.match(r.responseText, /qué día/i);
});

test('con 2 barberos la pregunta de barbero SIGUE (no hay regresión)', async () => {
  const deps = makeDeps({
    twoBarbers: true,
    multi: { serviceMatch: { value: 'Corte de cabello', confidence: 0.95 } },
  });
  const r = await dispatch('GREETING', makeMsg('quiero un corte'), {}, deps);

  assert.equal(r.newState, 'QUALIFYING_STAFF');
  assert.match(r.responseText, /barbero de preferencia/);
});

// ─── 2. Pregunta de precio al pedir el nombre: responde sin gastar retry ─────

test('"¿cuánto cuesta?" al pedir el nombre → precio + re-pregunta, sin retry', async () => {
  const deps = makeDeps();
  const ctx: LifestyleBotContext = {
    serviceId:    SVC,
    pendingSlots: [{ index: 1, staffId: CARLOS, staffName: 'Carlos', startsAt: SLOT_17, endsAt: SLOT_17_END }],
    selectedSlot: SLOT_17,
  };
  const r = await dispatch('AWAITING_BOOKING_NAME', makeMsg('¿cuánto cuesta?'), ctx, deps);

  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.match(r.responseText, /costo.*\$200/);
  assert.match(r.responseText, /A nombre de quién/);
  // Antes: "No capté bien el nombre" y retry gastado.
  assert.doesNotMatch(r.responseText, /No capté/);
  assert.ok(!r.newContext.clarification_attempts);
});

// ─── 3. Closing solo en mensajes cortos (multi-intención sobrevive) ──────────

test('CONFIRMED + "ok quiero agendar otra para mi hijo" NO se traga como despedida', async () => {
  const deps = makeDeps();
  const r = await dispatch('CONFIRMED', makeMsg('ok quiero agendar otra para mi hijo'), { customerId: undefined }, deps);

  assert.doesNotMatch(r.responseText, /Gracias a ti/);
});

test('los cierres cortos reales siguen funcionando', async () => {
  const deps = makeDeps();
  const r1 = await dispatch('CONFIRMED', makeMsg('gracias'), {}, deps);
  assert.match(r1.responseText, /Gracias a ti/);
  const r2 = await dispatch('CONFIRMED', makeMsg('ok, nos vemos'), {}, deps);
  assert.match(r2.responseText, /Gracias a ti/);
});

// ─── 4. El contador estructural no castiga side-questions contestadas ────────

test('side-question contestada NO incrementa no_progress_streak', async () => {
  const deps = makeDeps({
    single: {
      intent: 'SIDE_QUESTION', confidence: 0.95,
      value: '¿aceptan tarjeta?', side_question_answer: 'Sí, aceptamos tarjeta.',
    },
  });
  const ctx: LifestyleBotContext = { no_progress_streak: 3 };
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('¿aceptan tarjeta?'), ctx, deps);

  // Antes: 6 preguntas legítimas seguidas forzaban ESCALATED.
  assert.notEqual(r.newState, 'ESCALATED');
  assert.equal(r.newContext.no_progress_streak, 3);   // ni sube ni se resetea
});

test('el turno genuinamente sin progreso SÍ incrementa el streak (contraste)', async () => {
  // Dos servicios: sin fast-path de servicio único → "mmm este pues" cae al
  // clasificador (UNCLEAR genuino) → clarify sin avance → el streak sube.
  const deps = makeDeps({ twoServices: true });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('mmm este pues'), { no_progress_streak: 3 }, deps);
  assert.equal(r.newContext.no_progress_streak, 4);
});

// ─── 5. "el sábado" dicho un sábado = HOY ────────────────────────────────────

test('"el sabado" en sábado apunta a HOY; "el próximo sábado" salta de semana', () => {
  const saturdayNoon = new Date('2026-07-25T18:00:00.000Z');   // sábado 12:00 local MX
  assert.equal(parseDate('el sabado', saturdayNoon, TZ), '2026-07-25');
  assert.equal(parseDate('el proximo sabado', saturdayNoon, TZ), '2026-08-01');
  // Regresión: dicho un lunes, sigue apuntando al sábado de ESTA semana.
  assert.equal(parseDate('el sabado', NOW, TZ), '2026-07-25');
});
