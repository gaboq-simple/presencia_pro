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
  buildRepresentativeMessage,
  formatRepresentativeExamples,
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

test('T3 (Versión C) muchos repartidos en AMBAS franjas, sin pista → representative de TODO el día', () => {
  // Antes preguntaba la franja ("¿mañana o más tarde?"). Versión C: ancla con ejemplos
  // que abarcan mañana Y tarde, sin preguntar (no oculta franjas, no exige una decisión).
  const d = decidePresentation(makeShape(['10:00', '11:00', '12:00', '15:00', '16:00', '17:00']), {}, TZ);
  assert.equal(d.mode, 'representative');
  assert.equal(d.mode === 'representative' && d.show.length, REPRESENTATIVE_COUNT);
  assert.ok(d.mode === 'representative' && d.show.some((s) => localMin(s) <  AFTERNOON_CUTOFF_MIN), 'incluye un ejemplo de la mañana');
  assert.ok(d.mode === 'representative' && d.show.some((s) => localMin(s) >= AFTERNOON_CUTOFF_MIN), 'incluye un ejemplo de la tarde');
});

test('T4 con pista de franja (requestedShift) → filtra directo a esa franja', () => {
  const shape = makeShape(['10:00', '11:00', '12:00', '15:00', '16:00']); // morning 3, afternoon 2
  const d = decidePresentation(shape, { requestedShift: 'afternoon' }, TZ);
  assert.ok(d.show.every((s) => localMin(s) >= AFTERNOON_CUTOFF_MIN), 'solo slots de la tarde');
});

test('T5 con pista de hora (requestedTime) → franja de esa hora, ordenada por cercanía', () => {
  const shape = makeShape(['10:00', '18:00', '19:00', '20:00']); // 20:00 = 8pm presente
  const d = decidePresentation(shape, { requestedTime: '20:00' }, TZ);
  // El más cercano a 20:00 va primero (no el más temprano del día).
  assert.equal(localMin(d.show[0]!), 20 * 60);
});

test('T6 una sola franja con slots (otra vacía), sin pista → presenta solo esa franja (regla maestra)', () => {
  // Muchos slots SOLO en la tarde: se presenta la tarde (la mañana está vacía → no se afirma de más).
  const d = decidePresentation(makeShape(['15:00', '16:00', '17:00', '18:00', '19:00']), {}, TZ);
  assert.ok(d.show.every((s) => localMin(s) >= AFTERNOON_CUTOFF_MIN), 'solo slots de la tarde');
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

test('T16 representative: TODAS las variantes dejan la puerta abierta ("buscas otra") y muestran los ejemplos (anti-ocultar-opciones)', () => {
  const times = ['10:00', '2:00', '6:00'];
  for (const span of ['both', 'morning', 'afternoon'] as const) {
    for (let v = 0; v < 3; v++) {
      const msg = buildRepresentativeMessage(times, span, v);
      assert.match(msg, /busca[rs]?\s+otra/, `span ${span} variante ${v} DEBE ofrecer buscar otra`);
      for (const t of times) assert.ok(msg.includes(t), `span ${span} variante ${v} debe incluir ${t}`);
    }
  }
});

test('T16b representative: la señal de amplitud se adapta a la forma (no miente que hay de todo)', () => {
  const times = ['10:00', '2:00', '6:00'];
  for (let v = 0; v < 3; v++) {
    assert.match(buildRepresentativeMessage(times, 'both', v),      /desde temprano hasta la noche/, `ambas franjas, variante ${v}`);
    assert.match(buildRepresentativeMessage(times, 'morning', v),   /en la mañana/,                  `solo mañana, variante ${v}`);
    assert.match(buildRepresentativeMessage(times, 'afternoon', v), /en la tarde/,                   `solo tarde, variante ${v}`);
    // Una sola franja NO debe afirmar amplitud total ("desde temprano hasta la noche").
    assert.doesNotMatch(buildRepresentativeMessage(times, 'morning', v),   /desde temprano hasta la noche/);
    assert.doesNotMatch(buildRepresentativeMessage(times, 'afternoon', v), /desde temprano hasta la noche/);
  }
});

test('T16c formatRepresentativeExamples: una franja → compacto (sin repetir franja); ambas → marcador en los extremos', () => {
  // Ambas franjas: el primero y el último llevan su franja (enmarcan temprano→noche); el
  // del medio va compacto (claro por interpolación) → sin "tarde…tarde…tarde".
  const mixed = ['10:00', '14:30', '18:00'].map(slot); // 10am, 2:30pm, 6pm
  assert.deepEqual(formatRepresentativeExamples(mixed, TZ, 'both'), ['10 de la mañana', '2:30', '6 de la tarde']);
  // Una sola franja (tarde): TODO compacto — la franja ya se dijo en la señal de amplitud.
  const pm = ['14:00', '16:45', '19:30'].map(slot); // 2pm, 4:45pm, 7:30pm
  assert.deepEqual(formatRepresentativeExamples(pm, TZ, 'afternoon'), ['2', '4:45', '7:30']);
  // Una sola franja (mañana): compacto.
  const am = ['09:00', '10:30', '11:45'].map(slot);
  assert.deepEqual(formatRepresentativeExamples(am, TZ, 'morning'), ['9', '10:30', '11:45']);
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

// Nota: los antiguos T10–T13 ejercitaban la RESPUESTA a la pregunta binaria de franja
// (rama `else if (pendingFranjaChoice)`). Versión C eliminó esa pregunta y su rama, así
// que esos tests se retiraron. El reply de franja del ÚLTIMO RECURSO (mañana/noche con
// hora aparcada sin agenda) sigue cubierto por los T14-T16 de abajo.

// ─── Versión C (integración): muestra representativa de UNA franja → señal acotada ───

test('T13 (Versión C, integración) una sola franja con muchos slots → "varios huecos en la tarde", sin afirmar amplitud total', async () => {
  // Carlos 14:00–20:00 → solo tarde, muchos slots. Browse sin pista → representative.
  const r = await handleShowingSlots(showMsg('¿qué horarios tienes?'), showCtx(), handlerDeps(handlerSupabase('14:00:00', '20:00:00')));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0 && ps.every((p) => psLocalMin(p) >= AFTERNOON_CUTOFF_MIN), 'solo anclas de la tarde');
  assert.match(r.responseText, /varios huecos en la tarde/i, 'señal de amplitud acotada a la franja real');
  assert.doesNotMatch(r.responseText, /desde temprano hasta la noche/i, 'NO miente amplitud total con una sola franja');
  // Ejemplos COMPACTOS: la franja ya se dijo en la amplitud → no repetir "de la tarde" en
  // cada hora. Sin el fix de formateo, los ejemplos decían "2 de la tarde, 4:45 de la tarde…".
  assert.doesNotMatch(r.responseText, /de la (tarde|mañana|noche)/, 'ejemplos compactos: sin marcador de franja repetido');
  assert.match(r.responseText, /busca[rs]?\s+otra/i, 'deja la puerta abierta');
});

// ─── FIX 2: resolución de hora aparcada contra la agenda — T14-T16 ────────────

test('T14 (FIX 2, red→green) pendingAgendaTime {8,0} + agenda hasta 21:00 → 20:00 (NO 8am)', async () => {
  // El smoke: "a las 8" en el browse de un barbero que abre hasta las 21:00. Antes
  // "a las 8" se horneaba a 08:00 (8am) y el bot decía "no tengo / lo más cercano
  // es la mañana". Ahora se difiere a la agenda: 8 = [8am, 8pm] → 20:00 tiene slot
  // real (8pm gana), sin exactMatchMissed.
  const r = await handleShowingSlots(
    showMsg('a las 8'),
    showCtx({ pendingAgendaTime: { hour: 8, minute: 0 } }),
    handlerDeps(handlerSupabase('12:00:00', '21:00:00')),
  );
  assert.equal(r.newContext.requestedTime, '20:00', 'la agenda desambigua 8 → 20:00 (no 08:00)');
  assert.equal(r.newContext.pendingAgendaTime, undefined, 'la hora aparcada se libera al resolver');
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  // último recurso => SHOWING_SLOTS + pendingFranjaChoice; acá la agenda resolvió sola.
  // (No chequear "de la noche" en el texto: formatTimeHuman(20:00) ES "8 de la noche".)
  assert.ok(!r.newContext.pendingFranjaChoice, 'NO usa el último recurso: la agenda resolvió sola');
  assert.doesNotMatch(r.responseText, /no tengo disponible/i, '20:00 SÍ existe → sin preámbulo de "no tengo"');
});

test('T15 (FIX 2, happy path) pendingAgendaTime con slots → resuelve inline, NO cuela pregunta de más', async () => {
  // Garantía (b) del diseño: en el caso feliz (hay agenda) NO debe aparecer una
  // pregunta de período en el flujo normal. Resuelve y avanza a CONFIRMING.
  const r = await handleShowingSlots(
    showMsg('a las 8'),
    showCtx({ pendingAgendaTime: { hour: 8, minute: 0 } }),
    handlerDeps(handlerSupabase('10:00:00', '20:00:00')),
  );
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT', 'no se queda en SHOWING_SLOTS preguntando');
  assert.ok(!r.newContext.pendingFranjaChoice, 'no abre un ciclo de pregunta de franja');
  assert.equal(r.newContext.pendingAgendaTime, undefined, 'resuelta');
  assert.ok(/^\d{2}:\d{2}$/.test(r.newContext.requestedTime ?? ''), 'fijó una hora concreta');
});

test('T16 (FIX 2, último recurso) pendingAgendaTime SIN agenda ese día → pregunta mañana/noche, NUNCA asume AM', async () => {
  function noAvailSupabase(): never {
    return makeSupabase({
      services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
      staff:                     [STAFF],
      staff_availability:        [],   // el barbero NO trabaja ese día → no hay agenda
      appointments:              [],
      staff_blocks:              [],
      staff_schedule_exceptions: [],
      staff_services:            [{ staff_id: STAFF.id }],
    });
  }
  // Turno 1: sin agenda para desambiguar → pregunta mañana/noche (no asume AM).
  const r1 = await handleShowingSlots(showMsg('a las 8'), showCtx({ pendingAgendaTime: { hour: 8, minute: 0 } }), handlerDeps(noAvailSupabase()));
  assert.equal(r1.newState, 'SHOWING_SLOTS');
  assert.match(r1.responseText, /ma[ñn]ana o de la noche/i, 'pregunta el período como último recurso');
  assert.equal(r1.newContext.pendingFranjaChoice, true, 'arma el reply');
  assert.deepEqual(r1.newContext.pendingAgendaTime, { hour: 8, minute: 0 }, 'conserva la hora cruda para resolverla con la franja');

  // Turno 2: "de la noche" resuelve el AM/PM → 20:00 (no 8am).
  const r2 = await handleShowingSlots(showMsg('de la noche'), r1.newContext, handlerDeps(noAvailSupabase()));
  assert.equal(r2.newContext.requestedTime, '20:00', 'la franja resuelve 8 → 20:00, nunca AM');
  assert.equal(r2.newContext.pendingAgendaTime, undefined, 'suelta el parking (no loop)');
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
