// R3 — Propuesta negociable de slot único (autoAssign), ACOTADA por HONESTIDAD UNIVERSAL.
//
// R3 original: autoAssign + 1 hora única → no auto-confirmaba; PROPONÍA el slot
// ("¿te sirve o preferís otra?") en CONFIRMING. El smoke R4.2 mostró que R3 estaba
// INCOMPLETO: cuando el día tiene VARIAS horas libres, el dedup por barbero+hora colapsaba
// el día a 1 slot (ambos barberos comparten la hora más temprana) → proponía "las 10",
// escondía la tarde → "a las 5" fallaba → PERDÍA CITAS.
//
// Cura (decisión Gabriel): acotar cada caso al suyo.
//   - VARIAS horas libres → muestra representativa HONESTA (unión por hora, amplitud real:
//     "desde temprano hasta la noche…"). Proponer una sola escondería las demás.
//   - UNA sola hora libre real → se CONSERVA la propuesta negociable de R3 (no hay amplitud
//     que mostrar). "Sí" avanza a nombre en un paso; una hora distinta rutea a offer_nearest.
//
// Deterministas: Supabase fake (sin red), Anthropic con key vacía (cae al
// fallback determinista). Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleShowingSlots } from '../packages/engine/src/bot/lifestyle/states/presentingSlots';
import { handleConfirmingAppointment } from '../packages/engine/src/bot/lifestyle/states/confirmingAppointment';
import { localTimeToUTC } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { LifestyleBotContext } from '../packages/engine/src/types/lifestyle.types';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ     = 'America/Mexico_City'; // UTC-6 fijo (México sin DST desde 2022)
const DATE   = '2026-06-15';          // lunes (DOW 1)
const DOW    = 1;
const NOW    = new Date('2026-06-15T15:00:00.000Z'); // lunes ~09:00 local
const SVC    = '22222222-2222-2222-2222-222222222222';
const CARLOS = '11111111-1111-1111-1111-111111111111';
const ANDRES = '33333333-3333-3333-3333-333333333333';

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

const CARLOS_ROW: StaffRow = { id: CARLOS, name: 'Carlos', whatsapp_id: '5210000000001' };
const ANDRES_ROW: StaffRow = { id: ANDRES, name: 'Andres', whatsapp_id: '5210000000002' };

function availRow(staffId: string, start: string, end: string) {
  return { staff_id: staffId, day_of_week: DOW, start_time: start, end_time: end, break_start: null, break_end: null };
}

function localISO(localHHMM: string): string {
  return localTimeToUTC(DATE, localHHMM, TZ).toISOString();
}

// Día completo: ambos barberos 10:00–20:00 → VARIAS horas (unión 10..19) → caso de amplitud.
const BOTH_10_20 = [availRow(CARLOS, '10:00:00', '20:00:00'), availRow(ANDRES, '10:00:00', '20:00:00')];
// UNA sola hora libre: ambos 10:00–11:00 → la unión por hora colapsa a la hora 10 (un slot) →
// caso donde R3 (propuesta negociable de slot único) sigue válido (no hay amplitud).
const ONE_HOUR = [availRow(CARLOS, '10:00:00', '11:00:00'), availRow(ANDRES, '10:00:00', '11:00:00')];

function tables(avail: unknown[]): TableData {
  return {
    services:                  [{ id: SVC, name: 'Corte', description: null, duration_minutes: 30, price: 200, currency: 'MXN' }],
    staff:                     [CARLOS_ROW, ANDRES_ROW],
    staff_availability:        avail,
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: CARLOS }, { staff_id: ANDRES }],
  };
}

let bizCounter = 0;
function makeDeps(avail: unknown[] = BOTH_10_20) {
  bizCounter += 1;
  const business = {
    id:                    `biz-r3-${bizCounter}`, // único por test → aísla cache de catálogo
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
  return { business, supabase: makeSupabase(tables(avail)), anthropicKey: '', model: 'haiku' } as never;
}

function makeMsg(body: string): never {
  return {
    businessId:    'biz',
    customerPhone: '5215500000000',
    customerName:  null,
    body,
    timestamp:     NOW,
    messageId:     'wamid.test',
  } as never;
}

const AUTO_CTX: LifestyleBotContext = { serviceId: SVC, requestedDate: DATE, autoAssign: true };

// ─── A. VARIAS horas → muestra honesta de amplitud (NO propuesta de slot único) ───

test('día con VARIAS horas libres (autoAssign) → muestra honesta de amplitud, NO propuesta de slot único', async () => {
  // CAMBIO vs R3 viejo: antes el día completo colapsaba a 1 slot ("las 10") y escondía la
  // tarde → perdía citas (smoke R4.2). Ahora la unión por hora muestra la amplitud real.
  const r = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, makeDeps());

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  const ps = r.newContext.pendingSlots ?? [];
  assert.ok(ps.length > 1, 'muestra varias horas, no colapsa a 1 slot');
  assert.match(r.responseText, /desde temprano hasta la noche/i, 'amplitud honesta (ambas franjas)');
  assert.match(r.responseText, /busca[rs]?\s+otra/i, 'Versión C: deja la puerta abierta');
  // Ya NO es la propuesta de slot único de R3 (esa quedó acotada a una sola hora).
  assert.doesNotMatch(r.responseText, /¿te sirve o prefieres otra hora\?/i);
  // presentBy ausente → el cliente elige HORA, no barbero → sin nombres.
  assert.doesNotMatch(r.responseText, /Carlos|Andres/);
});

// ─── B. UNA sola hora libre → propuesta negociable de R3 (conservada) ─────────

test('día con UNA sola hora libre (autoAssign) → propuesta negociable de R3 (conservada)', async () => {
  // R3 sigue válido cuando NO hay amplitud que mostrar: una sola hora libre real → se
  // PROPONE ese slot ("¿te sirve o preferís otra?"), no se inventa amplitud.
  const r = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, makeDeps(ONE_HOUR));

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.equal(r.newContext.pendingSlots?.length, 1, 'una sola hora → un solo ancla');
  assert.match(r.responseText, /¿te sirve o prefieres otra hora\?/i, 'propuesta negociable de R3');
  assert.doesNotMatch(r.responseText, /te asigno/i);
  assert.doesNotMatch(r.responseText, /nombre/i);
  assert.equal(r.newContext.selectedSlot, undefined, 'no cierra todavía (espera el "sí")');
  // Nombra UN barbero (el round-robin pre-asignó uno para esa hora).
  const named = [/Carlos/, /Andres/].filter((re) => re.test(r.responseText));
  assert.equal(named.length, 1);
});

// ─── C. Tras propuesta R3 (una hora), "sí" → avanza a nombre en UN paso ───────

test('tras propuesta R3 (una hora), "sí" → AWAITING_BOOKING_NAME con el slot (un solo paso)', async () => {
  const deps     = makeDeps(ONE_HOUR);
  const proposal = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);
  assert.equal(proposal.newContext.pendingSlots?.length, 1);

  const r = await handleConfirmingAppointment(makeMsg('sí'), proposal.newContext, deps);

  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('10:00'));
});

// ─── D. Tras muestra honesta (varias horas), una hora MOSTRADA → selecciona ───

test('tras muestra honesta, "7pm" (hora mostrada, la noche ya NO se esconde) → selecciona y avanza a nombre', async () => {
  // La muestra honesta del día completo incluye la noche (19:00) → "7pm" cae EXACTO en una
  // ancla mostrada → se selecciona directo. Antes 19:00 estaba escondido (colapso a "las 10")
  // y "a las 5/7" caía a offer_nearest o fallaba — el síntoma del smoke.
  const deps     = makeDeps();
  const proposal = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);
  assert.equal(proposal.newState, 'CONFIRMING_APPOINTMENT');

  const r = await handleConfirmingAppointment(makeMsg('7pm'), proposal.newContext, deps);

  assert.equal(r.newState, 'AWAITING_BOOKING_NAME');
  assert.equal(r.newContext.selectedSlot, localISO('19:00'), 'agenda las 19:00 que SÍ estaban en la muestra');
});

// ─── E. Tras muestra honesta (varias horas), "sí" ambiguo → re-pregunta ───────

test('tras muestra honesta (varias horas), "sí" sin elegir cuál → re-pregunta (no auto-agenda)', async () => {
  const deps     = makeDeps();
  const proposal = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);
  assert.ok((proposal.newContext.pendingSlots?.length ?? 0) > 1);

  const r = await handleConfirmingAppointment(makeMsg('sí'), proposal.newContext, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT', 'no auto-agenda un "sí" ambiguo entre varias horas');
  assert.notEqual(r.newState, 'AWAITING_BOOKING_NAME');
  assert.match(r.responseText, /cu[aá]l/i, 'pregunta cuál de las horas');
});

// ─── F. Varios barberos con distinto arranque → muestra honesta de amplitud ───

test('varios barberos con distinto arranque (autoAssign) → muestra honesta de amplitud (sin propuesta de slot único)', async () => {
  // Carlos 10:00, Andres 12:00 → unión de horas 10..19 → varias horas → muestra honesta.
  const deps = makeDeps([availRow(CARLOS, '10:00:00', '20:00:00'), availRow(ANDRES, '12:00:00', '20:00:00')]);
  const r    = await handleShowingSlots(makeMsg(''), { ...AUTO_CTX }, deps);

  assert.equal(r.newState, 'CONFIRMING_APPOINTMENT');
  assert.ok((r.newContext.pendingSlots?.length ?? 0) > 1, 'muestra varias horas');
  assert.doesNotMatch(r.responseText, /¿te sirve o prefieres otra hora\?/i, 'no es la propuesta de slot único');
});
