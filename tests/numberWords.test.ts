// Hallazgo 3 — Números en palabras ("once", "a las nueve") en los parsers
// deterministas. UN normalizador (wordToHour / digitizeNumberWords) consumido por
// extractRawTime, detectBareDigit y el step-4 del browse → palabra ≡ dígito en
// TODOS los caminos. Sin esto, "once" se entendía solo de forma cosmética en el
// mensaje inicial (Haiku en el loop + flujo indulgente) y el browse, estricto y
// 100% determinista, lo rechazaba con "no te seguí bien".
//
// Determinista: Supabase fake (sin red), classifier ciego, sin Anthropic. npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  interpret,
  extractRawTime,
  wordToHour,
} from '../packages/engine/src/bot/lifestyle/interpreter';
import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { dispatch } from '../packages/engine/src/bot/lifestyle/router';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow, MultiIntentClassification } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ   = 'America/Mexico_City'; // UTC-6 fijo (México sin DST)
const DATE = '2026-06-15';          // lunes (DOW 1)
const DOW  = 1;
const NOW  = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const STAFF = '11111111-1111-1111-1111-111111111111';
const SVC   = '22222222-2222-2222-2222-222222222222';

// ════════════════════════════════════════════════════════════════════════════
// 1. Unit del normalizador (wordToHour — token pelado)
// ════════════════════════════════════════════════════════════════════════════

test('wordToHour: "once" → 11', () => {
  assert.equal(wordToHour('once'), 11);
});

test('wordToHour: "tres" → 3 (palabra-número sin colisión, pelada)', () => {
  assert.equal(wordToHour('tres'), 3);
});

test('wordToHour: "veintiuno" → 21', () => {
  assert.equal(wordToHour('veintiuno'), 21);
});

test('wordToHour: "veintitrés" (con acento) → 23', () => {
  assert.equal(wordToHour('veintitrés'), 23);
});

test('wordToHour: "doce" → 12', () => {
  assert.equal(wordToHour('doce'), 12);
});

// "una"/"un" pelados → null: tienen forma de artículo ("una cita"). Sólo cuentan
// como hora CON marcador, lo cual maneja digitizeNumberWords ("la una"→1).
test('wordToHour: "una" (sola) → null (artículo, no la hora 1)', () => {
  assert.equal(wordToHour('una'), null);
});

test('wordToHour: "un" (solo) → null (artículo)', () => {
  assert.equal(wordToHour('un'), null);
});

test('wordToHour: "uno" → 1 (numeral explícito, sin forma de artículo)', () => {
  assert.equal(wordToHour('uno'), 1);
});

test('wordToHour: palabra no-número → null', () => {
  assert.equal(wordToHour('hola'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. extractRawTime / interpret — frases con marcador (palabra → hora real)
// ════════════════════════════════════════════════════════════════════════════

test('extractRawTime: "a las once" → 11:00', () => {
  assert.deepEqual(extractRawTime('a las once'), { hour: 11, minute: 0, explicitPeriod: null });
});

test('extractRawTime: "la una" → 1:00 (marcador "la" desambigua el artículo)', () => {
  assert.deepEqual(extractRawTime('la una'), { hour: 1, minute: 0, explicitPeriod: null });
});

test('extractRawTime: "a la una" → 1:00', () => {
  assert.deepEqual(extractRawTime('a la una'), { hour: 1, minute: 0, explicitPeriod: null });
});

test('extractRawTime: "once y media" → 11:30 (la frase de minuto es marcador)', () => {
  assert.deepEqual(extractRawTime('once y media'), { hour: 11, minute: 30, explicitPeriod: null });
});

test('extractRawTime: "nueve y cuarto" → 9:15', () => {
  assert.deepEqual(extractRawTime('nueve y cuarto'), { hour: 9, minute: 15, explicitPeriod: null });
});

test('extractRawTime: "a las ocho de la tarde" → 8 pm', () => {
  assert.deepEqual(extractRawTime('a las ocho de la tarde'), { hour: 8, minute: 0, explicitPeriod: 'pm' });
});

test('extractRawTime: "mediodía" → 12:00', () => {
  assert.deepEqual(extractRawTime('mediodía'), { hour: 12, minute: 0, explicitPeriod: null });
});

test('extractRawTime: "veintiuno" suelto (sin marcador) → null (no es hora pelada)', () => {
  assert.equal(extractRawTime('veintiuno'), null);
});

// Regresión: el camino de dígitos sigue intacto.
test('extractRawTime: "a las 5" (dígito) sigue → 5:00', () => {
  assert.deepEqual(extractRawTime('a las 5'), { hour: 5, minute: 0, explicitPeriod: null });
});

test('extractRawTime: "10:15" (dígito) sigue → 10:15', () => {
  assert.deepEqual(extractRawTime('10:15'), { hour: 10, minute: 15, explicitPeriod: null });
});

// ─── NO-REGRESIÓN: "una cita" NO es la hora 1 ─────────────────────────────────

test('NO-regresión: "una cita para mañana" → time null (no hora 1)', () => {
  const r = interpret({ message: 'una cita para mañana', now: NOW, timezone: TZ });
  assert.equal(r.time, null);
  assert.equal(r.bareDigit, null);
});

test('NO-regresión: "quiero una cita" → time null', () => {
  assert.equal(extractRawTime('quiero una cita'), null);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Inicial REALMENTE filtra: "cita a las once" parkea {11,0} (no lista el día)
// ════════════════════════════════════════════════════════════════════════════
// Prueba con classifier CIEGO: el parking lo decide extractRawTime (determinista),
// no Haiku. Antes del fix, interpretation.time era null → la hora se descartaba en
// silencio y greeting listaba TODO el día. Ahora difiere {11,0} a la agenda real.

type TableData = Record<string, unknown[]>;
function makeDispatchSupabase(tables: TableData) {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder,
      neq: () => builder, not: () => builder, order: () => builder, limit: () => builder,
      insert: () => builder, update: () => builder,
      single:      () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return { from } as never;
}
function makeBlindClassifier() {
  return {
    classifyMultiIntent: async (): Promise<MultiIntentClassification> => ({ unclear: true }),
    classifyIntent:      async () => ({ intent: 'UNCLEAR' as const, confidence: 0, value: null, side_question_answer: null }),
  };
}
function makeDispatchDeps(): never {
  const business = {
    id: 'biz-nw', name: 'Barbería Demo', whatsappNumber: '5210000000000', whatsappPhoneNumberId: 'pnid-1',
    botName: 'Asistente', awayMessage: 'Cerrado.', fallbackMessage: 'Te comunico con el equipo.',
    officeHours: null, walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  const tables: TableData = {
    customers: [],
    services:  [{ id: SVC, name: 'Corte de cabello', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:     [{ id: STAFF, name: 'Carlos', whatsapp_id: '5210000000001', staff_services: [{ service_id: SVC }] }],
    staff_availability: [{ staff_id: STAFF, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments: [], staff_blocks: [], staff_schedule_exceptions: [],
    staff_services: [{ staff_id: STAFF, service_id: SVC }],
  };
  return { business, supabase: makeDispatchSupabase(tables), anthropicKey: '', model: 'haiku', classifier: makeBlindClassifier() } as never;
}
function dmsg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: NOW, messageId: `wamid.${body}` } as never;
}

test('inicial: "cita a las once" parkea pendingAgendaTime {11,0} (classifier ciego)', async () => {
  const g = await dispatch('GREETING', dmsg('cita a las once'), {}, makeDispatchDeps());
  assert.deepEqual(g.newContext.pendingAgendaTime, { hour: 11, minute: 0 });
  // No hornea un requestedTime falso: 1–11 en punto se difiere a la agenda real.
  assert.equal(g.newContext.requestedTime, undefined);
});

test('inicial: "cita a las once" === "cita a las 11" (palabra ≡ dígito)', async () => {
  const word  = await dispatch('GREETING', dmsg('cita a las once'), {}, makeDispatchDeps());
  const digit = await dispatch('GREETING', dmsg('cita a las 11'),   {}, makeDispatchDeps());
  assert.deepEqual(word.newContext.pendingAgendaTime, digit.newContext.pendingAgendaTime);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Browse (el bug reportado): "Once" tras ofrecer slots → entiende
// ════════════════════════════════════════════════════════════════════════════

const STAFF_ROW: StaffRow = { id: STAFF, name: 'Carlos', whatsapp_id: '5210000000000' };

function browseTables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF_ROW],
    staff_availability:        [{ staff_id: STAFF, day_of_week: DOW, start_time: '10:00:00', end_time: '20:00:00', break_start: null, break_end: null }],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF }],
  };
}
function makeBrowseSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const data = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      gte: () => builder, lt: () => builder, neq: () => builder, order: () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}
let bizCounter = 0;
function makeBrowseDeps(): never {
  bizCounter += 1;
  const business = {
    id: `biz-browse-${bizCounter}`, name: 'Barbería Demo', whatsappNumber: '5210000000000', whatsappPhoneNumberId: 'pnid-1',
    botName: 'Asistente', awayMessage: 'Cerrado.', fallbackMessage: 'Te comunico con el equipo.',
    officeHours: null, walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
  };
  return { business, supabase: makeBrowseSupabase(browseTables()), anthropicKey: '', model: 'haiku' } as never;
}
function bmsg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: NOW, messageId: 'wamid.test' } as never;
}
function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}
function pslot(index: number, localHHMM: string, durMin = 30): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  const end   = new Date(start.getTime() + durMin * 60_000);
  return { index, staffId: STAFF, staffName: 'Carlos', startsAt: start.toISOString(), endsAt: end.toISOString() };
}
function baseContext(pendingSlots: LifestylePendingSlot[]): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF, autoAssign: false, requestedDate: DATE, pendingSlots };
}

// Slots {11:00, 11:30, 12:00}. Pre-fix, "Once" caía a route 'none' → clarify
// "Disculpa, no te seguí bien…". Ahora wordToHour("once")=11 → select 11:00.
const ELEVEN_SLOTS = [pslot(1, '11:00'), pslot(2, '11:30'), pslot(3, '12:00')];

test('browse: "Once" tras ofrecer slots → selecciona 11:00 (NO "no te seguí bien")', async () => {
  const r = await handleConfirmingAppointment(bmsg('Once'), baseContext(ELEVEN_SLOTS), makeBrowseDeps());
  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('11:00'));
  assert.doesNotMatch(r.responseText, /no te segui bien/i);
});

test('browse: "Once" === "11" (palabra ≡ dígito en el step-4)', async () => {
  const word  = await handleConfirmingAppointment(bmsg('Once'), baseContext(ELEVEN_SLOTS), makeBrowseDeps());
  const digit = await handleConfirmingAppointment(bmsg('11'),   baseContext(ELEVEN_SLOTS), makeBrowseDeps());
  assert.equal(word.newState, digit.newState);
  assert.equal(word.newContext.selectedSlot, digit.newContext.selectedSlot);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. uno/dos/tres ambiguo (índice vs hora): "tres" hereda la resolución de "3"
// ════════════════════════════════════════════════════════════════════════════
// Decisión aprobada (deliberada): palabra ≡ dígito. Con {12:00,12:15,12:30} la
// lectura-hora de "tres"/"3" (15:00) NO calza ningún slot → precedencia cae a
// ÍNDICE (3er slot = 12:30). MISMO resultado por ambas entradas, sin política nueva.

const NOON15 = [pslot(1, '12:00'), pslot(2, '12:15'), pslot(3, '12:30')];

test('ambiguo: "tres" ante {12:00,12:15,12:30} === "3" (mismo estado y slot)', async () => {
  const word  = await handleConfirmingAppointment(bmsg('tres'), baseContext(NOON15), makeBrowseDeps());
  const digit = await handleConfirmingAppointment(bmsg('3'),    baseContext(NOON15), makeBrowseDeps());
  assert.equal(word.newState, digit.newState);
  assert.equal(word.newContext.selectedSlot, digit.newContext.selectedSlot);
  // Concretamente: índice 3 → 3er slot (12:30).
  assert.equal(word.newContext.selectedSlot, localISO('12:30'));
});

test('ambiguo: "tres" ante slot real de las 3pm → calza la HORA (15:00), igual que "3"', async () => {
  const PM_SLOTS = [pslot(1, '14:00'), pslot(2, '15:00'), pslot(3, '16:00')];
  const word  = await handleConfirmingAppointment(bmsg('tres'), baseContext(PM_SLOTS), makeBrowseDeps());
  const digit = await handleConfirmingAppointment(bmsg('3'),    baseContext(PM_SLOTS), makeBrowseDeps());
  assert.equal(word.newContext.selectedSlot, digit.newContext.selectedSlot);
  assert.equal(word.newContext.selectedSlot, localISO('15:00'));
});
