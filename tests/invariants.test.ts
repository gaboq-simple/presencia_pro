// ─── Malla de invariantes estructurales (R1 · Pieza C) ────────────────────────
// Blindan PROPIEDADES globales del FSM, no instancias de bug. Estos tests deben
// fallar si un refactor (R2/R3) rompe una propiedad transversal.
//
// Inv. 1 — No-bucle / progreso-o-escape (wrapper dispatch() + STRUCTURAL_CAP).
// Inv. 2 — Toda salida no vacía es coherente con el estado (≤1 "?", sin saludo
//          con history no vacío).
// Inv. 3 — Caso "A las 10:15" (Q4b producción): VERDE desde R2 (intérprete).
// Inv. 4 — Exclusión de banderas efímeras: nearestOfferSlot × pendingDigitDisambig
//          nunca ambas no-nulas tras un dispatch().
//
// Reglas R1: si Inv. 1/2/4 fallan con el código ACTUAL → hallazgo a documentar,
// NO test a ajustar. Sin red (Supabase + classifier fakes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, STRUCTURAL_CAP } from '../packages/engine/src/bot/lifestyle/router';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { weekdayFromDateStr } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type {
  LifestyleBotContext,
  LifestyleBotState,
  LifestylePendingSlot,
} from '../packages/engine/src/types/lifestyle.types';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ  = 'America/Mexico_City';
const NOW = new Date('2026-07-06T15:00:00.000Z');

const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);

// Estados de la costura de agendamiento (espejo de BOOKING_STATES en router.ts —
// no exportado). Un estado FUERA de este set = escape/terminal.
const BOOKING_STATES: ReadonlySet<LifestyleBotState> = new Set<LifestyleBotState>([
  'QUALIFYING_SERVICE',
  'QUALIFYING_STAFF',
  'QUALIFYING_DATETIME',
  'SHOWING_SLOTS',
  'QUALIFYING_WAITLIST',
  'CONFIRMING_APPOINTMENT',
  'AWAITING_CONFIRMATION',
  'AWAITING_BOOKING_NAME',
]);

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
    customers: [], // vacío → greeting siempre inserta + confirmationResponse corta a null
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

// El classifier nunca reconoce nada → fuerza los fast-paths deterministas o el
// clarify (que es justo lo que las invariantes 1/2 quieren ejercitar).
function makeClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}

function makeDeps() {
  const business = {
    id:                    `biz-inv-${Math.random().toString(36).slice(2)}`, // único → aísla cache de catálogo
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

function seededHistory(): LifestyleBotContext['messages'] {
  return [
    { role: 'user',      content: 'hola, quiero una cita' },
    { role: 'assistant', content: 'Claro, con gusto te ayudo.' },
  ];
}

function slotPair(): LifestylePendingSlot[] {
  return [
    { index: 1, staffId: CARLOS, staffName: 'Carlos', startsAt: `${REQ_DATE}T16:00:00.000Z`, endsAt: `${REQ_DATE}T16:30:00.000Z` },
    { index: 2, staffId: CARLOS, staffName: 'Carlos', startsAt: `${REQ_DATE}T17:00:00.000Z`, endsAt: `${REQ_DATE}T17:30:00.000Z` },
  ];
}

// ─── Inv. 1 — No-bucle / progreso-o-escape ────────────────────────────────────
// Alimentar basura en bucle a un estado de agendamiento SIEMPRE termina fuera de
// la costura (escape/terminal) dentro de STRUCTURAL_CAP turnos. Nunca itera
// indefinidamente en estados de booking.

async function runGarbageUntilEscape(
  startState: LifestyleBotState,
  startCtx:   LifestyleBotContext,
): Promise<{ finalState: LifestyleBotState; trail: LifestyleBotState[] }> {
  const deps = makeDeps();
  let state = startState;
  let ctx   = startCtx;
  const trail: LifestyleBotState[] = [];
  // STRUCTURAL_CAP + holgura: el wrapper escala a más tardar en STRUCTURAL_CAP turnos.
  for (let i = 0; i < STRUCTURAL_CAP + 2; i++) {
    const r = await dispatch(state, makeMsg(`zxqwk${i}vbnm`), ctx, deps);
    trail.push(r.newState);
    state = r.newState;
    ctx   = r.newContext;
    if (!BOOKING_STATES.has(state)) break;
  }
  return { finalState: state, trail };
}

const GARBAGE_CASES: Array<{ name: string; state: LifestyleBotState; ctx: LifestyleBotContext }> = [
  { name: 'QUALIFYING_SERVICE',     state: 'QUALIFYING_SERVICE',     ctx: {} },
  { name: 'QUALIFYING_STAFF',       state: 'QUALIFYING_STAFF',       ctx: { serviceId: SVC } },
  { name: 'QUALIFYING_DATETIME',    state: 'QUALIFYING_DATETIME',    ctx: { serviceId: SVC, staffId: CARLOS } },
  { name: 'CONFIRMING_APPOINTMENT', state: 'CONFIRMING_APPOINTMENT', ctx: { serviceId: SVC, staffId: CARLOS, requestedDate: REQ_DATE, pendingSlots: slotPair() } },
];

for (const c of GARBAGE_CASES) {
  test(`Inv.1 no-bucle: ${c.name} con basura escapa dentro de STRUCTURAL_CAP`, async () => {
    const { finalState, trail } = await runGarbageUntilEscape(c.state, c.ctx);
    assert.ok(
      !BOOKING_STATES.has(finalState),
      `${c.name} no escapó de la costura de agendamiento en ${STRUCTURAL_CAP} turnos; ` +
      `quedó en ${finalState}. Trayecto: ${trail.join(' → ')}`,
    );
  });
}

// ─── Inv. 2 — Salida coherente con el estado ──────────────────────────────────
// Para una batería de inputs con history no vacío: responseText nunca tiene dos
// "?" (proxy de dos preguntas) ni un saludo ("hola"/"buenas"/…).

const GREETING_RE = /\b(hola+|buenas|buen[oa]s?\s+(?:d[ií]as|tardes|noches)|buen\s+d[ií]a|qué onda|que onda)\b/i;

function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

const COHERENCE_CASES: Array<{ name: string; state: LifestyleBotState; body: string; ctx: LifestyleBotContext }> = [
  { name: 'QUALIFYING_STAFF · elige barbero',        state: 'QUALIFYING_STAFF',       body: 'Carlos',     ctx: { serviceId: SVC, messages: seededHistory() } },
  { name: 'QUALIFYING_DATETIME · da fecha',          state: 'QUALIFYING_DATETIME',    body: 'mañana',     ctx: { serviceId: SVC, staffId: CARLOS, messages: seededHistory() } },
  { name: 'QUALIFYING_DATETIME · basura (clarify)',  state: 'QUALIFYING_DATETIME',    body: 'zxqwkvbnm', ctx: { serviceId: SVC, staffId: CARLOS, messages: seededHistory() } },
  { name: 'CONFIRMING · elige opción',               state: 'CONFIRMING_APPOINTMENT', body: 'la primera', ctx: { serviceId: SVC, staffId: CARLOS, requestedDate: REQ_DATE, pendingSlots: slotPair(), messages: seededHistory() } },
  { name: 'CONFIRMING · basura (clarify)',           state: 'CONFIRMING_APPOINTMENT', body: 'zxqwkvbnm', ctx: { serviceId: SVC, staffId: CARLOS, requestedDate: REQ_DATE, pendingSlots: slotPair(), messages: seededHistory() } },
];

for (const c of COHERENCE_CASES) {
  test(`Inv.2 coherencia: ${c.name} — sin doble "?" ni saludo con history`, async () => {
    const deps = makeDeps();
    const r = await dispatch(c.state, makeMsg(c.body), c.ctx, deps);
    const text = r.responseText ?? '';
    if (text.trim().length === 0) return; // salida vacía (encadenada): nada que verificar

    assert.ok(
      countQuestionMarks(text) <= 1,
      `Salida con más de un "?" (dos preguntas en un mensaje) en ${c.name}: ${JSON.stringify(text)}`,
    );
    assert.ok(
      !GREETING_RE.test(text),
      `Salida con saludo pese a history no vacío en ${c.name}: ${JSON.stringify(text)}`,
    );
  });
}

// ─── Inv. 3 — Caso "A las 10:15" (Q4b producción) — VERDE desde R2 ─────────────
// Una hora pura sin día NO debe perderse ni escalar: el intérprete (R2) CAPTURA
// la hora (extractRawTime → resolveInterpretedTime: minutos>0 → literal "10:15")
// y, al faltar el día, lo guarda en requestedTime y pregunta SOLO el día
// (qualifyingDatetime C2.1), sin UNCLEAR/FALLBACK. Antes el classifier la marcaba
// UNCLEAR (conf 0.6) → bug. Invertido a verde en R2 C2.
test('Inv.3 "A las 10:15" captura la hora sin UNCLEAR (VERDE desde R2)', async () => {
  const deps = makeDeps();
  const r = await dispatch('QUALIFYING_DATETIME', makeMsg('A las 10:15'), { serviceId: SVC, staffId: CARLOS }, deps);

  // La hora queda capturada como dato neutral.
  assert.equal(r.newContext.requestedTime, '10:15', 'la hora 10:15 debe capturarse en requestedTime');
  // Y nunca se pierde escalando ni cayendo a fallback por "no entendí".
  assert.notEqual(r.newState, 'FALLBACK');
  assert.notEqual(r.newState, 'ESCALATED');
});

// ─── Inv. 4 — Exclusión nearestOfferSlot × pendingDigitDisambig ────────────────
// Tras CUALQUIER dispatch(), ambas banderas nunca quedan no-nulas a la vez.

function assertFlagExclusion(ctx: LifestyleBotContext, label: string): void {
  const both = ctx.nearestOfferSlot != null && ctx.pendingDigitDisambig != null;
  assert.ok(
    !both,
    `Colisión de banderas efímeras en ${label}: ` +
    `nearestOfferSlot=${JSON.stringify(ctx.nearestOfferSlot)} ` +
    `pendingDigitDisambig=${JSON.stringify(ctx.pendingDigitDisambig)}`,
  );
}

const EXCLUSION_CASES: Array<{ name: string; body: string; ctx: LifestyleBotContext }> = [
  {
    name: 'pendingDigitDisambig + "sí" (→ offer_nearest)',
    body: 'sí',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair(), pendingDigitDisambig: { requestedMinutes: 600, indexChoice: 1 } },
  },
  {
    name: 'pendingDigitDisambig + "no" (→ índice)',
    body: 'no',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair(), pendingDigitDisambig: { requestedMinutes: 600, indexChoice: 1 } },
  },
  {
    name: 'pendingDigitDisambig + corrección ("a las 5")',
    body: 'a las 5',
    ctx: { serviceId: SVC, staffId: CARLOS, requestedDate: REQ_DATE, pendingSlots: slotPair(), pendingDigitDisambig: { requestedMinutes: 600, indexChoice: 1 } },
  },
  {
    name: 'nearestOfferSlot + "sí" (acepta)',
    body: 'sí',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair(), nearestOfferSlot: `${REQ_DATE}T16:00:00.000Z` },
  },
  {
    name: 'nearestOfferSlot + basura (clarify)',
    body: 'zxqwkvbnm',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair(), nearestOfferSlot: `${REQ_DATE}T16:00:00.000Z` },
  },
  {
    name: 'hora no disponible (→ setea nearestOfferSlot)',
    body: 'a las 6',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair() },
  },
  {
    name: 'dígito (selección por índice)',
    body: '2',
    ctx: { serviceId: SVC, staffId: CARLOS, pendingSlots: slotPair() },
  },
];

for (const c of EXCLUSION_CASES) {
  test(`Inv.4 exclusión: ${c.name}`, async () => {
    const deps = makeDeps();
    const r = await dispatch('CONFIRMING_APPOINTMENT', makeMsg(c.body), c.ctx, deps);
    assertFlagExclusion(r.newContext, c.name);
  });
}
