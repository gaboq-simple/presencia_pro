// ─── La fuga (Negocio · Panorama) — capa de datos server ──────────────────────
// (1) Capacidad sin usar de la SEMANA QUE PASÓ (últimos 7 días): reusa la primitiva
//     de capacidad (generateSlotsForStaff + tiling de lib/pulso) bucketeada por
//     día×franja, menos las citas que la ocuparon → huecos.
// (2) Faltas repetidas: clientes con 2+ no-shows en el mes. Solo dato (sin acción —
//     las señas no existen en el sistema).
//
// 🔴 Caveat conocido: la capacidad histórica se aproxima con el horario ACTUAL
//    (staff_availability no versiona el pasado). Por eso la ventana es de 7 días —
//    los horarios rara vez cambiaron en una semana. Se honran excepciones/bloqueos
//    ya cargados de esos días.
// 🔴 SCOPE Ola 1 (businessId de la sesión). 🔴 Cero propinas.

import { getServiceClient, loadPulsoContext, loadDateRangeRows, shiftDateStr } from '@/lib/pulsoData';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
import { getPeriodRange } from '@/lib/dashboard.types';
import { generateSlotsForStaff } from '@presenciapro/engine/bot/lifestyle/scheduling';
import { noonUTCDate, weekdayFromDateStr, utcToLocalMinutes, utcToLocalDateStr } from '@presenciapro/engine/bot/lifestyle/tzUtils';
import { tileCapacitySlots } from '@/lib/pulso';
import { franjaOf, computeCapacidadSinUsar, type FreeCell, type Franja, type CapacidadSinUsar, type FaltaRepetida } from '@/lib/fuga';

const WINDOW_DAYS = 7;

export type Fuga = {
  capacidad: CapacidadSinUsar;
  faltas: FaltaRepetida[];
  windowDays: number;
};

export async function getFuga(businessId: string, now: Date = new Date()): Promise<Fuga> {
  const ctx = await loadPulsoContext(businessId);
  const tz = ctx.tz;
  const today = todayStrInTz(tz, now);

  // Ventana = últimos 7 días [today-7 … today-1] (la semana que acaba de pasar; no hoy,
  // que está en curso).
  const first = shiftDateStr(today, -WINDOW_DAYS);
  const last = shiftDateStr(today, -1);
  const dateStrs: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) dateStrs.push(shiftDateStr(first, i));

  const rangeRows = await loadDateRangeRows(businessId, ctx, first, last);

  // ── Capacidad por (dow × franja): tiling de la primitiva, bucketeado por franja ──
  const capByCell = new Map<string, number>();
  for (const d of dateStrs) {
    const dow = weekdayFromDateStr(d);
    const reqDate = noonUTCDate(d);
    const { start: dayStart, end: dayEnd } = localDayRangeUtc(d, tz);
    const dayStartMs = new Date(dayStart).getTime();
    const dayEndMs = new Date(dayEnd).getTime();

    for (const b of ctx.barbers) {
      const avail = ctx.availabilityRows.find((r) => r.staff_id === b.id && r.day_of_week === dow);
      if (!avail) continue;
      const exception = rangeRows.exceptionRows.find((e) => e.staff_id === b.id && e.exception_date === d) ?? null;
      const blocks = rangeRows.blockRows
        .filter((k) => k.staff_id === b.id && new Date(k.starts_at).getTime() < dayEndMs && new Date(k.ends_at).getTime() > dayStartMs)
        .map((k) => ({ starts_at: k.starts_at, ends_at: k.ends_at }));

      const slots = generateSlotsForStaff(b.id, b.name, avail, reqDate, d, ctx.repDuration, [], blocks, null, null, tz, exception);
      const tiled = tileCapacitySlots(slots.map((s) => ({ startsAtMs: s.startsAt.getTime(), endsAtMs: s.endsAt.getTime() })));
      for (const s of tiled) {
        const franja = franjaOf(utcToLocalMinutes(new Date(s.startsAtMs), tz));
        const key = `${dow}:${franja}`;
        capByCell.set(key, (capByCell.get(key) ?? 0) + 1);
      }
    }
  }

  // ── Citas que ocuparon (no-canceladas) por (dow × franja) ──
  const start = localDayRangeUtc(first, tz).start;
  const end = localDayRangeUtc(last, tz).end;
  const { data: apptData } = await tenantDb(getServiceClient(), businessId)
    .table('appointments')
    .select('starts_at, status')
    .gte('starts_at', start)
    .lt('starts_at', end)
    .neq('status', 'cancelled');

  const bookedByCell = new Map<string, number>();
  for (const row of (apptData ?? []) as { starts_at: string; status: string }[]) {
    const dt = new Date(row.starts_at);
    const dow = weekdayFromDateStr(utcToLocalDateStr(dt, tz));
    const franja = franjaOf(utcToLocalMinutes(dt, tz));
    const key = `${dow}:${franja}`;
    bookedByCell.set(key, (bookedByCell.get(key) ?? 0) + 1);
  }

  // ── Huecos por celda = capacidad − citas (clamp ≥ 0) ──
  const cells: FreeCell[] = [];
  for (const [key, cap] of capByCell) {
    const [dowStr, franja] = key.split(':') as [string, Franja];
    const booked = bookedByCell.get(key) ?? 0;
    cells.push({ dow: Number(dowStr), franja, freeSlots: Math.max(0, cap - booked) });
  }

  const capacidad = computeCapacidadSinUsar(cells, ctx.repDuration, ctx.repPrice);
  const faltas = await getFaltasRepetidas(businessId, today, tz);

  return { capacidad, faltas, windowDays: WINDOW_DAYS };
}

// ── Faltas repetidas: 2+ no-shows en el mes calendario (por cliente) ──
async function getFaltasRepetidas(businessId: string, today: string, tz: string): Promise<FaltaRepetida[]> {
  const supabase = getServiceClient();
  const { start, end } = getPeriodRange('month', today, tz);

  const { data } = await tenantDb(supabase, businessId)
    .table('appointments')
    .select('customer_id, starts_at')
    .eq('status', 'no_show')
    .not('customer_id', 'is', null)
    .gte('starts_at', start)
    .lt('starts_at', end);

  const byCustomer = new Map<string, { count: number; last: string }>();
  for (const row of (data ?? []) as { customer_id: string; starts_at: string }[]) {
    const e = byCustomer.get(row.customer_id) ?? { count: 0, last: '' };
    e.count += 1;
    if (row.starts_at > e.last) e.last = row.starts_at;
    byCustomer.set(row.customer_id, e);
  }

  const repeated = [...byCustomer.entries()].filter(([, v]) => v.count >= 2);
  if (repeated.length === 0) return [];

  const ids = repeated.map(([id]) => id);
  const { data: custs } = await tenantDb(supabase, businessId).table('customers').select('id, name').in('id', ids);
  const nameMap = new Map(((custs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const fmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: tz });

  return repeated
    .map(([id, v]) => ({
      customerId: id,
      name: nameMap.get(id) ?? 'Cliente',
      count: v.count,
      lastNoShow: v.last,
      lastLabel: fmt.format(new Date(v.last)).replace('.', ''),
    }))
    .sort((a, b) => b.count - a.count || (b.lastNoShow > a.lastNoShow ? 1 : -1));
}
