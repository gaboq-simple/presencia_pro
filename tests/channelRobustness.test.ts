// ─── AUD-07f: robustez de canal — ventana de dedup de message_ids ─────────────
// El dedup por last_message_id solo cubría el reintento del ÚLTIMO mensaje:
// un retry FUERA DE ORDEN del webhook de Meta (el mensaje N-1 reintentado
// después de procesar el N) no matcheaba → se reprocesaba, respondía duplicado
// y pisaba el estado del flujo. Ahora el contexto guarda los últimos 5 ids.
//
// (El resto de AUD-07f — rate limit por cliente, negocio inactivo, nota de voz
// contextual, release de handoff con aviso y sweep por cron — vive en
// route.ts/actions/edge function: superficies sin arnés de test unitario;
// verificación por smoke.)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleLifestyleMessage } from '../packages/engine/src/bot/lifestyle/handler';

const TZ    = 'America/Mexico_City';
const SVC   = '22222222-2222-4222-8222-222222222222';
const CUST  = '99999999-9999-4999-8999-999999999999';
const APPT  = '44444444-4444-4444-8444-444444444444';
const PHONE = '5215500000000';

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
      gt:  () => builder, gte: () => builder, lt: () => builder, lte: () => builder,
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

let bizCounter = 0;
function makeSetup(recentIds: string[], lastMessageId = 'wamid.n5') {
  bizCounter += 1;
  const bizId = `biz-chr-${bizCounter}`;
  const business = {
    id: bizId, name: 'Barbería Demo', whatsappNumber: '5210000000000',
    whatsappPhoneNumberId: 'pnid-1', botName: 'Asistente', awayMessage: 'Cerrado.',
    fallbackMessage: 'No te entendí bien.', officeHours: null,
    walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  const writes: Write[] = [];
  const tablesData: TableData = {
    bot_conversations: [{
      id: 'conv-1', business_id: bizId, customer_phone: PHONE,
      state: 'AWAITING_CANCEL_CONFIRMATION',
      context: {
        customerId: CUST, pendingCancelAppointmentId: APPT,
        pendingCancelType: 'cancellation', pendingCancelDay: '2026-07-24',
        recent_message_ids: recentIds,
      },
      last_message: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      last_message_id: lastMessageId,
    }],
    customers: [{ id: CUST, business_id: bizId, phone: PHONE }],
    appointments: [], services: [], bot_logs: [],
  };
  return { business, bizId, supabase: makeSupabase(tablesData, writes), writes };
}

function makeMsg(body: string, bizId: string, messageId: string): never {
  return {
    businessId: bizId, customerPhone: PHONE, customerName: null,
    body, timestamp: new Date(), messageId,
  } as never;
}

const convUpserts = (writes: Write[]) => writes.filter((w) => w.table === 'bot_conversations');

// ─── 1. REPRO: retry fuera de orden ya no se reprocesa ───────────────────────

test('retry del mensaje N-1 (viejo pero en la ventana) → silencio, sin reprocesar', async () => {
  const { business, bizId, supabase, writes } = makeSetup(
    ['wamid.n1', 'wamid.n2', 'wamid.n3', 'wamid.n4', 'wamid.n5'],
  );
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId, 'wamid.n3'),   // reintento fuera de orden
    business: business as never, supabase, anthropicKey: '',
  });

  assert.equal(r.message, '');
  assert.equal(convUpserts(writes).length, 0);   // no pisa el estado del flujo
});

// ─── 2. El dedup del último id sigue funcionando (regresión) ─────────────────

test('retry del ÚLTIMO mensaje → silencio (comportamiento histórico intacto)', async () => {
  const { business, bizId, supabase, writes } = makeSetup([], 'wamid.n5');
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId, 'wamid.n5'),
    business: business as never, supabase, anthropicKey: '',
  });

  assert.equal(r.message, '');
  assert.equal(convUpserts(writes).length, 0);
});

// ─── 3. Mensaje nuevo: la ventana rota y se mantiene en 5 ────────────────────

test('mensaje nuevo → se persiste la ventana con el id nuevo, tope 5', async () => {
  const { business, bizId, supabase, writes } = makeSetup(
    ['wamid.n1', 'wamid.n2', 'wamid.n3', 'wamid.n4', 'wamid.n5'],
  );
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId, 'wamid.n6'),
    business: business as never, supabase, anthropicKey: '',
  });

  assert.match(r.message, /queda como está/);
  const ctx = convUpserts(writes)[0]!.payload['context'] as Record<string, unknown>;
  const ids = ctx['recent_message_ids'] as string[];
  assert.deepEqual(ids, ['wamid.n2', 'wamid.n3', 'wamid.n4', 'wamid.n5', 'wamid.n6']);
});
