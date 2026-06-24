// ─── FIX 2: resolución de hora ambigua contra la AGENDA real ──────────────────
// Unifica 1–6 y 7–11: toda hora EN PUNTO sin marcador am/pm es ambigua (8 = 8am ó
// 8pm) y se DIFIERE a la agenda real (defer-agenda → pendingAgendaTime), que la
// desambigua por el slot más cercano. NO se adivina AM ni se pregunta de entrada.
//
// Capas probadas:
//   - resolveInterpretedTime: produce el kind correcto (resolved | defer-agenda).
//   - applyTimeRes: POLÍTICA ÚNICA de consumo (greeting === qualifyingDatetime).
//   - resolveParkedHour: alimenta shape.all a resolveTargetMinutes (sin tocarla).
//   - Round-trip Zod: pendingAgendaTime sobrevive serialize/deserialize.
//   - dispatch: ambas entradas (GREETING y QUALIFYING_DATETIME) parkean idéntico.
//
// Determinista: Supabase fake (sin red), classifier ciego, sin Anthropic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveInterpretedTime,
  applyTimeRes,
  parseDate,
} from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import { resolveParkedHour } from '../packages/engine/src/bot/lifestyle/states/slotPresentation';
import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { serializeContext, deserializeContext } from '../packages/engine/src/bot/lifestyle/context';
import { weekdayFromDateStr, localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { SlotCandidate } from '../packages/engine/src/bot/lifestyle/types';
import type { MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';

const TZ  = 'America/Mexico_City';
const NOW = new Date('2026-07-06T15:00:00.000Z'); // lunes ~09:00 local
const DATE_STR = '2026-07-07';                    // martes (REQ_DATE de "mañana")
const REQ_DATE = parseDate('mañana', NOW, TZ)!;
const DOW      = weekdayFromDateStr(REQ_DATE);

const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';

// ─── 1. resolveInterpretedTime: kinds correctos ───────────────────────────────

test('resolveInterpretedTime: 1–11 EN PUNTO sin período → defer-agenda (8 = 8am ó 8pm)', () => {
  for (const h of [1, 5, 6, 7, 8, 11]) {
    assert.deepEqual(
      resolveInterpretedTime({ hour: h, minute: 0, period: null }),
      { kind: 'defer-agenda', hour: h, minute: 0 },
      `${h}:00 sin marcador debe diferir a la agenda`,
    );
  }
});

test('resolveInterpretedTime: con minutos → reloj 24h literal (NO ambiguo)', () => {
  assert.deepEqual(resolveInterpretedTime({ hour: 8, minute: 30, period: null }), { kind: 'resolved', hhmm: '08:30' });
  assert.deepEqual(resolveInterpretedTime({ hour: 10, minute: 15, period: null }), { kind: 'resolved', hhmm: '10:15' });
});

test('resolveInterpretedTime: 12 / 0 / 13–23 → inequívocos (resolved)', () => {
  assert.deepEqual(resolveInterpretedTime({ hour: 12, minute: 0, period: null }), { kind: 'resolved', hhmm: '12:00' });
  assert.deepEqual(resolveInterpretedTime({ hour: 0,  minute: 0, period: null }), { kind: 'resolved', hhmm: '00:00' });
  assert.deepEqual(resolveInterpretedTime({ hour: 19, minute: 0, period: null }), { kind: 'resolved', hhmm: '19:00' });
});

test('resolveInterpretedTime: período explícito → resolved (se respeta)', () => {
  assert.deepEqual(resolveInterpretedTime({ hour: 5, minute: 0, period: 'pm' }), { kind: 'resolved', hhmm: '17:00' });
  assert.deepEqual(resolveInterpretedTime({ hour: 8, minute: 0, period: 'am' }), { kind: 'resolved', hhmm: '08:00' });
  assert.deepEqual(resolveInterpretedTime({ hour: 12, minute: 0, period: 'am' }), { kind: 'resolved', hhmm: '00:00' });
});

// ─── 2. applyTimeRes: política única de consumo ───────────────────────────────

test('applyTimeRes: resolved → requestedTime; defer-agenda → pendingAgendaTime', () => {
  assert.deepEqual(applyTimeRes({ kind: 'resolved', hhmm: '17:00' }), { requestedTime: '17:00' });
  assert.deepEqual(applyTimeRes({ kind: 'defer-agenda', hour: 8, minute: 0 }), { pendingAgendaTime: { hour: 8, minute: 0 } });
  assert.equal(applyTimeRes(null), null);
});

// ─── 3. resolveParkedHour: desambigua contra la agenda real ───────────────────

function slotAt(hhmm: string): SlotCandidate {
  const startsAt = localTimeToUTC(DATE_STR, hhmm, TZ);
  return { staffId: 's1', staffName: 'X', startsAt, endsAt: startsAt };
}

test('resolveParkedHour: "a las 8" + agenda hasta 21:00 → 20:00 (NO 8am)', () => {
  // Agenda con un slot real a las 20:00 → 8pm gana sobre 8am.
  const agenda = ['12:00', '14:00', '17:00', '20:00'].map(slotAt);
  const res = resolveParkedHour({ hour: 8, minute: 0 }, agenda, TZ);
  assert.deepEqual(res, { kind: 'resolved', hhmm: '20:00', minutes: 20 * 60 });
});

test('resolveParkedHour: "a las 5" + agenda solo de mañana → 5 AM (no fuerza PM)', () => {
  const agenda = ['08:00', '09:00', '10:00'].map(slotAt);
  const res = resolveParkedHour({ hour: 5, minute: 0 }, agenda, TZ);
  assert.equal(res.kind, 'resolved');
  assert.equal(res.kind === 'resolved' && res.hhmm, '05:00');
});

test('resolveParkedHour: agenda VACÍA → ask (último recurso, nunca asume AM)', () => {
  assert.deepEqual(resolveParkedHour({ hour: 8, minute: 0 }, [], TZ), { kind: 'ask' });
});

// ─── 4. Round-trip Zod: pendingAgendaTime sobrevive ───────────────────────────

test('round-trip: pendingAgendaTime sobrevive serialize/deserialize (está en el schema)', () => {
  const ctx: LifestyleBotContext = { requestedDate: DATE_STR, pendingAgendaTime: { hour: 8, minute: 0 } };
  const restored = deserializeContext(serializeContext(ctx));
  assert.deepEqual(restored.pendingAgendaTime, { hour: 8, minute: 0 });
});

// ─── 5. Política única vía dispatch: GREETING === QUALIFYING_DATETIME ──────────
// Si divergen, vuelve el bug de "greeting adivina distinto". Ambas entradas
// consumen applyTimeRes → "a las 8" parkea idéntico en pendingAgendaTime={8,0}.

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
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from } as never;
}
function makeClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}
function makeDeps(): never {
  const business = {
    id: 'biz-agt', name: 'Barbería Demo', whatsappNumber: '5210000000000', whatsappPhoneNumberId: 'pnid-1',
    botName: 'Zlot', awayMessage: 'Cerrado.', fallbackMessage: 'Te comunico con el equipo.',
    officeHours: null, walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  const tables: TableData = {
    customers: [],
    services:  [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:     [{ id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] }],
    staff_availability: [{ staff_id: CARLOS, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments: [], staff_blocks: [], staff_schedule_exceptions: [],
    staff_services: [{ staff_id: CARLOS, service_id: SVC }],
  };
  return { business, supabase: makeSupabase(tables), anthropicKey: '', model: 'haiku', classifier: makeClassifier() } as never;
}
function msg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: NOW, messageId: `wamid.${body}` } as never;
}

test('política única: "a las 8" parkea IGUAL en GREETING y en QUALIFYING_DATETIME', async () => {
  const g = await dispatch('GREETING', msg('a las 8'), {}, makeDeps());
  const d = await dispatch('QUALIFYING_DATETIME', msg('a las 8'), { serviceId: SVC, staffId: CARLOS }, makeDeps());
  assert.deepEqual(g.newContext.pendingAgendaTime, { hour: 8, minute: 0 }, 'GREETING parkea {8,0}');
  assert.deepEqual(d.newContext.pendingAgendaTime, { hour: 8, minute: 0 }, 'QUALIFYING_DATETIME parkea {8,0}');
  assert.deepEqual(g.newContext.pendingAgendaTime, d.newContext.pendingAgendaTime, 'misma política, mismo resultado');
  // Ninguna hornea un requestedTime falso.
  assert.equal(g.newContext.requestedTime, undefined);
  assert.equal(d.newContext.requestedTime, undefined);
});
