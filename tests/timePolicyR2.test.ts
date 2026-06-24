// ─── Política única de hora del FSM (R2 · Pieza C2 / P3b) ─────────────────────
// Verifica, a través del choke-point real `dispatch()` (donde interpret() corre
// 1×/turno), que la HORA se resuelve con UNA sola política en todo el FSM:
//
//   - Intención de agendar SIN fecha → NO se inventa "hoy": se pregunta el día.
//   - Hora con período explícito ("7 pm" espaciado, "5pm" pegado) → se resuelve
//     (19:00 / 17:00), no se pierde por falta de día ni se pregunta período.
//   - Hora 1–6 EN PUNTO SIN marcador ("a las 5") → NO se adivina PM: se pregunta
//     el período y la hora se APARCA hasta la respuesta.
//   - greeting y qualifyingDatetime usan el MISMO parser + la MISMA política
//     (P3b borró el parseTime propio de greeting): "a las 7 pm" en greeting
//     resuelve a 19:00 igual que en datetime.
//
// Determinista: Supabase fake (sin red) + classifier que nunca reconoce nada
// (fuerza los fast-paths deterministas). Sin Anthropic (anthropicKey='').

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { weekdayFromDateStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ  = 'America/Mexico_City';
const NOW = new Date('2026-07-06T15:00:00.000Z'); // lunes ~09:00 local

const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);

// ─── Fakes (sin red) ──────────────────────────────────────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tables: TableData) {
  let seq = 0;
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    let inserted: { id: string } | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      insert: () => { seq += 1; inserted = { id: `${table}-${seq}` }; return builder; },
      update: () => builder,
      single:      () => Promise.resolve({ data: inserted ?? rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

function availRow(staffId: string) {
  return { staff_id: staffId, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null };
}

function tables(): TableData {
  return {
    customers: [],
    services: [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff: [
      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] },
      { id: ANDRES, name: 'Andrés', whatsapp_id: '5210000000002', staff_services: [{ service_id: SVC }] },
    ],
    staff_availability:        [availRow(CARLOS), availRow(ANDRES)],
    appointments: [], staff_blocks: [], staff_schedule_exceptions: [],
    staff_services: [{ staff_id: CARLOS, service_id: SVC }, { staff_id: ANDRES, service_id: SVC }],
  };
}

// Classifier "ciego": nunca reconoce nada → fuerza los fast-paths deterministas.
function makeClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}

function makeDeps() {
  const business = {
    id:                    `biz-tp-${Math.random().toString(36).slice(2)}`,
    name:                  'Barbería Demo',
    whatsappNumber:        '5210000000000',
    whatsappPhoneNumberId: 'pnid-1',
    botName:               'Zlot',
    awayMessage:           'Cerrado.',
    fallbackMessage:       'Te comunico con el equipo.',
    officeHours:           null,
    walkInBufferMinutes:   60,
    address:               'Calle 1',
    timezone:              TZ,
  };
  return { business, supabase: makeSupabase(tables()), anthropicKey: '', model: 'haiku', classifier: makeClassifier() } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     `wamid.${Math.random().toString(36).slice(2)}`,
  } as never;
}

// ─── 1. Agendar sin fecha → no inventa "hoy", pregunta el día ──────────────────

test('"con el que sea" sin fecha → no inventa hoy: pregunta el día (QUALIFYING_DATETIME)', async () => {
  const r = await dispatch('QUALIFYING_STAFF', makeMsg('con el que sea'), { serviceId: SVC }, makeDeps());
  assert.equal(r.newState, 'QUALIFYING_DATETIME');
  assert.equal(r.newContext.requestedDate, undefined, 'no debe inventar una fecha');
  assert.equal(r.newContext.autoAssign, true);
  assert.ok(/d[ií]a/i.test(r.responseText ?? ''), 'debe preguntar por el día');
});

// ─── 2. Hora con período explícito + fecha en el mismo turno → captura 19:00 ───

test('"mañana a las 7 pm" → captura 19:00 (no 07:00) y avanza con la fecha', async () => {
  const r = await dispatch(
    'QUALIFYING_DATETIME',
    makeMsg('mañana a las 7 pm'),
    { serviceId: SVC, staffId: CARLOS },
    makeDeps(),
  );
  assert.equal(r.newContext.requestedTime, '19:00', 'pm explícito → 19:00');
  assert.equal(r.newContext.requestedDate, REQ_DATE);
  assert.notEqual(r.newState, 'FALLBACK');
  assert.notEqual(r.newState, 'ESCALATED');
});

// ─── 3. "5pm" pegado sin fecha → PM explícito (17:00), no pregunta período ─────
// El intérprete reconoce el marcador "pm" PEGADO al dígito (lookbehind negativo
// de letra) → period 'pm' → resolveInterpretedTime: 5+12 = 17:00. Decisión de
// producto: "5pm" es inequívocamente PM, no se aparca ni se pregunta. (Distinto
// de "a las 5" sin marcador, que SÍ es ambiguo — ver caso 4.) Falta la fecha →
// captura la hora y pregunta SOLO el día.

test('"5pm" pegado sin fecha → PM explícito 17:00 (no pregunta período)', async () => {
  const r = await dispatch(
    'QUALIFYING_DATETIME',
    makeMsg('5pm'),
    { serviceId: SVC, staffId: CARLOS },
    makeDeps(),
  );
  assert.equal(r.newState, 'QUALIFYING_DATETIME');
  assert.equal(r.newContext.requestedTime, '17:00', 'pm pegado → 17:00 directo');
  assert.equal(r.newContext.pendingPeriodTime, undefined, 'no aparca: el período es explícito');
  assert.equal(r.newContext.requestedDate, undefined, 'no inventa fecha');
  assert.ok(/d[ií]a/i.test(r.responseText ?? ''), 'debe preguntar por el día');
});

// ─── 4. "a las 5" ambiguo sin período → APARCA y difiere a la AGENDA (FIX 2) ────
// CAMBIO DELIBERADO de comportamiento: antes 1–6 en punto PREGUNTABA el período
// ("¿mañana o tarde?") y aparcaba en pendingPeriodTime. Ahora UNIFICA con 7–11:
// difiere a la agenda real (pendingAgendaTime) y, sin fecha, pregunta el DÍA. La
// desambiguación AM/PM la hace la agenda en SHOWING_SLOTS (Carlos 10–20 → 17:00),
// no una pregunta de entrada.

test('"a las 5" sin período → NO pregunta período: aparca en agenda y pregunta el día (FIX 2)', async () => {
  const deps = makeDeps();
  const r1 = await dispatch(
    'QUALIFYING_DATETIME',
    makeMsg('a las 5'),
    { serviceId: SVC, staffId: CARLOS },
    deps,
  );
  assert.equal(r1.newState, 'QUALIFYING_DATETIME');
  assert.deepEqual(r1.newContext.pendingAgendaTime, { hour: 5, minute: 0 }, 'aparca cruda para la agenda');
  assert.equal(r1.newContext.pendingPeriodTime, undefined, 'ya NO usa el ask de período');
  assert.equal(r1.newContext.requestedTime, undefined, 'no hornea un PM/AM falso');
  assert.ok(/d[ií]a/i.test(r1.responseText ?? ''), 'pregunta el DÍA, no mañana/tarde');
  assert.ok(!/ma[ñn]ana o.*tarde/i.test(r1.responseText ?? ''), 'NO pregunta el período');

  // Turno siguiente: con el día, SHOWING_SLOTS resuelve la hora contra la agenda de
  // Carlos (10–20) → 17:00 (5pm gana: tiene slot real, 5am no).
  const r2 = await dispatch('QUALIFYING_DATETIME', makeMsg('mañana'), r1.newContext, deps);
  assert.equal(r2.newContext.requestedTime, '17:00', 'la agenda desambigua 5 → 17:00');
  assert.equal(r2.newContext.pendingAgendaTime, undefined, 'la hora aparcada se libera al resolver');
});

// ─── 5. Política única: greeting resuelve "a las 7 pm" igual que datetime (19:00) ─
// Antes greeting tenía su propio parseTime (adivinaba 1–6→PM, divergiendo de
// datetime). Tras P3b greeting consume el MISMO intérprete + la MISMA política:
// "a las 7 pm" (period pm explícito) → 19:00, idéntico a QUALIFYING_DATETIME.

test('política única: "a las 7 pm" en GREETING resuelve a 19:00 (mismo parser que datetime)', async () => {
  const r = await dispatch('GREETING', makeMsg('a las 7 pm'), {}, makeDeps());
  assert.equal(r.newContext.requestedTime, '19:00', 'greeting usa la misma resolución de hora');
});

// ─── 6. FIX 2 (browse, red→green): "a las 8" en QUALIFYING_DATETIME → 20:00, NO 8am ─
// El smoke exacto: el cliente dice "a las 8" en el browse de un barbero. En main esto
// se horneaba a 08:00 (regla h>=7) y el bot ofrecía la mañana. Ahora difiere a la
// agenda: "mañana a las 8" + barbero (10–20) → la hora se resuelve a 20:00 (8pm gana,
// tiene slot más cercano que 8am) al encadenar a SHOWING_SLOTS. ROJO en main (08:00).

test('FIX 2 (browse): "mañana a las 8" + barbero → 20:00 (no 08:00) vía agenda', async () => {
  const r = await dispatch(
    'QUALIFYING_DATETIME',
    makeMsg('mañana a las 8'),
    { serviceId: SVC, staffId: ANDRES },
    makeDeps(),
  );
  assert.equal(r.newContext.requestedTime, '20:00', 'la agenda desambigua 8 → 20:00 (8pm)');
  assert.notEqual(r.newContext.requestedTime, '08:00', 'NUNCA hornea 8am (el bug viejo)');
  assert.equal(r.newContext.pendingAgendaTime, undefined, 'la hora aparcada se resolvió');
});
