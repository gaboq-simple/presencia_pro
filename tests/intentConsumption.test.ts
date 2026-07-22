// ─── Deuda #1 (punto #3 de S4-BOT-09): consumir el TIPO de intent ─────────────
// handleClassification solo miraba confidence — el tipo se tiraba:
//   - DATE_PREFERENCE 0.95 ("para el viernes") en QUALIFYING_SERVICE caía en
//     ADVANCE → findMatchingServices("viernes") = [] → REPEAT_OPTIONS y la
//     fecha se DESCARTABA ("te dije el viernes").
//   - CONFIRM_NO 0.95 ("no, mejor nada gracias") caía al menú en bucle.
//   - La matriz de correcciones era asimétrica: fecha suelta en
//     QUALIFYING_STAFF se perdía.
//
// Ahora: DATE_HINT (persistir la fecha, validada por el parseo determinista
// del intérprete, sin gastar clarify) y DECLINED (salida cálida del flujo).
// Además los advances de servicio ABSORBEN la fecha del mensaje.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import type { IntentClassification, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/classifier';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City';
const NOW    = new Date('2026-07-20T18:00:00.000Z');   // lunes 12:00 local
const SVC_A  = '22222222-2222-4222-8222-222222222222';
const SVC_B  = '55555555-5555-4555-8555-555555555555';
const CARLOS = '11111111-1111-4111-8111-111111111111';
const ANDRES = '33333333-3333-4333-8333-333333333333';
const PHONE  = '5215500000000';

const VIERNES = parseDate('el viernes', NOW, TZ)!;      // 2026-07-24
const JUEVES  = parseDate('el jueves', NOW, TZ)!;       // 2026-07-23

// ─── Fake Supabase (no filtrante — estados de qualifying no lo requieren) ────

type Row = Record<string, unknown>;
type TableData = Record<string, Row[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const rows = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
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

let bizCounter = 0;
function makeDeps(single: IntentClassification, opts?: { oneService?: boolean }) {
  bizCounter += 1;
  const bizId = `biz-ic-${bizCounter}`;
  const business = {
    id: bizId, name: 'Barbería Demo', whatsappNumber: '5210000000000',
    whatsappPhoneNumberId: 'pnid-1', botName: 'Asistente', awayMessage: 'Cerrado.',
    fallbackMessage: 'No te entendí bien.', officeHours: null,
    walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  const tablesData: TableData = {
    customers: [],
    services: [
      { id: SVC_A, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' },
      ...(opts?.oneService ? [] : [{ id: SVC_B, name: 'Afeitado', description: null, duration_minutes: 20, price: 150, currency: 'MXN' }]),
    ],
    staff: [
      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC_A }] },
      { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002', staff_services: [{ service_id: SVC_A }] },
    ],
    staff_services: [
      { staff_id: CARLOS, service_id: SVC_A },
      { staff_id: ANDRES, service_id: SVC_A },
    ],
    bot_logs: [],
  };
  return {
    business,
    supabase:     makeSupabase(tablesData),
    anthropicKey: '',
    model:        'haiku',
    classifier: {
      classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
      classifyIntent:      async (): Promise<IntentClassification> => single,
    },
  } as never;
}

function makeMsg(body: string): never {
  return {
    businessId: 'biz', customerPhone: PHONE, customerName: null,
    body, timestamp: NOW, messageId: 'wamid.ic-test',
  } as never;
}

const DATE_PREF = (value: string, confidence = 0.9): IntentClassification =>
  ({ intent: 'DATE_PREFERENCE', confidence, value, side_question_answer: null });

// ─── 1. REPRO: la fecha dicha al elegir servicio ya no se tira ───────────────

test('QUALIFYING_SERVICE + "para el viernes" → fecha PERSISTIDA + re-pregunta sin gastar clarify', async () => {
  const deps = makeDeps(DATE_PREF('el viernes'));
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('para el viernes'), {}, deps);

  // Antes: ADVANCE → findMatchingServices('viernes')=[] → menú y fecha tirada.
  assert.equal(r.newState, 'QUALIFYING_SERVICE');
  assert.equal(r.newContext.requestedDate, VIERNES);
  assert.match(r.responseText, /viernes.*¿Qué servicio/s);
  assert.ok(!r.newContext.clarification_attempts);   // dar una fecha no es confusión
});

// ─── 2. La fecha persiste hasta el advance: no se re-pregunta después ────────

test('tras el DATE_HINT, elegir servicio conserva la fecha (QUALIFYING_STAFF la hereda)', async () => {
  const deps = makeDeps(DATE_PREF('el viernes'));
  const r1 = await dispatch('QUALIFYING_SERVICE', makeMsg('para el viernes'), {}, deps);
  const r2 = await dispatch('QUALIFYING_SERVICE', makeMsg('corte'), r1.newContext, deps);

  assert.equal(r2.newState, 'QUALIFYING_STAFF');
  assert.equal(r2.newContext.requestedDate, VIERNES);   // la fecha viajó
});

// ─── 3. Asimetría curada: fecha suelta en QUALIFYING_STAFF ───────────────────

test('QUALIFYING_STAFF + "mejor el jueves" → fecha persistida + re-pregunta de barbero', async () => {
  const deps = makeDeps(DATE_PREF('mejor el jueves'));
  const ctx = { serviceId: SVC_A };
  const r = await dispatch('QUALIFYING_STAFF', makeMsg('mejor el jueves'), ctx, deps);

  assert.equal(r.newState, 'QUALIFYING_STAFF');
  assert.equal(r.newContext.requestedDate, JUEVES);
  assert.match(r.responseText, /jueves.*Con quién/s);
});

// ─── 4. El advance de servicio ABSORBE la fecha del mismo mensaje ────────────

test('ADVANCE del clasificador con fecha en el mensaje → servicio + fecha juntos', async () => {
  // "corte para el viernes": el clasificador extrae el servicio (SELECT_OPTION)
  // y el intérprete la fecha — el advance ABSORBE ambas (antes la fecha se tiraba).
  const deps = makeDeps({ intent: 'SELECT_OPTION', confidence: 0.9, value: 'corte', side_question_answer: null });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('corte para el viernes'), {}, deps);

  assert.equal(r.newState, 'QUALIFYING_STAFF');
  assert.equal(r.newContext.serviceId, SVC_A);
  assert.equal(r.newContext.requestedDate, VIERNES);
});

// ─── 5. CONFIRM_NO claro → salida cálida, no bucle de menú ───────────────────

test('QUALIFYING_SERVICE + "no, mejor nada gracias" (CONFIRM_NO 0.9) → salida cálida', async () => {
  const deps = makeDeps({ intent: 'CONFIRM_NO', confidence: 0.9, value: null, side_question_answer: null });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('no, mejor nada gracias'), {}, deps);

  // Antes: ADVANCE con value null → menú de servicios otra vez, en bucle.
  assert.equal(r.newState, 'GREETING');
  assert.match(r.responseText, /Sin problema/);
  assert.doesNotMatch(r.responseText, /1\.|servicio te interesa/);
});

// ─── 6. Contrastes: umbrales y estado excluido ───────────────────────────────

test('DATE_PREFERENCE con confianza baja (<0.60) NO dispara el hint (clarify normal)', async () => {
  const deps = makeDeps(DATE_PREF('para el viernes', 0.4));
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('para el viernes'), {}, deps);

  assert.ok(!r.newContext.requestedDate);
  assert.equal(r.newContext.clarification_attempts, 1);   // camino viejo intacto
});

test('CONFIRM_NO con confianza media NO declina (el "no" ambiguo sigue al funnel)', async () => {
  const deps = makeDeps({ intent: 'CONFIRM_NO', confidence: 0.7, value: null, side_question_answer: null });
  const r = await dispatch('QUALIFYING_SERVICE', makeMsg('no se'), {}, deps);

  assert.notEqual(r.newState, 'GREETING');
});
