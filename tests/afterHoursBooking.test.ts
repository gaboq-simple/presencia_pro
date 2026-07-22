// ─── AUD-07a: el bot agenda 24/7 — fuera de horario ya no es un muro ──────────
// Antes: handleLifestyleMessage retornaba awayMessage ANTES del FSM para todo
// mensaje fuera de office_hours — el mismo texto repetido en cada mensaje, sin
// memoria de habérselo dicho. A las 9pm (hora pico de agendado de una
// barbería) era imposible agendar para mañana o preguntar un precio: el bot
// "24/7" atendía en horario de mostrador.
//
// Ahora el FSM atiende SIEMPRE; el aviso de cerrado se antepone UNA sola vez
// por periodo cerrado (flag away_notice_sent) y se re-arma al reabrir.
//
// El reloj de office_hours es msg.timestamp (canónico del bot) → controlable
// en tests. Camino determinista: AWAITING_CANCEL_CONFIRMATION + "no".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleLifestyleMessage } from '../packages/engine/src/bot/lifestyle/handler';
import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ    = 'America/Mexico_City';
// Miércoles 22-jul, 12:00 local MX (18:00 UTC).
const MSG_AT = new Date('2026-07-22T18:00:00.000Z');
const SVC   = '22222222-2222-4222-8222-222222222222';
const CUST  = '99999999-9999-4999-8999-999999999999';
const APPT  = '44444444-4444-4444-8444-444444444444';
const PHONE = '5215500000000';

const AWAY = 'Ahorita estamos cerrados — nuestro horario es de 9 a 10.';

// Cerrado a las 12:00 local (horario 09:00–10:00 todos los días) vs abierto.
const allDays = (start: string, end: string) =>
  Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, { start, end }]));
const HOURS_CLOSED_AT_NOON = allDays('09:00', '10:00');
const HOURS_OPEN_AT_NOON   = allDays('09:00', '20:00');

// ─── Fake Supabase (patrón persistAfterSend: filtrado real + grabadora) ──────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;
type Write = { table: string; payload: Row };

function makeSupabase(tablesData: TableData, writes: Write[]) {
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

function makeUnclearClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => ({
      intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
    }),
  };
}

let bizCounter = 0;
function makeSetup(opts: { officeHours: unknown; awayNoticeSent?: boolean }) {
  bizCounter += 1;
  const bizId = `biz-ahb-${bizCounter}`;
  const business = {
    id:                    bizId,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Asistente',
    awayMessage:           AWAY,
    fallbackMessage:       'No te entendí bien.',
    officeHours:           opts.officeHours,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  const writes: Write[] = [];
  const tablesData: TableData = {
    bot_conversations: [{
      id:              'conv-1',
      business_id:     bizId,
      customer_phone:  PHONE,
      state:           'AWAITING_CANCEL_CONFIRMATION',
      context: {
        customerId:                 CUST,
        pendingCancelAppointmentId: APPT,
        pendingCancelType:          'cancellation',
        pendingCancelDay:           '2026-07-24',
        ...(opts.awayNoticeSent ? { away_notice_sent: true } : {}),
      },
      last_message:    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      last_message_id: 'wamid.previo',
    }],
    customers:    [{ id: CUST, business_id: bizId, phone: PHONE }],
    appointments: [],
    services:     [{ id: SVC, business_id: bizId, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs:     [],
  };
  return { business, bizId, supabase: makeSupabase(tablesData, writes), writes };
}

function makeMsg(body: string, bizId: string): never {
  return {
    businessId:    bizId,
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     MSG_AT,
    messageId:     'wamid.ahb-nuevo',
  } as never;
}

const convUpserts = (writes: Write[]) => writes.filter((w) => w.table === 'bot_conversations');
const upsertCtx = (writes: Write[]) => convUpserts(writes)[0]!.payload['context'] as Record<string, unknown>;

// ─── 1. REPRO del muro: fuera de horario, el FSM SÍ atiende (con preámbulo) ──

test('fuera de horario: preámbulo de cerrado UNA vez + el FSM procesa el mensaje', async () => {
  const { business, bizId, supabase, writes } = makeSetup({ officeHours: HOURS_CLOSED_AT_NOON });
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId), business: business as never, supabase, anthropicKey: '',
  });

  // Antes: r.message === awayMessage y el FSM nunca corría (0 upserts).
  assert.match(r.message, new RegExp(`^${AWAY.slice(0, 20)}`));
  assert.match(r.message, /queda como está/);          // la respuesta real del FSM
  const ups = convUpserts(writes);
  assert.equal(ups.length, 1);                          // el estado SÍ avanzó
  assert.equal(ups[0]!.payload['state'], 'GREETING');
  assert.equal(upsertCtx(writes)['away_notice_sent'], true);
});

// ─── 2. Segundo mensaje del periodo cerrado: sin repetir el aviso ────────────

test('fuera de horario con aviso ya dado: NO repite el away, el flag persiste', async () => {
  const { business, bizId, supabase, writes } = makeSetup({ officeHours: HOURS_CLOSED_AT_NOON, awayNoticeSent: true });
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId), business: business as never, supabase, anthropicKey: '',
  });

  assert.doesNotMatch(r.message, /estamos cerrados/);
  assert.match(r.message, /queda como está/);
  assert.equal(upsertCtx(writes)['away_notice_sent'], true);
});

// ─── 3. Al reabrir, el flag se limpia (el próximo cierre avisa de nuevo) ─────

test('en horario: sin preámbulo y el flag se re-arma para el siguiente cierre', async () => {
  const { business, bizId, supabase, writes } = makeSetup({ officeHours: HOURS_OPEN_AT_NOON, awayNoticeSent: true });
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId), business: business as never, supabase, anthropicKey: '',
  });

  assert.doesNotMatch(r.message, /estamos cerrados/);
  // El flag no sobrevive al periodo abierto: limpiado explícitamente (false) o
  // ausente (el handler reconstruyó el contexto) — ambos re-arman el aviso.
  assert.ok(!upsertCtx(writes)['away_notice_sent']);
});

// ─── 4. Estado AWAY legacy: se recupera, ya no es un loop de awayMessage ─────

test('conversación atorada en AWAY: el router la recupera vía GREETING', async () => {
  const { business, supabase } = makeSetup({ officeHours: null });
  const deps = {
    business, supabase, anthropicKey: '', model: 'haiku', classifier: makeUnclearClassifier(),
  } as never;
  const r = await dispatch('AWAY', makeMsg('quiero un corte', business.id), {}, deps);

  assert.notEqual(r.newState, 'AWAY');
  assert.notEqual(r.responseText, AWAY);
});
