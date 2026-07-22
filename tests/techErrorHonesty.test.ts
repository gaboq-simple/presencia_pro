// ─── AUD-07b: error técnico ≠ "no te entendí" ─────────────────────────────────
// Antes: un timeout/429/JSON-roto del clasificador colapsaba a UNCLEAR conf 0 —
// indistinguible de incomprensión real. El cliente escribía perfectamente claro
// y recibía "No entendí bien…", gastaba clarification_attempts rumbo a la
// escalación, y en bot_logs quedaba contaminado como UNCLEAR genuino. Un throw
// de handler respondía fallbackMessage ("no te entendí" — el mensaje
// equivocado) y entraba al funnel de FALLBACK.
//
// Ahora: failure_reason distingue el fallo técnico; el funnel de clarify
// responde TECHNICAL_HICCUP sin gastar intentos; el throw de handler se queda
// en el MISMO estado con contador propio (tech_failures) y al 3º escala a
// humano con la verdad + aviso atómico al admin (hook de AUD-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch, MAX_TECH_FAILURES } from '../packages/engine/src/bot/lifestyle/router';
import { classifyIntent } from '../packages/engine/src/bot/lifestyle/classifier';
import { TECHNICAL_HICCUP_MESSAGE, TECHNICAL_ESCALATION_MESSAGE } from '../packages/engine/src/bot/lifestyle/copy';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');
const SVC_A  = '22222222-2222-4222-8222-222222222222';
const SVC_B  = '33333333-3333-4333-8333-333333333333';
const CARLOS = '11111111-1111-4111-8111-111111111111';
const PHONE  = '5215500000000';
const ADMIN_WA = '5215299999999';

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

type SingleResult = IntentClassification | (() => never);

function makeClassifier(single: SingleResult) {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => {
      if (typeof single === 'function') return single();
      return single;
    },
  };
}

let bizCounter = 0;
function makeDeps(single: SingleResult) {
  bizCounter += 1;
  const bizId = `biz-teh-${bizCounter}`;
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
  // DOS servicios: sin fast-path de servicio único → el mensaje ambiguo cae al clasificador.
  const tablesData: TableData = {
    customers: [],
    appointments: [],
    staff: [{ id: CARLOS, business_id: bizId, role: 'admin', active: true, whatsapp_id: ADMIN_WA, name: 'Admin' }],
    services: [
      { id: SVC_A, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true },
      { id: SVC_B, business_id: bizId, name: 'Afeitado', description: null, duration_minutes: 20, price: 150, currency: 'MXN', active: true },
    ],
    bot_logs: [],
  };
  return {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeClassifier(single),
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.teh-test',
  } as never;
}

const TECH_UNCLEAR: IntentClassification = {
  intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null, failure_reason: 'timeout',
};
const REAL_UNCLEAR: IntentClassification = {
  intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
};

function withStubbedMeta(fn: (sent: string[]) => Promise<void>): () => Promise<void> {
  return async () => {
    const sent: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalToken = process.env['WHATSAPP_ACCESS_TOKEN'];
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.fake' }] }), { status: 200 });
    }) as typeof fetch;
    process.env['WHATSAPP_ACCESS_TOKEN'] = 'test-token';
    try { await fn(sent); } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env['WHATSAPP_ACCESS_TOKEN'];
      else process.env['WHATSAPP_ACCESS_TOKEN'] = originalToken;
    }
  };
}

// ─── 1. REPRO: fallo del clasificador ya no dice "no te entendí" ─────────────

test('clasificador con failure_reason → mensaje técnico honesto SIN gastar clarify', async () => {
  const deps = makeDeps(TECH_UNCLEAR);
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('quiero algo padre'), {}, deps);

  assert.equal(r.newState, 'QUALIFYING_SERVICE');
  assert.equal(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  // Un outage de Anthropic NO empuja hacia la escalación por "no entender".
  assert.ok(!r.newContext.clarification_attempts);
});

// ─── 2. Contraste: el UNCLEAR genuino conserva el funnel de clarify ──────────

test('UNCLEAR genuino (sin failure_reason) sigue gastando clarification_attempts', async () => {
  const deps = makeDeps(REAL_UNCLEAR);
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('quiero algo padre'), {}, deps);

  assert.equal(r.newState, 'QUALIFYING_SERVICE');
  assert.notEqual(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  assert.equal(r.newContext.clarification_attempts, 1);
});

// ─── 3. Throw de handler: mismo estado + contador, ya no fallbackMessage ─────

test('throw de handler → mensaje técnico, MISMO estado, tech_failures=1', async () => {
  const deps = makeDeps(() => { throw new Error('boom'); });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('quiero algo padre'), {}, deps);

  assert.equal(r.newState, 'QUALIFYING_SERVICE');   // antes: FALLBACK
  assert.equal(r.responseText, TECHNICAL_HICCUP_MESSAGE);   // antes: "No te entendí bien."
  assert.equal(r.newContext.tech_failures, 1);
});

// ─── 4. 3er fallo consecutivo → escala con la verdad + aviso al admin ────────

test('3 fallos técnicos → ESCALATED honesto + notificación atómica', withStubbedMeta(async (sent) => {
  const deps = makeDeps(() => { throw new Error('boom'); });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('sigo aquí'), { tech_failures: MAX_TECH_FAILURES - 1 }, deps);

  assert.equal(r.newState, 'ESCALATED');
  assert.equal(r.responseText, TECHNICAL_ESCALATION_MESSAGE);
  assert.equal(sent.length, 1);                       // el admin SÍ se entera
  assert.equal(r.newContext.escalation_notified, true);
}));

// ─── 5. El primer turno exitoso resetea el contador ──────────────────────────

test('turno exitoso tras fallos técnicos → tech_failures vuelve a 0', async () => {
  const deps = makeDeps(REAL_UNCLEAR);
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('quiero algo padre'), { tech_failures: 2 }, deps);

  assert.equal(r.newContext.tech_failures, 0);
});

// ─── 6. Clasificador real offline: failure_reason presente, no UNCLEAR mudo ──

test('classifyIntent sin API alcanzable marca failure_reason (no UNCLEAR genuino)', async () => {
  const r = await classifyIntent({
    userMessage: 'quiero un corte', availableOptions: ['Corte'], flowQuestion: '¿Qué servicio?',
    businessContext: 'Negocio: Demo', recentHistory: [], anthropicKey: '',
    businessId: 'biz-x', customerPhone: PHONE,
  });

  assert.equal(r.intent, 'UNCLEAR');
  assert.ok(r.failure_reason === 'api' || r.failure_reason === 'timeout');
});
