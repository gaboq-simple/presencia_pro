// ─── AUD-02: cancelar/reagendar una cita existente desde GREETING ─────────────
// El caso de uso #2 de un bot de citas: "quiero cancelar mi cita del viernes"
// escrito AL DÍA SIGUIENTE de agendar (la conversación ya se reseteó a GREETING).
// Antes de AUD-02 no había ruta: el mensaje caía al flujo de reserva y el
// fast-path de servicio único respondía "Perfecto, Corte de cabello…" — el bot
// intentaba VENDER una cita a quien quería cancelarla (repro del audit).
//
// Estos tests van por dispatch() (la intercepción vive en el ROUTER, no en un
// handler de estado — mismo racional que passiveConfirmGuard). Supabase fake
// con FILTRADO REAL de eq/gt/gte/lte: el pasivo de recordatorios acota su
// ventana de 3h en la query, y la cita sembrada a +2 días debe quedar FUERA de
// esa ventana para que el pasivo no intervenga (como en producción).
//
// Deterministas: sin red, classifier mockeado, RPC grabada. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ   = 'America/Mexico_City';                    // UTC-6 fijo (MX sin DST)
const NOW  = new Date('2026-07-20T18:00:00.000Z');     // lunes ~12:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const CUST   = '99999999-9999-9999-9999-999999999999';
const APPT   = '44444444-4444-4444-4444-444444444444';
const PHONE  = '5215500000000';

// Cita futura a +2 días: miércoles 22-jul 17:00 local MX = 23:00 UTC.
const APPT_STARTS = '2026-07-22T23:00:00.000Z';
// Variante DENTRO de la ventana de 3h del pasivo (hoy 13:00 local = 19:00 UTC).
const APPT_SOON = '2026-07-20T19:00:00.000Z';

// ─── Fake Supabase con filtrado real ─────────────────────────────────────────
// A diferencia del fake de passiveConfirmGuard (que ignora filtros), aquí
// eq/gt/gte/lt/lte FILTRAN de verdad cuando la columna existe en la fila:
// la corrección de estos flujos depende de qué query devuelve qué.

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;
export type RpcCall = { fn: string; args: Record<string, unknown> };

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
      in: () => builder, neq: () => builder, not: () => builder, order: () => builder,
      limit: (n: number) => { rows = rows.slice(0, n); return builder; },
      insert: () => builder, update: () => builder,
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

// Classifier mock: UNCLEAR — estos flujos son deterministas y no deben depender
// del LLM; si algún camino cae al clasificador, cae en el clarify genérico.
function makeUnclearClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async (): Promise<IntentClassification> => ({
      intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
    }),
  };
}

let bizCounter = 0;
function makeDeps(opts?: { withAppointment?: boolean; startsAt?: string; apptStatus?: string }) {
  bizCounter += 1;
  const bizId = `biz-cfg-${bizCounter}`;               // único → aísla cache de catálogo
  const withAppt = opts?.withAppointment ?? true;
  const business = {
    id:                    bizId,
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
  const rpcCalls: RpcCall[] = [];
  const tablesData: TableData = {
    customers: [{ id: CUST, business_id: bizId, phone: PHONE }],
    appointments: withAppt ? [{
      id:          APPT,
      business_id: bizId,
      customer_id: CUST,
      status:      opts?.apptStatus ?? 'confirmed',
      starts_at:   opts?.startsAt ?? APPT_STARTS,
      service_id:  SVC,
      staff_id:    CARLOS,
      staff:       { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
      service:     { name: 'Corte' },
      customer:    { id: CUST, name: 'Juan' },
    }] : [],
    services: [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    bot_logs: [],
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
    messageId:     'wamid.cfg-test',
  } as never;
}

const askCtx = (kind: 'cancellation' | 'modification'): LifestyleBotContext => ({
  customerId:                 CUST,
  pendingCancelAppointmentId: APPT,
  pendingCancelType:          kind,
});

// ─── 1. REPRO del audit: cancelar desde GREETING ya no vende una cita ────────

test('GREETING + "quiero cancelar mi cita del viernes" pregunta confirmación, no vende', async () => {
  const { deps, rpcCalls } = makeDeps();
  const r = await dispatch('GREETING', makeMsg('quiero cancelar mi cita del viernes'), {}, deps);

  assert.equal(r.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.equal(r.newContext.pendingCancelAppointmentId, APPT);
  assert.equal(r.newContext.pendingCancelType, 'cancellation');
  // Describe la cita real y pregunta — no empuja el flujo de reserva.
  assert.match(r.responseText, /Carlos/);
  assert.match(r.responseText, /cancelarla/i);
  assert.doesNotMatch(r.responseText, /Perfecto|servicio te interesa|barbero de preferencia/i);
  // Solo preguntó: la BD sigue intacta.
  assert.equal(rpcCalls.length, 0);
});

// ─── 2. Sí explícito → cancela vía RPC y despide ─────────────────────────────

test('AWAITING_CANCEL_CONFIRMATION + "sí" cancela la cita (RPC) y vuelve a GREETING', async () => {
  const { deps, rpcCalls } = makeDeps();
  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), askCtx('cancellation'), deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /cancelada/);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.fn, 'bot_set_appointment_status');
  assert.deepEqual(rpcCalls[0]!.args, { p_appointment_id: APPT, p_status: 'cancelled' });
});

// ─── 3. No → la cita queda intacta ───────────────────────────────────────────

test('AWAITING_CANCEL_CONFIRMATION + "no" NO toca la BD y la cita queda', async () => {
  const { deps, rpcCalls } = makeDeps();
  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('no'), askCtx('cancellation'), deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /queda como está/);
  assert.equal(rpcCalls.length, 0);
});

// ─── 4. Ambiguo ×2 → default seguro: NUNCA cancelar sin sí ───────────────────

test('respuestas ambiguas: 1 clarify y al 2º sale SIN cancelar', async () => {
  const { deps, rpcCalls } = makeDeps();

  const r1 = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('a ver dejame checar'), askCtx('cancellation'), deps);
  assert.equal(r1.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.match(r1.responseText, /sí o no/);
  assert.equal(r1.newContext.clarification_attempts, 1);

  const r2 = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('mmm bueno este'), r1.newContext, deps);
  assert.equal(r2.newState, 'GREETING');
  assert.match(r2.responseText, /queda como está/);
  assert.equal(rpcCalls.length, 0);
});

// ─── 5. Sin cita futura → honesto, sin arrancar el flujo de reserva ──────────

test('GREETING + cancelar SIN cita futura responde honesto y no agenda', async () => {
  const { deps, rpcCalls } = makeDeps({ withAppointment: false });
  const r = await dispatch('GREETING', makeMsg('cancela mi cita'), {}, deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /No encontré una cita/);
  assert.doesNotMatch(r.responseText, /Perfecto|barbero/i);
  assert.equal(rpcCalls.length, 0);
});

// ─── 6. Modificación: mover pre-llena servicio/barbero y pide solo el día ────

test('GREETING + "quiero cambiar mi cita" → confirmar → QUALIFYING_DATETIME pre-llenado', async () => {
  const { deps, rpcCalls } = makeDeps();

  const ask = await dispatch('GREETING', makeMsg('quiero cambiar mi cita'), {}, deps);
  assert.equal(ask.newState, 'AWAITING_CANCEL_CONFIRMATION');
  assert.equal(ask.newContext.pendingCancelType, 'modification');
  assert.match(ask.responseText, /moverla/);
  assert.equal(rpcCalls.length, 0);

  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), ask.newContext, deps);
  assert.equal(r.newState, 'QUALIFYING_DATETIME');
  // NO re-pregunta el servicio/barbero que ya conoce (hallazgo del audit).
  assert.equal(r.newContext.serviceId, SVC);
  assert.equal(r.newContext.staffId, CARLOS);
  assert.match(r.responseText, /qué día/i);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.args['p_status'], 'cancelled');
});

// ─── 7. El pasivo de recordatorios NO secuestra el "sí" de cancelación ───────
// Cita DENTRO de la ventana de 3h (el pasivo se activaría en reposo). El estado
// AWAITING_CANCEL_CONFIRMATION es flujo activo: el "sí" es para LA PREGUNTA DE
// CANCELAR, no confirmación de asistencia (misma clase de bug que R3).

test('cita a <3h: el "sí" cancela — el pasivo no lo lee como confirmación de asistencia', async () => {
  const { deps, rpcCalls } = makeDeps({ startsAt: APPT_SOON });
  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), askCtx('cancellation'), deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /cancelada/);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.args['p_status'], 'cancelled');
});

// ─── 8. Fast-path de servicio único ya no traga "cancelar mi cita" ───────────

test('QUALIFYING_SERVICE (servicio único) + "quiero cancelar mi cita" NO auto-avanza', async () => {
  const { deps } = makeDeps();
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('quiero cancelar mi cita'), { customerId: CUST }, deps);

  // Antes: buildAdvanceResult → QUALIFYING_STAFF + "Perfecto, Corte de cabello…".
  assert.notEqual(r.newState, 'QUALIFYING_STAFF');
  assert.doesNotMatch(r.responseText, /Perfecto/);
});

// ─── 9. La cita cambió entre la pregunta y el sí → no cancela fantasmas ──────

test('si la cita ya no está confirmed al decir "sí", avisa y no llama la RPC', async () => {
  // El staff la canceló desde el panel entre la pregunta del bot y el "sí".
  const { deps, rpcCalls } = makeDeps({ apptStatus: 'cancelled' });
  const r = await dispatch('AWAITING_CANCEL_CONFIRMATION', makeMsg('sí'), askCtx('cancellation'), deps);

  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /ya no aparece activa/);
  assert.equal(rpcCalls.length, 0);
});
