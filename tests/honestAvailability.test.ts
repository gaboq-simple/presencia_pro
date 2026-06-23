// Disponibilidad honesta — separar "qué hay" (forma completa) de "qué se muestra".
// Paso 1 (forma de datos): getDayAvailability devuelve la forma completa (all/total/
// morning/afternoon, SIN truncar); getAvailableSlots queda como wrapper de compat
// (.all.slice(0,3)). T9 prueba la PARIDAD: el wrapper reproduce el ≤3 de hoy y la
// forma expone el set completo + las franjas particionadas por AFTERNOON_CUTOFF (14:00).
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getAvailableSlots, getDayAvailability } from '../packages/engine/src/bot/lifestyle/scheduling';
import type { DayAvailability } from '../packages/engine/src/bot/lifestyle/scheduling';
import {
  decidePresentation,
  pickRepresentative,
  parseFranjaReply,
  buildFranjaQuestion,
  buildRepresentativeMessage,
  buildListMessage,
  REPRESENTATIVE_COUNT,
  LIST_ALL_MAX,
} from '../packages/engine/src/bot/lifestyle/states/slotPresentation';
import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { formatTimeHumanFromDate, formatTimeHuman } from '../packages/engine/src/bot/lifestyle/utils';
import { noonUTCDate, weekdayFromDateStr, utcToLocalMinutes, localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { SlotCandidate, StaffRow } from '../packages/engine/src/bot/lifestyle/types';
import { LifestylePendingSlotSchema } from '../packages/engine/src/types/lifestyle.types';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tables: TableData) {
  const from = (table: string) => {
    const data = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      lt:     () => builder,
      neq:    () => builder,
      order:  () => builder,
      limit:  () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TZ       = 'America/Mexico_City';
const DATE_STR = '2026-06-10';                  // miércoles
const DOW      = weekdayFromDateStr(DATE_STR);
const STAFF: StaffRow = { id: 'staff-carlos', name: 'Carlos', whatsapp_id: '5210000000000' };
const AFTERNOON_CUTOFF_MIN = 14 * 60;           // debe coincidir con scheduling.ts

function availabilityRow(start: string, end: string) {
  return { staff_id: STAFF.id, day_of_week: DOW, start_time: start, end_time: end, break_start: null, break_end: null };
}

// Día completo 10:00–20:00 → muchos slots (>3), repartidos antes y después de 14:00.
function fullDaySupabase(): never {
  return makeSupabase({
    staff_availability:        [availabilityRow('10:00:00', '20:00:00')],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF.id }],
  });
}

// Barbero fijo (preferredStaffId set) → la forma devuelve TODOS sus slots.
function fixedBarberOpts(supabase: never) {
  return {
    businessId:          'biz-1',
    serviceId:           'svc-corte',
    durationMinutes:     30,
    requestedDate:       noonUTCDate(DATE_STR),
    shift:               null as 'morning' | 'afternoon' | null,
    preferredStaffId:    STAFF.id,
    isWalkIn:            false,
    walkInBufferMinutes: 60,
    staffToQuery:        [STAFF],
    supabase,
    tz:                  TZ,
  };
}

// ─── T9 — paridad wrapper ↔ forma + partición de franjas ──────────────────────

test('T9a paridad: getAvailableSlots == getDayAvailability().all.slice(0,3) y la forma NO trunca', async () => {
  const opts  = fixedBarberOpts(fullDaySupabase());
  const shape = await getDayAvailability(opts);
  const wrap  = await getAvailableSlots(opts);

  // La forma expone el set COMPLETO (el bug era quedarse con 3).
  assert.ok(shape.all.length > 3, `la forma debe exponer >3 slots, tiene ${shape.all.length}`);
  assert.equal(shape.total, shape.all.length);

  // El wrapper reproduce el comportamiento de hoy: exactamente ≤3 = all.slice(0,3).
  assert.equal(wrap.length, 3);
  assert.deepEqual(wrap, shape.all.slice(0, 3));
});

test('T9b franjas: morning/afternoon particionan all por AFTERNOON_CUTOFF (14:00), preservando orden', async () => {
  const shape = await getDayAvailability(fixedBarberOpts(fullDaySupabase()));

  // Partición exacta: morning ∪ afternoon = all, sin solape.
  assert.equal(shape.morning.length + shape.afternoon.length, shape.total);
  assert.ok(shape.morning.length > 0 && shape.afternoon.length > 0, 'el día completo cae en ambas franjas');

  for (const s of shape.morning)   assert.ok(utcToLocalMinutes(s.startsAt, TZ) <  AFTERNOON_CUTOFF_MIN, 'morning < 14:00');
  for (const s of shape.afternoon) assert.ok(utcToLocalMinutes(s.startsAt, TZ) >= AFTERNOON_CUTOFF_MIN, 'afternoon >= 14:00');

  // Orden preservado dentro de cada franja (all viene cronológico).
  const mins = shape.all.map((s) => utcToLocalMinutes(s.startsAt, TZ));
  assert.deepEqual([...mins].sort((a, b) => a - b), mins, 'all viene ordenado cronológicamente');
});

test('T9c walk-in: la forma trae ≤1 (el más cercano) y el wrapper coincide', async () => {
  const opts  = { ...fixedBarberOpts(fullDaySupabase()), isWalkIn: true };
  const shape = await getDayAvailability(opts);
  const wrap  = await getAvailableSlots(opts);

  assert.ok(shape.all.length <= 1);
  assert.deepEqual(wrap, shape.all.slice(0, 3));
});

// ─── Árbol de decisión (puro) — Paso 2 ────────────────────────────────────────
// Construimos la forma a mano (sin DB) para aislar la lógica del árbol.

function slot(localHHMM: string): SlotCandidate {
  const start = localTimeToUTC(DATE_STR, localHHMM, TZ);
  return { staffId: STAFF.id, staffName: STAFF.name, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000) };
}
function makeShape(localTimes: string[]): DayAvailability {
  const all       = localTimes.map(slot);
  const morning   = all.filter((s) => utcToLocalMinutes(s.startsAt, TZ) <  AFTERNOON_CUTOFF_MIN);
  const afternoon = all.filter((s) => utcToLocalMinutes(s.startsAt, TZ) >= AFTERNOON_CUTOFF_MIN);
  return { all, total: all.length, morning, afternoon };
}
const localMin = (s: SlotCandidate) => utcToLocalMinutes(s.startsAt, TZ);

test('T1 pocos (≤4) en una franja, sin pista → list (todos)', () => {
  const d = decidePresentation(makeShape(['10:00', '11:00', '12:00']), {}, TZ);
  assert.equal(d.mode, 'list');
  assert.equal(d.mode === 'list' && d.show.length, 3);
});

test('T2 muchos (>4) en una franja, sin pista → representative (3 espaciados)', () => {
  const d = decidePresentation(makeShape(['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']), {}, TZ);
  assert.equal(d.mode, 'representative');
  assert.equal(d.mode === 'representative' && d.show.length, REPRESENTATIVE_COUNT);
});

test('T3 muchos repartidos en AMBAS franjas, sin pista → ask-franja', () => {
  const d = decidePresentation(makeShape(['10:00', '11:00', '12:00', '15:00', '16:00', '17:00']), {}, TZ);
  assert.equal(d.mode, 'ask-franja');
});

test('T4 con pista de franja (requestedShift) → filtra directo a esa franja, NO pregunta', () => {
  const shape = makeShape(['10:00', '11:00', '12:00', '15:00', '16:00']); // morning 3, afternoon 2
  const d = decidePresentation(shape, { requestedShift: 'afternoon' }, TZ);
  assert.notEqual(d.mode, 'ask-franja');
  assert.ok(d.mode !== 'ask-franja' && d.show.every((s) => localMin(s) >= AFTERNOON_CUTOFF_MIN), 'solo slots de la tarde');
});

test('T5 con pista de hora (requestedTime) → franja de esa hora, ordenada por cercanía', () => {
  const shape = makeShape(['10:00', '18:00', '19:00', '20:00']); // 20:00 = 8pm presente
  const d = decidePresentation(shape, { requestedTime: '20:00' }, TZ);
  assert.notEqual(d.mode, 'ask-franja');
  // El más cercano a 20:00 va primero (no el más temprano del día).
  assert.equal(d.mode !== 'ask-franja' && localMin(d.show[0]!), 20 * 60);
});

test('T6 una sola franja con slots (otra vacía), sin pista → lista esa franja, NUNCA pregunta (regla maestra)', () => {
  // Muchos slots SOLO en la tarde: aun siendo muchos, no se pregunta franja (la mañana está vacía).
  const d = decidePresentation(makeShape(['15:00', '16:00', '17:00', '18:00', '19:00']), {}, TZ);
  assert.notEqual(d.mode, 'ask-franja');
  assert.ok(d.mode !== 'ask-franja' && d.show.every((s) => localMin(s) >= AFTERNOON_CUTOFF_MIN));
});

// ─── pickRepresentative (determinista) — T15 ──────────────────────────────────

test('T15 pickRepresentative: 3 espaciados deterministas (primero/medio/último)', () => {
  const pool = ['10:00', '11:00', '12:00', '13:00', '15:00', '16:00', '17:00'].map(slot); // n=7
  const picked = pickRepresentative(pool, 3);
  assert.deepEqual(picked.map(localMin), [10 * 60, 13 * 60, 17 * 60]); // idx 0, 3, 6
  // Determinista: misma entrada → misma salida.
  assert.deepEqual(pickRepresentative(pool, 3).map(localMin), picked.map(localMin));
});

// ─── Plantillas deterministas — T16 (garantía contractual) ────────────────────

test('T16 representative: TODAS las variantes incluyen "otra hora" (anti-ocultar-opciones)', () => {
  const times = ['10:00', '2:00', '6:00'];
  for (let v = 0; v < 3; v++) {
    const msg = buildRepresentativeMessage(times, v);
    assert.match(msg, /otra hora/, `la variante ${v} DEBE ofrecer "otra hora"`);
    for (const t of times) assert.ok(msg.includes(t), `la variante ${v} debe incluir ${t}`);
  }
});

test('T16b franja question: todas las variantes ofrecen mañana Y tarde', () => {
  for (let v = 0; v < 3; v++) {
    const q = buildFranjaQuestion(v);
    assert.match(q, /ma[ñn]ana|temprano/, `variante ${v} debe ofrecer la mañana`);
    assert.match(q, /tarde/,               `variante ${v} debe ofrecer la tarde`);
  }
});

// ─── parseFranjaReply (LOCAL; trampa C1) ──────────────────────────────────────

test('parseFranjaReply: "mañana" → morning (franja, NO día-siguiente); "más tarde" → afternoon', () => {
  assert.equal(parseFranjaReply('mañana'), 'morning');     // la trampa C1
  assert.equal(parseFranjaReply('en la mañana'), 'morning');
  assert.equal(parseFranjaReply('temprano'), 'morning');
  assert.equal(parseFranjaReply('más tarde'), 'afternoon');
  assert.equal(parseFranjaReply('en la tarde'), 'afternoon');
  assert.equal(parseFranjaReply('cualquiera'), null);
});

// ─── Integración con handleShowingSlots (camino honesto) — T8, T10-T13 ─────────

const SVC = 'svc-corte';
function handlerSupabase(start: string, end: string): never {
  return makeSupabase({
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [STAFF],
    staff_availability:        [availabilityRow(start, end)],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF.id }],
  });
}
function handlerDeps(supabase: never): never {
  return {
    business: {
      id: 'biz-h', name: 'Barbería Demo', whatsappNumber: '5210000000000', whatsappPhoneNumberId: 'pnid-1',
      botName: 'Asistente', awayMessage: 'Cerrado.', fallbackMessage: 'Te comunico con el equipo.',
      officeHours: null, walkInBufferMinutes: 60, address: 'Calle 1', timezone: TZ,
    },
    supabase, anthropicKey: '', model: 'haiku',
  } as never;
}
function showMsg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: new Date('2026-06-10T15:00:00.000Z'), messageId: 'wamid.h' } as never;
}
// Barbero FIJO (staffId set, autoAssign falso) + día pedido.
function showCtx(extra: Partial<LifestyleBotContext> = {}): LifestyleBotContext {
  return { serviceId: SVC, staffId: STAFF.id, autoAssign: false, requestedDate: DATE_STR, ...extra };
}
const psLocalMin = (ps: { startsAt: string }) => utcToLocalMinutes(new Date(ps.startsAt), TZ);

test('T8 exactMatchMissed honesto: requestedTime sin slot real → "no tengo" + ofrece cercanos de la agenda completa', async () => {
  // Carlos 10:00–18:00 → NO existe 20:00 (8pm). Antes el chequeo era contra 3
  // truncados; ahora contra shape.all → el "no tengo" es honesto y ofrece cercanos.
  const r = await handleShowingSlots(showMsg('a las 8'), showCtx({ requestedTime: '20:00' }), handlerDeps(handlerSupabase('10:00:00', '18:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.match(r.responseText, /no tengo disponible/i, 'comunica honestamente que esa hora no está');
  assert.ok((r.newContext.pendingSlots ?? []).length > 0, 'ofrece alternativas concretas');
});

test('T10 pendingFranjaChoice + "mañana" → franja MAÑANA (NO día-siguiente; trampa C1)', async () => {
  const r = await handleShowingSlots(showMsg('mañana'), showCtx({ pendingFranjaChoice: true }), handlerDeps(handlerSupabase('10:00:00', '20:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.requestedDate, DATE_STR, '"mañana" NO saltó de fecha (sigue el día pedido)');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0 && ps.every((p) => psLocalMin(p) < AFTERNOON_CUTOFF_MIN), 'todos los slots son de la mañana');
});

test('T11 pendingFranjaChoice + "en la tarde" → franja TARDE', async () => {
  const r = await handleShowingSlots(showMsg('en la tarde'), showCtx({ pendingFranjaChoice: true }), handlerDeps(handlerSupabase('10:00:00', '20:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0 && ps.every((p) => psLocalMin(p) >= AFTERNOON_CUTOFF_MIN), 'todos los slots son de la tarde');
});

test('T12 pendingFranjaChoice + respuesta no-franja ("cualquiera") → muestra de todo, NO re-pregunta (sin loop)', async () => {
  const r = await handleShowingSlots(showMsg('cualquiera'), showCtx({ pendingFranjaChoice: true }), handlerDeps(handlerSupabase('10:00:00', '20:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT', 'no vuelve a SHOWING_SLOTS a re-preguntar');
  assert.ok(!r.newContext.pendingFranjaChoice, 'limpia la bandera (no hay loop)');
  assert.ok((r.newContext.pendingSlots ?? []).length > 0);
});

test('T13 (edge) pendingFranjaChoice + "mañana a las 8" → conservador: la keyword de franja gana (mañana)', async () => {
  const r = await handleShowingSlots(showMsg('mañana a las 8'), showCtx({ pendingFranjaChoice: true }), handlerDeps(handlerSupabase('10:00:00', '20:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0 && ps.every((p) => psLocalMin(p) < AFTERNOON_CUTOFF_MIN), 'trata "mañana" como franja mañana (documentado)');
});

// ─── Texto FINAL del handler en modo list (el test que faltó) — T17-T19 ───────
// Los tests del árbol (T1-T6) son PUROS: ven la `decision`, no el responseText tras
// Haiku. Estos driveán el handler y afirman sobre el TEXTO FINAL. En test sin red
// Haiku no corre; la afirmación es CONTRACTUAL: el texto ES la plantilla determinista
// (buildListMessage), NO el de generateSlotsMessage → prueba que el camino honesto ya
// no hace la segunda pasada por el LLM (origen de la doble lista).

test('T17 list mode: el texto FINAL es la plantilla determinista — UNA lista, sin formato de Haiku', async () => {
  // Barbero 10:00–11:00 → 3 slots de mañana (única franja). Browse sin pista → list.
  const r = await handleShowingSlots(showMsg('¿qué horarios tienes?'), showCtx(), handlerDeps(handlerSupabase('10:00:00', '11:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.equal(ps.length, 3, 'lista los 3 (≤ LIST_ALL_MAX)');
  const times = ps.map((p) => formatTimeHumanFromDate(new Date(p.startsAt), TZ));

  // El texto ES la plantilla determinista (única franja → shape.total == nº mostrado).
  assert.equal(r.responseText, buildListMessage(times, ps.length, null));

  // Discriminador rojo→verde: el camino VIEJO pasaba por generateSlotsMessage →
  // buildSlotsMessage ("Estos son los horarios disponibles:\n\n1. …"). La plantilla
  // honesta NO usa ese formato. (Esta aserción FALLA contra el código viejo.)
  assert.ok(!/Estos son los horarios disponibles/.test(r.responseText), 'no es el fallback de generateSlotsMessage');
  assert.ok(!/^\s*1\.\s/m.test(r.responseText), 'no enumera estilo "1. …"');
  // Cada hora aparece EXACTAMENTE una vez → una sola lista, no dos fusionadas.
  for (const t of times) {
    assert.equal(r.responseText.split(t).length - 1, 1, `la hora ${t} aparece una sola vez`);
  }
});

test('T18 list mode + requestedTime ausente: preámbulo honesto + UNA lista (mata el "lo más cercano es 10" de Haiku)', async () => {
  // Barbero 10:00–11:00 (sin 8pm). Pide 20:00 → exactMatchMissed contra shape.all.
  const r = await handleShowingSlots(showMsg('a las 8'), showCtx({ requestedTime: '20:00' }), handlerDeps(handlerSupabase('10:00:00', '11:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  const times = ps.map((p) => formatTimeHumanFromDate(new Date(p.startsAt), TZ));

  // Preámbulo honesto (contra la agenda completa) + cuerpo = plantilla determinista.
  assert.equal(r.responseText, `A las ${formatTimeHuman('20:00')} no tengo disponible. ${buildListMessage(times, ps.length, null)}`);
  // Sin segunda lista contradictoria: cada hora una sola vez.
  for (const t of times) {
    assert.equal(r.responseText.split(t).length - 1, 1, `la hora ${t} aparece una sola vez`);
  }
});

test('T19 list mode coda honesta: muestra una franja pero ofrece la otra si tiene slots', async () => {
  // Barbero 13:30–17:00: mañana=[13:30,13:45], tarde=[14:00…]. Pista franja mañana →
  // list mañana (2 ≤3) + coda "por la tarde" (no esconde la otra franja).
  const r = await handleShowingSlots(showMsg('en la mañana'), showCtx({ requestedShift: 'morning' }), handlerDeps(handlerSupabase('13:30:00', '17:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0 && ps.every((p) => psLocalMin(p) < AFTERNOON_CUTOFF_MIN), 'lista solo la mañana');
  assert.match(r.responseText, /por la tarde/, 'coda honesta: ofrece la otra franja sin esconderla');
});

// ─── Invariante LIST_ALL_MAX <= max(index) — blinda la sincronización ─────────
// Como el invariante de STRUCTURAL_CAP: lee el máximo REAL del schema (no lo
// hardcodea) para que bajar/subir cualquiera de los dos rompa el test si invalida
// la relación. Un 4º slot en `list` armaría index:4 → safeParse del contexto falla.

test('T20 invariante: LIST_ALL_MAX <= max(index) del pendingSlot schema', () => {
  const maxIndex = LifestylePendingSlotSchema.shape.index.maxValue;
  assert.equal(typeof maxIndex, 'number', 'el schema define un max de index');
  assert.ok(LIST_ALL_MAX <= maxIndex!, `LIST_ALL_MAX (${LIST_ALL_MAX}) debe ser <= max index (${maxIndex})`);
});
