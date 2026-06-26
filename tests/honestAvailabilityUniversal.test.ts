// HONESTIDAD UNIVERSAL de disponibilidad (hallazgo smoke R4.2) — tests del sprint.
// La forma COMPLETA del día (getDayAvailability) + árbol determinista (decidePresentation)
// se cablea en TODOS los call-sites que antes truncaban a 3 a ciegas, no solo en la rama
// barbero-fijo de SHOWING_SLOTS.
//
// Esta tanda cubre (c): buildBarberMismatchResult — el cierre defensivo (S5-BOT-10) que
// ofrece al barbero PEDIDO en otro horario cuando el slot elegido es de otro. Antes hacía
// getAvailableSlots(...).slice(0,3): los 3 más TEMPRANOS, cronológicos → si la agenda del
// barbero arranca temprano pero el cliente pidió la TARDE, escondía la tarde y ofrecía la
// mañana (falso-negativo DURO: pierde la cita). Ahora consume la forma + el árbol, que
// respeta la franja pedida.
//
// Determinista: Supabase fake (sin red), Anthropic key vacía (cae al fallback). npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { getDayAvailability } from '../packages/engine/src/bot/lifestyle/scheduling';
import { localTimeToUTC, utcToLocalMinutes, noonUTCDate } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext, LifestylePendingSlot } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ      = 'America/Mexico_City';                 // UTC-6 fijo
const DATE    = '2026-06-15';                          // lunes (DOW 1)
const DOW     = 1;
const NOW     = new Date('2026-06-15T15:00:00.000Z');  // lunes ~09:00 local
const AFTERNOON_CUTOFF_MIN = 14 * 60;
const SVC     = '22222222-2222-2222-2222-222222222222';
const CARLOS  = '11111111-1111-1111-1111-111111111111';
const ANDRES  = '33333333-3333-3333-3333-333333333333';

// ─── Fake Supabase (builder encadenable y thenable) ──────────────────────────

type TableData = Record<string, unknown[]>;

function makeSupabase(tablesData: TableData) {
  const from = (table: string) => {
    const data = tablesData[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq:     () => builder,
      in:     () => builder,
      gte:    () => builder,
      lt:     () => builder,
      neq:    () => builder,
      order:  () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

function availRow(staffId: string, start: string, end: string) {
  return { staff_id: staffId, day_of_week: DOW, start_time: start, end_time: end, break_start: null, break_end: null };
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

// Carlos trabaja TODO el día (10:00–20:00): la mañana arranca temprano, pero la tarde
// (≥14:00) está LIBRE. Es la trampa del falso-negativo: el slice cronológico mostraría
// 10:00/10:30/11:00 (mañana) y escondería la tarde que el cliente pidió.
function carlosFullDayTables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [
      { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' },
      { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002' },
    ],
    staff_availability:        [availRow(CARLOS, '10:00:00', '20:00:00')],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
  };
}

let bizCounter = 0;
function makeDeps(tables: TableData) {
  bizCounter += 1;
  const business = {
    id:                    `biz-hu-${bizCounter}`, // único por test → aísla cache de catálogo/roster
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
  return { business, supabase: makeSupabase(tables), anthropicKey: '', model: 'haiku' } as never;
}

function makeMsg(body: string): never {
  return { businessId: 'biz', customerPhone: '5215500000000', customerName: null, body, timestamp: NOW, messageId: 'wamid.test' } as never;
}

function pslot(staffId: string, staffName: string, localHHMM: string): LifestylePendingSlot {
  const start = localTimeToUTC(DATE, localHHMM, TZ);
  return { index: 1, staffId, staffName, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString() };
}

// ─── (c) buildBarberMismatchResult: NO esconde la tarde ───────────────────────

test('(c) Carlos pedido para la tarde, agenda arranca 10am pero la tarde está libre → ofrece la TARDE (no la esconde)', async () => {
  // El cliente pidió a Carlos para la tarde (requestedStaffId + requestedShift). El slot
  // que se intenta cerrar es de Andrés → cierre defensivo (mismatch) → ofrece a Carlos en
  // otro horario. VIEJO: getAvailableSlots(Carlos).slice(0,3) = 10:00/10:30/11:00 (mañana)
  // → escondía la tarde pedida. NUEVO: la forma + el árbol respetan requestedShift=afternoon.
  const ctx: LifestyleBotContext = {
    serviceId:        SVC,
    requestedDate:    DATE,
    requestedStaffId: CARLOS,        // el cliente pidió a Carlos
    requestedShift:   'afternoon',   // …para la tarde
    pendingSlots:     [pslot(ANDRES, 'Andres', '15:00')], // el slot en juego es de Andrés
  };
  // "la primera" selecciona el (único) pendingSlot → chosen = Andrés → mismatch vs Carlos.
  const r = await handleConfirmingAppointment(makeMsg('la primera'), ctx, makeDeps(carlosFullDayTables()));

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 0, 'ofrece horarios concretos de Carlos');
  // El fix: TODAS las anclas ofrecidas son de la tarde (≥14:00) — la franja pedida.
  // Contra el código viejo esta aserción FALLA (ofrecía 10:00/10:30/11:00, todas mañana).
  for (const p of ps) {
    assert.ok(utcToLocalMinutes(new Date(p.startsAt), TZ) >= AFTERNOON_CUTOFF_MIN, `ancla ${p.startsAt} debe ser de la tarde (≥14:00)`);
  }
  // Es a Carlos (el barbero pedido) a quien se ofrece, por nombre.
  assert.ok(ps.every((p) => p.staffId === CARLOS), 'las anclas son de Carlos, el barbero pedido');
  assert.match(r.responseText, /Carlos/, 'ofrece a Carlos por nombre');
  assert.equal(r.newContext.presentBy, 'staff', 'presenta por barbero (eje staff)');
});

// Guarda de no-regresión: si la agenda del barbero pedido NO tiene la franja, el árbol
// no inventa — cae a la otra rama (ofrecer al barbero del slot). Aquí Carlos SÍ tiene
// tarde, así que la rama del fix es la que corre; este test ancla el contrato del fix.
test('(c) las anclas ofrecidas existen de verdad en la agenda de Carlos (no fabrica horarios)', async () => {
  const ctx: LifestyleBotContext = {
    serviceId:        SVC,
    requestedDate:    DATE,
    requestedStaffId: CARLOS,
    requestedShift:   'afternoon',
    pendingSlots:     [pslot(ANDRES, 'Andres', '15:00')],
  };
  const r = await handleConfirmingAppointment(makeMsg('la primera'), ctx, makeDeps(carlosFullDayTables()));
  const ps = r.newContext.pendingSlots ?? [];
  // Carlos 10:00–20:00; la malla de slots es de 15m (SLOT_INTERVAL_MINUTES) y el corte por
  // duración (30m) deja el último arranque en 19:30 → toda ancla cae en [14:00, 19:30] y :00/:15/:30/:45.
  for (const p of ps) {
    const m = utcToLocalMinutes(new Date(p.startsAt), TZ);
    assert.ok(m >= 14 * 60 && m <= 19 * 60 + 30, `ancla ${m} dentro del horario real de Carlos`);
    assert.ok(m % 15 === 0, 'ancla alineada a la malla de 15m');
  }
});

// ─── (a) per-hour: unión de horas + round-robin multi-barbero ─────────────────

const CARLOS_ROW: StaffRow = { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' };
const ANDRES_ROW: StaffRow = { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002' };

// Ambos barberos 10:00–20:00 (mismas horas): la unión por hora debe dar 1 slot por hora
// (no 2) y repartir las horas entre ambos por round-robin.
function twoBarbersFullDayTables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [CARLOS_ROW, ANDRES_ROW],
    staff_availability:        [availRow(CARLOS, '10:00:00', '20:00:00'), availRow(ANDRES, '10:00:00', '20:00:00')],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
  };
}

function autoAssignPerHourOpts(supabase: never) {
  return {
    businessId:          'biz-rr',
    serviceId:           SVC,
    durationMinutes:     30,
    requestedDate:       noonUTCDate(DATE),
    shift:               null as 'morning' | 'afternoon' | null,
    preferredStaffId:    null as string | null,
    dedupe:              'per-hour' as const,
    isWalkIn:            false,
    walkInBufferMinutes: 60,
    staffToQuery:        [CARLOS_ROW, ANDRES_ROW],
    supabase,
    tz:                  TZ,
  };
}

const AUTO_CTX: LifestyleBotContext = { serviceId: SVC, requestedDate: DATE, autoAssign: true };

test('(a) per-hour: unión de horas distintas sobre 2 barberos (1 por hora) + round-robin reparte', async () => {
  const shape = await getDayAvailability(autoAssignPerHourOpts(makeSupabase(twoBarbersFullDayTables())));
  const hours = shape.all.map((s) => Math.floor(utcToLocalMinutes(new Date(s.startsAt), TZ) / 60));
  // Una sola entrada por hora (NO 2 barberos a la misma hora): sin duplicados de hora.
  assert.equal(new Set(hours).size, hours.length, 'una sola entrada por hora (sin duplicar la hora)');
  assert.ok(hours.length >= 8, `la unión abarca el día (>=8 horas), tiene ${hours.length}`);
  // Round-robin: ambos barberos aparecen repartidos (no todo a uno) — alternancia sobre el
  // orden por carga, robusta al shuffle aleatorio de empate.
  assert.equal(new Set(shape.all.map((s) => s.staffId)).size, 2, 'el round-robin reparte las horas entre AMBOS barberos');
});

test('(a) auto-asign 2 barberos día completo → muestra honesta de amplitud (ambas franjas, sin nombres)', async () => {
  const r = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, makeDeps(twoBarbersFullDayTables()));
  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 1, 'varias horas, no colapsa a 1');
  const mins = ps.map((p) => utcToLocalMinutes(new Date(p.startsAt), TZ));
  assert.ok(mins.some((m) => m <  AFTERNOON_CUTOFF_MIN), 'incluye una ancla de la mañana');
  assert.ok(mins.some((m) => m >= AFTERNOON_CUTOFF_MIN), 'incluye una ancla de la tarde/noche (NO la esconde)');
  assert.match(r.responseText, /desde temprano hasta la noche/i, 'amplitud honesta');
  assert.doesNotMatch(r.responseText, /Carlos|Andres/, 'auto-asign sin eje-staff → sin nombres de barbero');
});

test('(a) síntoma del smoke: "el que sea" (auto) → amplitud, luego "a las 5" encuentra las 17:00 (NUNCA "lo más cercano 10am")', async () => {
  const deps = makeDeps(twoBarbersFullDayTables());
  // Turno 1: "el que sea" sin hora → muestra honesta (NO colapsa a "las 10").
  const t1 = await handleShowingSlots(makeMsg('el que sea'), { ...AUTO_CTX }, deps);
  assert.equal(t1.newState, 'CONFIRMING_APPOINTMENT');
  assert.ok((t1.newContext.pendingSlots?.length ?? 0) > 1, 'turno 1 muestra varias horas');

  // Turno 2: "a las 5" → encuentra las 17:00 reales (oferta/selección), JAMÁS "a las 5 no
  // tengo, lo más cercano 10am" (el bug exacto del smoke R4.2).
  const t2 = await handleConfirmingAppointment(makeMsg('a las 5'), t1.newContext, deps);
  const ps2 = t2.newContext.pendingSlots ?? [];
  const has17 = ps2.some((p) => utcToLocalMinutes(new Date(p.startsAt), TZ) === 17 * 60)
    || t2.newContext.selectedSlot === localISO('17:00');
  assert.ok(has17, 'las 17:00 reales se encuentran (no escondidas tras 3 slots tempranos)');
  assert.doesNotMatch(t2.responseText, /lo mas cercano.*(a las 10|10 de la ma)/i, 'no ofrece 10am como "lo más cercano" a las 5');
});

// ─── (b) handleOfferNearest: fallback honesto cuando el requery vuelve vacío ───

// Carlos vinculado al servicio pero SIN agenda ese día → el requery de offer_nearest vuelve
// VACÍO. Antes el bot reofrecía un pendingSlot viejo como "lo más cercano" (falso).
function carlosNoAvailThatDayTables(): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [CARLOS_ROW],
    staff_availability:        [],   // Carlos NO trabaja ese día → requery vacío
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }],
  };
}

test('(b) fallback honesto: requery del día VACÍO → NO reofrece un slot viejo como "lo más cercano"; pivota a otro día', async () => {
  // Trampa del smoke: pendingSlots viejos (16:00) + el día ya sin huecos reales. "5pm" →
  // offer_nearest → requery vacío. VIEJO: reofrecía el slot viejo ("lo más cercano…") = FALSO.
  // NUEVO: dice la verdad y pregunta otro día, limpiando los slots viejos.
  const ctx: LifestyleBotContext = {
    serviceId:     SVC,
    requestedDate: DATE,
    autoAssign:    true,
    pendingSlots:  [pslot(CARLOS, 'Carlos', '16:00')], // slot viejo/stale ya inválido
  };
  const r = await handleConfirmingAppointment(makeMsg('5pm'), ctx, makeDeps(carlosNoAvailThatDayTables()));

  assert.equal(r.newState, 'QUALIFYING_DATETIME', 'pivota a pedir otro día (no finge un slot)');
  assert.equal(r.newContext.pendingSlots, undefined, 'limpia los pendingSlots viejos');
  assert.match(r.responseText, /otro dia/i, 'pregunta honestamente por otro día');
  assert.doesNotMatch(r.responseText, /lo mas cercano/i, 'NO finge un "lo más cercano" con un slot viejo');
  assert.doesNotMatch(r.responseText, /16:00|4 de la tarde/i, 'no reofrece el slot viejo (16:00)');
});
