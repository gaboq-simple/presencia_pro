// ─── AUD-05: el FSM no avanza si el mensaje nunca llegó al cliente ────────────
// Antes: handleLifestyleMessage persistía el nuevo estado y DESPUÉS el route
// intentaba sendMessage. Si el envío a Meta fallaba, el catch mandaba el
// fallbackMessage ("no te entendí") — pero el FSM ya había avanzado: quedaba
// esperando el "sí" a una pregunta que el cliente NUNCA vio (pregunta
// fantasma), y su siguiente mensaje se interpretaba contra ella.
//
// Ahora el caller inyecta `send` y el handler envía ANTES de persistir:
//   - send OK   → persiste y marca sent:true (el caller no re-envía)
//   - send FALLA → NO persiste (estado consistente con lo que el cliente vio),
//                  retorna sendFailed:true y el caller no manda nada más
//   - sin send  → comportamiento histórico (tests/Twilio dev síncrono)
//
// Se ejercita con AWAITING_CANCEL_CONFIRMATION + "no": camino 100% determinista
// (sin LLM, sin red) que transiciona a GREETING con texto fijo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleLifestyleMessage } from '../packages/engine/src/bot/lifestyle/handler';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ    = 'America/Mexico_City';
// UUIDs v4 válidos — el schema Zod del contexto valida formato (versión+variante).
const SVC   = '22222222-2222-4222-8222-222222222222';
const CUST  = '99999999-9999-4999-8999-999999999999';
const APPT  = '44444444-4444-4444-8444-444444444444';
const PHONE = '5215500000000';

// ─── Fake Supabase: filtrado real + grabadora de upserts ─────────────────────

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

let bizCounter = 0;
function makeSetup() {
  bizCounter += 1;
  const bizId = `biz-pas-${bizCounter}`;
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
        pendingCancelDay:           '2026-07-22',
      },
      last_message:    new Date(Date.now() - 60 * 60 * 1000).toISOString(),  // hace 1h
      last_message_id: 'wamid.previo',
    }],
    customers:    [{ id: CUST, business_id: bizId, phone: PHONE }],
    appointments: [],
    services:     [{ id: SVC, business_id: bizId, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs:     [],
  };
  return { business, bizId, supabase: makeSupabase(tablesData, writes), writes };
}

// msg.businessId ES el tenant de las queries del handler (tenantDb) — debe
// coincidir con business.id, como lo garantiza buildMetaMessage en producción.
function makeMsg(body: string, bizId: string): never {
  return {
    businessId:    bizId,
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     new Date(),
    messageId:     'wamid.pas-nuevo',
  } as never;
}

const convUpserts = (writes: Write[]) => writes.filter((w) => w.table === 'bot_conversations');

// ─── 1. Legacy (sin send): persiste y devuelve el texto ──────────────────────

test('sin send inyectado: comportamiento histórico — persiste y devuelve el texto', async () => {
  const { business, bizId, supabase, writes } = makeSetup();
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId),
    business: business as never,
    supabase,
    anthropicKey: '',
  });

  assert.match(r.message, /queda como está/);
  assert.equal(r.sent, undefined);
  const ups = convUpserts(writes);
  assert.equal(ups.length, 1);
  assert.equal(ups[0]!.payload['state'], 'GREETING');
});

// ─── 2. send OK: envía ANTES de persistir y marca sent ───────────────────────

test('send exitoso: envía el texto, persiste después y marca sent:true', async () => {
  const { business, bizId, supabase, writes } = makeSetup();
  const sends: string[] = [];
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId),
    business: business as never,
    supabase,
    anthropicKey: '',
    send: async (text) => {
      // El envío ocurre ANTES de cualquier persistencia del estado.
      assert.equal(convUpserts(writes).length, 0);
      sends.push(text);
    },
  });

  assert.equal(r.sent, true);
  assert.equal(r.sendFailed, undefined);
  assert.equal(sends.length, 1);
  assert.match(sends[0]!, /queda como está/);
  const ups = convUpserts(writes);
  assert.equal(ups.length, 1);
  assert.equal(ups[0]!.payload['state'], 'GREETING');
  assert.equal(ups[0]!.payload['last_message_id'], 'wamid.pas-nuevo');
});

// ─── 3. REPRO AUD-05: send FALLA → el estado NO avanza ───────────────────────

test('send falla: NO persiste (sin pregunta fantasma) y no pide enviar nada más', async () => {
  const { business, bizId, supabase, writes } = makeSetup();
  let attempts = 0;
  const r = await handleLifestyleMessage({
    msg: makeMsg('no', bizId),
    business: business as never,
    supabase,
    anthropicKey: '',
    send: async () => {
      attempts += 1;
      throw new Error('Meta WA 500: algo tronó');
    },
  });

  assert.equal(attempts, 1);
  assert.equal(r.sendFailed, true);
  assert.equal(r.message, '');           // el caller no debe mandar nada más
  // La conversación NO se tocó: sigue en AWAITING_CANCEL_CONFIRMATION con el
  // last_message_id previo — un retry del webhook del MISMO mensaje se
  // reprocesa completo (segunda oportunidad de entrega).
  assert.equal(convUpserts(writes).length, 0);
});
