// ─── AUD-04: en CONFIRMED, cancelar/mover PREGUNTA antes de tocar la BD ───────
// Antes: "puedo cambiar la hora?" en CONFIRMED ejecutaba el UPDATE a cancelled
// DE INMEDIATO (handleModificationOrCancellation) — si el cliente solo
// preguntaba, o ningún horario nuevo le servía, ya había perdido su slot — y
// reiniciaba el flujo re-preguntando el servicio. Con 2 citas futuras,
// cancelaba la más próxima sin distinguir.
//
// Ahora CONFIRMED delega en el flujo con confirmación de AUD-02
// (startCancelFlow → AWAITING_CANCEL_CONFIRMATION), extendido con:
//   - targeting por día ("cancelar mi cita del viernes" apunta a ESA cita)
//   - desambiguación multi-cita (el ask invita a nombrar el día; "es la del
//     viernes" re-apunta sin cancelar la equivocada)
//
// Deterministas: fake Supabase con filtrado real, RPC grabada. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');   // lunes ~12:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';
const CUST   = '99999999-9999-9999-9999-999999999999';
const APPT_MIE = '44444444-4444-4444-4444-444444444444';  // miércoles 22, 17:00 local
const APPT_VIE = '55555555-5555-5555-5555-555555555555';  // viernes 24, 17:00 local
const PHONE  = '5215500000000';

const MIE_STARTS = '2026-07-22T23:00:00.000Z';
const VIE_STARTS = '2026-07-24T23:00:00.000Z';

// ─── Fake Supabase con filtrado real (patrón cancelFromGreeting) ─────────────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;
type RpcCall = { fn: string; args: Record<string, unknown> };

function makeSupabase(tablesData: TableData, rpcCalls: RpcCall[]) {
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
      in: () => builder, neq: () => builder, not: () => builder,
      order: (c: string, opts?: { ascending?: boolean }) => {
        const asc = opts?.ascending !== false;
        rows.sort((a, b) => {
          const av = String(a[c] ?? ''); const bv = String(b[c] ?? '');
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        return builder;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return builder; },
      insert: () => builder, update: () => builder, upsert: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
  } as never;
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
function makeDeps(opts?: { twoAppointments?: boolean }) {
  bizCounter += 1;
  const bizId = `biz-ccc-${bizCounter}`;
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
  const rpcCalls: RpcCall[] = [];
  const appointments: Row[] = [{
    id: APPT_MIE, business_id: bizId, customer_id: CUST, status: 'confirmed',
    starts_at: MIE_STARTS, service_id: SVC, staff_id: CARLOS,
    staff: { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
    service: { name: 'Corte' }, customer: { id: CUST, name: 'Juan' },
  }];
  if (opts?.twoAppointments) {
    appointments.push({
      id: APPT_VIE, business_id: bizId, customer_id: CUST, status: 'confirmed',
      starts_at: VIE_STARTS, service_id: SVC, staff_id: ANDRES,
      staff: { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002' },
      service: { name: 'Corte' }, customer: { id: CUST, name: 'Juan' },
    });
  }
  const tablesData: TableData = {
    customers:    [{ id: CUST, business_id: bizId, phone: PHONE }],
    appointments,
    services:     [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs:     [],
  };
  const deps = {
    business,
    supabase:     makeSupabase(tablesData, rpcCalls),
    anthropicKey: '',
    model:        'haiku',
    classifier:   makeUnclearClassifier(),
  } as never;
  return { deps, rpcCalls };
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.ccc-test',
  } as never;
}

// Contexto típico post-confirmación (la cita del miércoles recién agendada).
const CONFIRMED_CTX: LifestyleBotContext = {
  customerId: CUST,
  serviceId:  SVC,
  staffId:    CARLOS,
};

// ─── 1. REPRO AUD-04: "puedo cambiar la hora?" YA NO cancela sin preguntar ───

test('CONFIRMED + "puedo cambiar la hora?" pregunta — no ejecuta el UPDATE', async () => {
  const { deps, rpcCalls } = makeDeps();
  const r = await dispatch('CONFIRMED', makeMsg('puedo cambiar la hora?'), CONFIRMED_CTX, deps);

  assert.equal(r.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.equal(r.newContext.pendingCancelType, 'modification');
  assert.match(r.responseText, /moverla/);
  // Antes: rpc 'cancelled' inmediata + "Que servicio necesitas?".
  assert.equal(rpcCalls.length, 0);
  assert.doesNotMatch(r.responseText, /Que servicio/);
});

// ─── 2. Cancelación desde CONFIRMED: pregunta → sí → RPC ─────────────────────

test('CONFIRMED + "quiero cancelar mi cita" → pregunta → "sí" → cancela', async () => {
  const { deps, rpcCalls } = makeDeps();
  const ask = await dispatch('CONFIRMED', makeMsg('quiero cancelar mi cita'), CONFIRMED_CTX, deps);

  assert.equal(ask.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.match(ask.responseText, /miércoles 22/);
  assert.equal(rpcCalls.length, 0);

  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), ask.newContext, deps);
  assert.equal(r.newState, 'GREETING');
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0]!.args, { p_appointment_id: APPT_MIE, p_status: 'cancelled' });
});

// ─── 3. Multi-cita: invita a desambiguar y "la del viernes" re-apunta ────────
// Antes: con 2 citas futuras cancelaba la más próxima sin distinguir.

test('2 citas: el ask invita a nombrar el dia; "es la del viernes" re-apunta sin cancelar', async () => {
  const { deps, rpcCalls } = makeDeps({ twoAppointments: true });

  const ask = await dispatch('CONFIRMED', makeMsg('quiero cancelar mi cita'), CONFIRMED_CTX, deps);
  assert.match(ask.responseText, /miércoles 22/);
  assert.match(ask.responseText, /si te refieres a otra/);
  assert.equal(ask.newContext.pendingCancelAppointmentId, APPT_MIE);

  const retarget = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('es la del viernes'), ask.newContext, deps);
  assert.equal(retarget.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.match(retarget.responseText, /viernes 24/);
  assert.match(retarget.responseText, /Andres/);
  assert.equal(retarget.newContext.pendingCancelAppointmentId, APPT_VIE);
  assert.equal(rpcCalls.length, 0);   // nada cancelado todavía

  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), retarget.newContext, deps);
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0]!.args, { p_appointment_id: APPT_VIE, p_status: 'cancelled' });
  assert.equal(r.newState, 'GREETING');
});

// ─── 4. Targeting por día desde el arranque ──────────────────────────────────

test('"cancela mi cita del viernes" apunta directo a la cita del viernes', async () => {
  const { deps, rpcCalls } = makeDeps({ twoAppointments: true });
  const r = await dispatch('CONFIRMED', makeMsg('cancela mi cita del viernes'), CONFIRMED_CTX, deps);

  assert.equal(r.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.match(r.responseText, /viernes 24/);
  assert.equal(r.newContext.pendingCancelAppointmentId, APPT_VIE);
  // Nombró el día → sin coletilla de desambiguación.
  assert.doesNotMatch(r.responseText, /si te refieres a otra/);
  assert.equal(rpcCalls.length, 0);
});
