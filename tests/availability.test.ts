// S4-BOT-06 (FASE A) — Tests de disponibilidad y parseo de fecha TZ-safe.
// Puros y deterministas: sin red, sin Supabase real, sin Anthropic.
// Ejecutar: npm test
//
// Cubre:
//   1. Reproducción del bug "Carlos": barbero disponible día N de 10:00–20:00,
//      vinculado al servicio → pedir slot ese día a las 17:00 DEBE encontrarlo.
//   2. Timezone: "mañana"/"hoy" se calculan en America/Mexico_City (no UTC), y
//      un slot 17:00 local no se descarta por el offset UTC-6.
//   3. Slot ocupado → no se ofrece.
//   4. Sin disponibilidad ese día (no hay staff_availability) → array vacío.
//   5. Fecha pasada (mes/día ya transcurrido este año) → rueda al próximo año.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getDayAvailability } from '../packages/engine/src/bot/lifestyle/scheduling';
import { parseDate } from '../packages/engine/src/bot/lifestyle/states/qualifyingDatetime';
import {
  noonUTCDate,
  weekdayFromDateStr,
  localTimeToUTC,
  utcToLocalMinutes,
} from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

// El ex-wrapper getAvailableSlots se eliminó (fuente única = getDayAvailability). Estos tests
// prueban la GENERACIÓN de slots (que 17:00 exista, que un slot ocupado no se ofrezca, etc.);
// el truncado a ≤3 es incidental → shim local idéntico byte-a-byte al ex-wrapper.
const getAvailableSlots = async (opts: Parameters<typeof getDayAvailability>[0]) =>
  (await getDayAvailability(opts)).all.slice(0, 3);

// ─── Fake Supabase ────────────────────────────────────────────────────────────
// Builder encadenable y "thenable": cada método retorna el mismo builder; al
// hacer `await` se resuelve con { data, error } según la tabla. maybeSingle()
// resuelve a un único registro (o null).

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
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      // Thenable: `await builder` → { data, error }
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return builder;
  };
  // El cast a never evita arrastrar el tipo completo de SupabaseClient en el test.
  return { from } as never;
}

// ─── Fixtures comunes ─────────────────────────────────────────────────────────

const TZ        = 'America/Mexico_City';
const DATE_STR  = '2026-06-10';                  // miércoles
const DOW       = weekdayFromDateStr(DATE_STR);  // weekday TZ-independiente
const STAFF: StaffRow = { id: 'staff-carlos', name: 'Carlos', whatsapp_id: '5210000000000' };

function availabilityRow(start: string, end: string) {
  return {
    staff_id:    STAFF.id,
    day_of_week: DOW,
    start_time:  start,
    end_time:    end,
    break_start: null,
    break_end:   null,
  };
}

function baseOpts(supabase: never) {
  return {
    businessId:          'biz-1',
    serviceId:           'svc-corte',
    durationMinutes:     30,
    requestedDate:       noonUTCDate(DATE_STR),
    shift:               null as 'morning' | 'afternoon' | null,
    preferredStaffId:    null as string | null,
    isWalkIn:            false,
    walkInBufferMinutes: 60,
    staffToQuery:        [STAFF],
    supabase,
    tz:                  TZ,
  };
}

// ─── 1. Reproducción del bug "Carlos" ─────────────────────────────────────────

test('bug Carlos: barbero 10:00–20:00 vinculado al servicio → slot 17:00 SÍ se encuentra', async () => {
  const supabase = makeSupabase({
    staff_availability:         [availabilityRow('10:00:00', '20:00:00')],
    appointments:               [],
    staff_blocks:               [],
    staff_schedule_exceptions:  [],
    staff_services:             [{ staff_id: STAFF.id }],  // vinculado al servicio
  });

  const slots = await getAvailableSlots({ ...baseOpts(supabase), requestedTime: '17:00' });

  assert.ok(slots.length > 0, 'debe haber al menos un slot disponible');

  // Con requestedTime '17:00', el más cercano (exacto) debe ser 17:00 local.
  const firstLocalMin = utcToLocalMinutes(slots[0]!.startsAt, TZ);
  assert.equal(firstLocalMin, 17 * 60, 'el primer slot debe ser exactamente 17:00 local');
  assert.equal(slots[0]!.staffId, STAFF.id);
});

// ─── 2. Timezone ──────────────────────────────────────────────────────────────

test('parseDate "mañana"/"hoy" se calculan en MX, no en UTC del runtime', () => {
  // 2026-06-10T04:00:00Z = 2026-06-09 22:00 en MX (UTC-6).
  // El día local es 09, NO 10. "hoy" → 09, "mañana" → 10.
  const now = new Date('2026-06-10T04:00:00Z');
  assert.equal(parseDate('hoy', now, TZ),    '2026-06-09');
  assert.equal(parseDate('mañana', now, TZ), '2026-06-10');
});

test('timezone: el slot 17:00 local mapea a 23:00Z (UTC-6) y no se descarta por offset', async () => {
  const supabase = makeSupabase({
    staff_availability:         [availabilityRow('10:00:00', '20:00:00')],
    appointments:               [],
    staff_blocks:               [],
    staff_schedule_exceptions:  [],
    staff_services:             [{ staff_id: STAFF.id }],
  });

  const slots = await getAvailableSlots({ ...baseOpts(supabase), requestedTime: '17:00' });
  const slot1700 = slots.find((s) => utcToLocalMinutes(s.startsAt, TZ) === 17 * 60);
  assert.ok(slot1700, 'el slot 17:00 local debe existir');
  // 17:00 MX (UTC-6, sin DST) = 23:00 UTC.
  assert.equal(slot1700!.startsAt.getUTCHours(), 23);
});

// ─── 3. Slot ocupado ──────────────────────────────────────────────────────────

test('slot ocupado: una cita 17:00–17:30 hace que 17:00 NO se ofrezca', async () => {
  const startsAt = localTimeToUTC(DATE_STR, '17:00', TZ);
  const endsAt   = localTimeToUTC(DATE_STR, '17:30', TZ);

  const supabase = makeSupabase({
    staff_availability:         [availabilityRow('10:00:00', '20:00:00')],
    appointments:               [{ staff_id: STAFF.id, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }],
    staff_blocks:               [],
    staff_schedule_exceptions:  [],
    staff_services:             [{ staff_id: STAFF.id }],
  });

  const slots = await getAvailableSlots({ ...baseOpts(supabase), requestedTime: '17:00' });
  const at1700 = slots.find((s) => utcToLocalMinutes(s.startsAt, TZ) === 17 * 60);
  assert.equal(at1700, undefined, '17:00 está ocupado y no debe ofrecerse');
  // Pero debe ofrecer la alternativa más cercana del mismo día.
  assert.ok(slots.length > 0, 'debe ofrecer alternativas cercanas');
});

// ─── 4. Sin disponibilidad ese día ────────────────────────────────────────────

test('sin staff_availability ese día → array vacío (sin slots)', async () => {
  const supabase = makeSupabase({
    staff_availability:         [],   // el barbero no trabaja ese día
    appointments:               [],
    staff_blocks:               [],
    staff_schedule_exceptions:  [],
    staff_services:             [{ staff_id: STAFF.id }],
  });

  const slots = await getAvailableSlots({ ...baseOpts(supabase), requestedTime: '17:00' });
  assert.equal(slots.length, 0);
});

// ─── 4b. Servicio NO vinculado al staff ───────────────────────────────────────

test('staff sin staff_services para el servicio → no se ofrecen slots', async () => {
  const supabase = makeSupabase({
    staff_availability:         [availabilityRow('10:00:00', '20:00:00')],
    appointments:               [],
    staff_blocks:               [],
    staff_schedule_exceptions:  [],
    staff_services:             [],   // NO vinculado
  });

  const slots = await getAvailableSlots({ ...baseOpts(supabase), requestedTime: '17:00' });
  assert.equal(slots.length, 0);
});

// ─── 5. Fecha pasada → rueda al próximo año ───────────────────────────────────

test('parseDate fecha ya transcurrida este año → próximo año', () => {
  // now = 2026-06-10; "5 de enero" ya pasó → 2027-01-05.
  const now = new Date('2026-06-10T18:00:00Z');
  assert.equal(parseDate('5 de enero', now, TZ), '2027-01-05');
  // Una fecha futura del mismo año se mantiene.
  assert.equal(parseDate('20 de diciembre', now, TZ), '2026-12-20');
});
