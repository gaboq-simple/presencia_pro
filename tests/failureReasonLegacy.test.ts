// ─── failure_reason en rutas legacy (residuo AUD-07b) ────────────────────────
// AUD-07b introdujo failure_reason en el clasificador (timeout/api/parse) para
// que un fallo TÉCNICO no se confunda con incomprensión del cliente. Las rutas
// modernas lo consumen vía handleClassification (TECH_ISSUE), pero dos rutas
// legacy quedaron fuera:
//   - AWAITING_CONFIRMATION: el UNCLEAR de outage caía al bloque "Ambiguo" →
//     gastaba confirmationRetries (cap 2 → FALLBACK) con 'Solo dime "si"…'.
//   - confirmationResponse (pasivo de recordatorios): caía al `return null` →
//     el router normal re-corría el turno contra el MISMO clasificador caído.
// Este archivo blinda los dos guards nuevos: hiccup honesto, contadores
// intactos, estado sin mover, y los fast paths por keywords vivos en outage.
//
// Deterministas: sin red, classifier mockeado vía deps.classifier (deuda #1).
// Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { TECHNICAL_HICCUP_MESSAGE } from '../packages/engine/src/bot/lifestyle/copy';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z'); // lunes ~12:00 local (reloj del MSG)
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const CUST   = '99999999-9999-9999-9999-999999999999';
const APPT   = '44444444-4444-4444-4444-444444444444';
const PHONE  = '5215500000000';

// La ventana de 3h del pasivo usa el reloj canónico (msg.timestamp = NOW):
// cita sembrada a +1h de NOW → dentro de la ventana, determinista.
const APPT_SOON = new Date(NOW.getTime() + 60 * 60_000).toISOString();

// ─── Fake Supabase con filtrado real (patrón cancelFromGreeting) ─────────────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;

function makeSupabase(tablesData: TableData, rpcCalls: { fn: string }[]) {
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
      in:  (c: string, vs: unknown[]) => { filter(c, (a) => vs.includes(a)); return builder; },
      neq: () => builder, not: () => builder, order: () => builder,
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
    rpc: async (fn: string) => { rpcCalls.push({ fn }); return { data: null, error: null }; },
  } as never;
}

// ─── Deps con clasificador en OUTAGE (o sano, para el contraste) ─────────────

let bizCounter = 0;

function makeDeps(opts: { failureReason: 'timeout' | 'api' | null; withSoonAppt?: boolean }) {
  bizCounter += 1;
  const bizId = `biz-frl-${bizCounter}`; // único → aísla el cache de catálogo
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
  const classifierCalls: string[] = [];
  const classifier = {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> =>
      opts.failureReason ? { unclear: true, failure_reason: opts.failureReason } : { unclear: true },
    classifyIntent: async (): Promise<IntentClassification> => {
      classifierCalls.push('single');
      return {
        intent: 'UNCLEAR', confidence: 0, value: null, side_question_answer: null,
        ...(opts.failureReason ? { failure_reason: opts.failureReason } : {}),
      };
    },
  };
  const rpcCalls: { fn: string }[] = [];
  const tablesData: TableData = {
    customers: [{ id: CUST, business_id: bizId, phone: PHONE, name: 'Juan', favorite_staff_id: null, favorite_service_id: null, last_visit: null, favorite_staff: null, favorite_service: null }],
    services:  [{ id: SVC, business_id: bizId, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN', active: true }],
    appointments: (opts.withSoonAppt ?? false) ? [{
      id:          APPT,
      business_id: bizId,
      customer_id: CUST,
      status:      'confirmed',
      starts_at:   APPT_SOON,
      service_id:  SVC,
      staff_id:    CARLOS,
      staff:       { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
      service:     { name: 'Corte' },
      customer:    { id: CUST, name: 'Juan' },
    }] : [],
    staff:    [],
    bot_logs: [],
  };
  const deps = {
    business,
    supabase:     makeSupabase(tablesData, rpcCalls),
    anthropicKey: '',
    classifier,
  } as never;
  return { deps, rpcCalls, classifierCalls };
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: PHONE,
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.frl-test',
  } as never;
}

// Contexto de AWAITING_CONFIRMATION con oferta pendiente y retries en 1 (el
// borde: un gasto más y el cap MAX_RETRIES=2 tumba a FALLBACK).
const awaitingCtx = (): LifestyleBotContext => ({
  customerId:          CUST,
  serviceId:           SVC,
  staffId:             CARLOS,
  selectedSlot:        '2026-07-21T22:00:00.000Z',
  confirmationRetries: 1,
});

// ─── 1. AWAITING_CONFIRMATION: outage NO gasta confirmationRetries ───────────

test('outage en AWAITING_CONFIRMATION: hiccup honesto, retries intactos, estado sin mover', async () => {
  const { deps } = makeDeps({ failureReason: 'timeout' });
  const r = await dispatch('AWAITING_CONFIRMATION', makeMsg('ehh este'), awaitingCtx(), deps);

  assert.equal(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  assert.equal(r.newState, 'AWAITING_CONFIRMATION');
  // El contador NO se movió — antes este turno gastaba el último retry y el
  // siguiente mensaje caía a FALLBACK con el mensaje equivocado.
  assert.equal(r.newContext.confirmationRetries, 1);
});

test('contraste: UNCLEAR real (sin failure_reason) SÍ gasta el retry con el clarify legítimo', async () => {
  const { deps } = makeDeps({ failureReason: null });
  const r = await dispatch('AWAITING_CONFIRMATION', makeMsg('ehh este'), awaitingCtx(), deps);

  assert.notEqual(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  assert.equal(r.newContext.confirmationRetries, 2);
});

test('el fast path de "si" exacto sigue vivo durante el outage (no toca al clasificador)', async () => {
  const { deps, classifierCalls } = makeDeps({ failureReason: 'api' });
  const r = await dispatch('AWAITING_CONFIRMATION', makeMsg('si'), awaitingCtx(), deps);

  // Confirma por keyword — el clasificador caído ni se consulta. (El estado
  // final depende del INSERT de la cita, que este fake no simula; lo que se
  // blinda aquí es que el fast path avanza sin clasificador y sin hiccup.)
  assert.equal(classifierCalls.length, 0);
  assert.notEqual(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  assert.notEqual(r.newState, 'AWAITING_CONFIRMATION');
});

// ─── 2. Pasivo de recordatorios: outage consume el turno, sin doble llamada ──

test('outage en el pasivo (cita <3h, mensaje ambiguo): hiccup y el estado se queda donde estaba', async () => {
  const { deps, rpcCalls, classifierCalls } = makeDeps({ failureReason: 'timeout', withSoonAppt: true });
  const r = await dispatch('GREETING', makeMsg('ehh este'), { customerId: CUST }, deps);

  assert.equal(r.responseText, TECHNICAL_HICCUP_MESSAGE);
  // El estado NO se mueve (antes el fallthrough re-corría el turno en el
  // router normal contra el mismo clasificador caído).
  assert.equal(r.newState, 'GREETING');
  // Una sola llamada al clasificador (la del pasivo) — sin segunda ronda.
  assert.equal(classifierCalls.length, 1);
  // La cita quedó intacta: ni confirmación ni cancelación por un timeout.
  assert.equal(rpcCalls.length, 0);
});

test('el fast path por keywords del recordatorio ("no voy") sigue vivo en outage', async () => {
  const { deps, rpcCalls, classifierCalls } = makeDeps({ failureReason: 'api', withSoonAppt: true });
  const r = await dispatch('GREETING', makeMsg('no voy'), { customerId: CUST }, deps);

  // Cancela por keyword sin consultar al clasificador caído.
  assert.equal(classifierCalls.length, 0);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.fn, 'bot_set_appointment_status');
  assert.notEqual(r.responseText, TECHNICAL_HICCUP_MESSAGE);
});
