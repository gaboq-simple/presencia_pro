// T14 (aislado) — corte del filtro de generación por turno alineado a 14:00.
// Cambio APARTE del feature de disponibilidad honesta: generateSlotsForStaff usaba
// 13:00 para filtrar shift='morning'/'afternoon'; ahora usa AFTERNOON_CUTOFF=14:00,
// consistente con el bucketing de franjas. La banda 13:00–14:00 pasa de tarde a mañana.
//
// Día 13:00–15:00 (slots de 30m: 13:00, 13:30, 14:00, 14:30):
//   - shift='afternoon' (nuevo): solo 14:00 y 14:30 (terminan después de 14:00).
//     ANTES (13:00): incluía 13:00 y 13:30 → este test FALLA contra el código viejo.
//   - shift='morning'   (nuevo): incluye 13:00 y 13:30. ANTES rompía en 13:00 → mañana
//     vacía → también FALLA contra el viejo.
//
// Determinista: Supabase fake (sin red), sin Anthropic. Ejecutar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getDayAvailability } from '../packages/engine/src/bot/lifestyle/scheduling';
import { noonUTCDate, weekdayFromDateStr, utcToLocalMinutes } from '../packages/engine/src/bot/lifestyle/tzUtils';
import type { StaffRow } from '../packages/engine/src/bot/lifestyle/types';

const TZ       = 'America/Mexico_City';
const DATE_STR = '2026-06-10';
const DOW      = weekdayFromDateStr(DATE_STR);
const STAFF: StaffRow = { id: 'staff-carlos', name: 'Carlos', whatsapp_id: '5210000000000' };

type TableData = Record<string, unknown[]>;
function makeSupabase(tables: TableData) {
  const from = (table: string) => {
    const data = tables[table] ?? [];
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder, gte: () => builder,
      lt: () => builder, neq: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data, error: null }),
    };
    return builder;
  };
  return { from } as never;
}

// Día 13:00–15:00 (cruza el corte 14:00).
function supabase1300to1500(): never {
  return makeSupabase({
    staff_availability:        [{ staff_id: STAFF.id, day_of_week: DOW, start_time: '13:00:00', end_time: '15:00:00', break_start: null, break_end: null }],
    appointments:              [],
    staff_blocks:              [],
    staff_schedule_exceptions: [],
    staff_services:            [{ staff_id: STAFF.id }],
  });
}

function opts(shift: 'morning' | 'afternoon', supabase: never) {
  return {
    businessId: 'biz-1', serviceId: 'svc-corte', durationMinutes: 30,
    requestedDate: noonUTCDate(DATE_STR), shift, preferredStaffId: STAFF.id,
    isWalkIn: false, walkInBufferMinutes: 60, staffToQuery: [STAFF], supabase, tz: TZ,
  };
}

test('T14a shift=afternoon: el corte es 14:00 → el slot 13:30 (termina 14:00) ya NO es tarde', async () => {
  // El filtro de tarde es sobre slotEnd (> corte). El slot 13:30–14:00 (termina
  // justo a las 14:00) es el pivote: con corte 14:00 queda EXCLUIDO; con el corte
  // viejo de 13:00 estaba incluido → esta aserción FALLA contra el código viejo.
  const shape = await getDayAvailability(opts('afternoon', supabase1300to1500()));
  const mins  = shape.all.map((s) => utcToLocalMinutes(s.startsAt, TZ));
  assert.ok(mins.length > 0, 'debe haber slots de tarde');
  assert.ok(!mins.includes(13 * 60 + 30), 'el slot 13:30 (termina 14:00) NO cuenta como tarde con el corte 14:00');
});

test('T14b shift=morning: la banda 13:00–14:00 ahora cuenta como mañana (incluye 13:30)', async () => {
  const shape = await getDayAvailability(opts('morning', supabase1300to1500()));
  const mins = shape.all.map((s) => utcToLocalMinutes(s.startsAt, TZ));
  assert.ok(mins.includes(13 * 60 + 30), 'incluye el slot 13:30 (antes la mañana rompía en 13:00)');
  for (const m of mins) assert.ok(m < 14 * 60, 'todo slot de mañana empieza < 14:00');
});
