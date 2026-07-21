// ─── AUD-03: escalación pegajosa + notificación atómica al admin ──────────────
// Antes: ESCALATED era terminal → el siguiente mensaje reseteaba a GREETING y
// el bot re-saludaba como si nada ("promesa vacía"); y el handoff por rechazo
// sembraba fallbackAttempts:2 esperando que el PRÓXIMO mensaje notificara al
// admin vía handleFallback — pero el reset de terminales corría antes del
// dispatch, así que el case ESCALATED nunca ejecutaba: EL AVISO NO SALÍA NUNCA.
//
// Ahora: dispatch() notifica al admin en el MISMO turno de la transición a
// ESCALATED (cualquier camino), y ESCALATED es pegajoso — el 1er mensaje del
// cliente recibe "el equipo ya está enterado", el 2º retoma la atención.
//
// Deterministas: fake Supabase con filtrado real, fetch stubeado (captura el
// envío a Meta sin red), classifier mockeado. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { isTerminalState } from '../packages/engine/src/bot/lifestyle/context';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');   // lunes ~12:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const PHONE  = '5215500000000';
const ADMIN_WA = '5215299999999';

const SLOT_17     = '2026-07-20T23:00:00.000Z';
const SLOT_17_END = '2026-07-20T23:30:00.000Z';

// ─── Fake Supabase (filtrado real de eq/gt/gte/lte, como cancelFromGreeting) ──

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
      gt:  (c: string, v: unknown) => { filter(c, (a) => (a as string) >  (v as string)); return builder; },
      gte: (c: string, v: unknown) => { filter(c, (a) => (a as string) >= (v as string)); return builder; },
      lt:  (c: string, v: unknown) => { filter(c, (a) => (a as string) <  (v as string)); return builder; },
      lte: (c: string, v: unknown) => { filter(c, (a) => (a as string) <= (v as string)); return builder; },
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

function makeUnclearClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => ({
      intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
    }),
  };
}

let bizCounter = 0;
function makeDeps(opts?: { withAdmin?: boolean }) {
  bizCounter += 1;
  const bizId = `biz-esc-${bizCounter}`;
  const withAdmin = opts?.withAdmin ?? true;
  const business = {
    id:                    bizId,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'No te entendi bien.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  const tablesData: TableData = {
    customers:    [],
    appointments: [],
    staff:        withAdmin
      ? [{ id: CARLOS, business_id: bizId, role: 'admin', active: true, whatsapp_id: ADMIN_WA, name: 'Admin' }]
      : [],
    services:     [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs:     [],
  };
  return {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeUnclearClassifier(),
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.esc-test',
  } as never;
}

// ─── Stub de fetch: captura los envíos a Meta sin tocar la red ───────────────

type SentRequest = { url: string; body: string };

function withStubbedMeta(fn: (sent: SentRequest[]) => Promise<void>): () => Promise<void> {
  return async () => {
    const sent: SentRequest[] = [];
    const originalFetch = globalThis.fetch;
    const originalToken = process.env['WHATSAPP_ACCESS_TOKEN'];
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      sent.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.fake' }] }), { status: 200 });
    }) as typeof fetch;
    process.env['WHATSAPP_ACCESS_TOKEN'] = 'test-token';
    try {
      await fn(sent);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env['WHATSAPP_ACCESS_TOKEN'];
      else process.env['WHATSAPP_ACCESS_TOKEN'] = originalToken;
    }
  };
}

// ─── 1. ESCALATED ya no es terminal ──────────────────────────────────────────

test('ESCALATED ya no es terminal; COMPLETED sí', () => {
  assert.equal(isTerminalState('ESCALATED'), false);
  assert.equal(isTerminalState('COMPLETED'), true);
});

// ─── 2. Fallback ×2: promesa y aviso al admin en el MISMO turno ──────────────

test('FALLBACK 2º intento → ESCALATED + notificación al admin en el mismo turno', withStubbedMeta(async (sent) => {
  const deps = makeDeps();
  const r = await dispatch('FALLBACK', makeMsg('sigo sin entender nada'), { fallbackAttempts: 1 }, deps);

  assert.equal(r.newState, 'ESCALATED');
  assert.match(r.responseText, /te comunico con nuestro equipo/);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.body, new RegExp(PHONE));
  assert.match(sent[0]!.body, /atención humana/);
  assert.equal(r.newContext.escalation_notified, true);
}));

// ─── 3. REPRO del gap: rechazo ×4 notifica en el mismo turno ─────────────────
// Antes el aviso de este camino NO SALÍA NUNCA (fallbackAttempts:2 sembrado +
// reset de terminales = el case ESCALATED jamás corría).

test('rechazo ×4 en CONFIRMING → ESCALATED + aviso al admin (antes: nunca salía)', withStubbedMeta(async (sent) => {
  const deps = makeDeps();
  const ctx: LifestyleBotContext = {
    serviceId:          SVC,
    pendingSlots:       [{ index: 1, staffId: CARLOS, staffName: 'Carlos', startsAt: SLOT_17, endsAt: SLOT_17_END }],
    rejection_attempts: 3,
  };
  const r = await dispatch('CONFIRMING_APPOINTMENT', makeMsg('no'), ctx, deps);

  assert.equal(r.newState, 'ESCALATED');
  assert.match(r.responseText, /conectarte con el equipo/);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.body, new RegExp(PHONE));
  assert.equal(r.newContext.escalation_notified, true);
}));

// ─── 4. Sin admin notificable: no truena, la promesa sale igual ──────────────

test('sin admin con whatsapp_id: escala igual, sin explotar ni mandar nada', withStubbedMeta(async (sent) => {
  const deps = makeDeps({ withAdmin: false });
  const r = await dispatch('FALLBACK', makeMsg('nada'), { fallbackAttempts: 1 }, deps);

  assert.equal(r.newState, 'ESCALATED');
  assert.equal(sent.length, 0);
}));

// ─── 5. Pegajoso: el 1er mensaje tras escalar sostiene la promesa ────────────

test('1er mensaje en ESCALATED → acuse de espera, sin re-saludar ni re-notificar', withStubbedMeta(async (sent) => {
  const deps = makeDeps();
  const ctx: LifestyleBotContext = { escalation_notified: true };
  const r = await dispatch('ESCALATED', makeMsg('hola? siguen ahi?'), ctx, deps);

  assert.equal(r.newState, 'ESCALATED');
  assert.match(r.responseText, /equipo ya esta enterado/);
  assert.doesNotMatch(r.responseText, /en que puedo ayudarte/i);
  assert.equal(r.newContext.escalation_holds, 1);
  assert.equal(sent.length, 0);   // dedup: no segundo aviso
}));

// ─── 6. Al 2º mensaje sin humano, el bot retoma (no deja colgado) ────────────

test('2º mensaje en ESCALATED → el bot retoma la atención vía GREETING', withStubbedMeta(async (sent) => {
  const deps = makeDeps();
  const ctx: LifestyleBotContext = { escalation_notified: true, escalation_holds: 1 };
  const r = await dispatch('ESCALATED', makeMsg('bueno, quiero agendar un corte'), ctx, deps);

  assert.notEqual(r.newState, 'ESCALATED');
  assert.match(r.responseText, /Mientras el equipo te contacta/);
  assert.equal(sent.length, 0);
}));
