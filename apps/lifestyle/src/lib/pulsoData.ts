// ─── Pulso (Negocio) — capa de datos server, compartida hoy + semana ──────────
// Carga el contexto de capacidad (barberos activos, servicio representativo, horarios
// recurrentes) y, por rango de fechas, las excepciones/bloqueos ya cargados. Expone
// `dayCapacity(dateStr)` — la MISMA primitiva para hoy y para cualquier día futuro:
// tiling greedy de los candidatos del bot por barbero, honrando break, staff_blocks y
// staff_schedule_exception de ESE día. No hay dos definiciones de "slot".
//
// 🔴 SCOPE Ola 1: businessId de la sesión; cada tabla con business_id va por tenantDb.
//    staff_availability / staff_blocks NO tienen business_id (se scopean por staff_id,
//    que ya viene filtrado por negocio) → `.from()` directo, igual que el engine.
// 🔴 El pulso es OCUPACIÓN — esta capa nunca toca la tabla privada de propinas.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc } from '@/lib/dayWindow';
import { generateSlotsForStaff } from '@presenciapro/engine/bot/lifestyle/scheduling';
import { noonUTCDate, weekdayFromDateStr } from '@presenciapro/engine/bot/lifestyle/tzUtils';
import type { StaffAvailabilityRow } from '@presenciapro/engine/bot/lifestyle/types';
import { tileCapacity, occupancyPct } from '@/lib/pulso';

export function getServiceClient(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/** 'YYYY-MM-DD' desplazada `days` (puede ser negativo). Ancla a mediodía UTC →
 *  sumar días enteros nunca cruza un borde DST. TZ-independiente del runtime. */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = noonUTCDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Barber = { id: string; name: string };
type AvailRow = StaffAvailabilityRow;
type ExceptionRow = { staff_id: string; exception_date: string; available: boolean; start_time: string | null; end_time: string | null };
type BlockRow = { staff_id: string; starts_at: string; ends_at: string };

/** Contexto de capacidad — lo recurrente (no depende de la fecha). */
export type PulsoContext = {
  tz: string;
  barbers: Barber[];
  repDuration: number;
  repPrice: number;
  availabilityRows: AvailRow[];
};

/** Excepciones + bloqueos ya cargados para un rango de fechas (capacidad honesta futura). */
export type DateRangeRows = {
  exceptionRows: ExceptionRow[];
  blockRows: BlockRow[];
};

/** Ocupación de un día: total + desglose por barbero. */
export type DayOccupancy = {
  dateStr: string;
  dow: number;
  capacity: number;
  booked: number;
  pct: number | null;
  perBarber: Array<{ staffId: string; staffName: string; capacity: number; booked: number; pct: number | null }>;
};

// ── Contexto: barberos activos + servicio representativo + horarios recurrentes ──
export async function loadPulsoContext(businessId: string): Promise<PulsoContext> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  const { data: biz } = await supabase.from('businesses').select('timezone').eq('id', businessId).maybeSingle();
  const tz = (biz as { timezone: string | null } | null)?.timezone ?? 'America/Mexico_City';

  const { data: staffData } = await db.table('staff').select('id, name').eq('role', 'barber').eq('active', true);
  const barbers = ((staffData ?? []) as Barber[]).map((s) => ({ id: s.id, name: s.name }));
  const staffIds = barbers.map((b) => b.id);

  // Servicio representativo = el más completado (proxy de duración/precio de capacidad).
  const { data: svcData } = await db.table('services').select('id, duration_minutes, price').eq('active', true);
  const services = (svcData ?? []) as { id: string; duration_minutes: number; price: number }[];
  let repService = services[0] ?? null;
  if (services.length > 1) {
    const { data: apptSvc } = await db
      .table('appointments').select('service_id').eq('status', 'completed').not('service_id', 'is', null);
    const counts = new Map<string, number>();
    for (const r of (apptSvc ?? []) as { service_id: string }[]) counts.set(r.service_id, (counts.get(r.service_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) repService = services.find((s) => s.id === top[0]) ?? repService;
  }
  const repDuration = repService?.duration_minutes ?? 30;
  const repPrice = Number(repService?.price ?? 0);

  // Horarios recurrentes activos de los barberos.
  let availabilityRows: AvailRow[] = [];
  if (staffIds.length > 0) {
    const { data: availData } = await supabase
      .from('staff_availability')
      .select('staff_id, day_of_week, start_time, end_time, break_start, break_end')
      .in('staff_id', staffIds)
      .eq('is_active', true);
    availabilityRows = (availData ?? []) as AvailRow[];
  }

  return { tz, barbers, repDuration, repPrice, availabilityRows };
}

// ── Excepciones + bloqueos aprobados para [fromDateStr, toDateStr] (inclusive) ──
export async function loadDateRangeRows(
  businessId: string,
  ctx: PulsoContext,
  fromDateStr: string,
  toDateStr: string,
): Promise<DateRangeRows> {
  const supabase = getServiceClient();
  const staffIds = ctx.barbers.map((b) => b.id);
  if (staffIds.length === 0) return { exceptionRows: [], blockRows: [] };

  // Ventana UTC que cubre [from 00:00 local, to+1 00:00 local) para los bloqueos.
  const startISO = localDayRangeUtc(fromDateStr, ctx.tz).start;
  const endISO = localDayRangeUtc(toDateStr, ctx.tz).end;

  const [excRes, blkRes] = await Promise.all([
    tenantDb(supabase, businessId)
      .table('staff_schedule_exceptions')
      .select('staff_id, exception_date, available, start_time, end_time')
      .in('staff_id', staffIds)
      .gte('exception_date', fromDateStr)
      .lte('exception_date', toDateStr),
    supabase
      .from('staff_blocks')
      .select('staff_id, starts_at, ends_at')
      .in('staff_id', staffIds)
      .eq('status', 'approved')
      .lt('starts_at', endISO)
      .gt('ends_at', startISO),
  ]);

  return {
    exceptionRows: (excRes.data ?? []) as ExceptionRow[],
    blockRows: (blkRes.data ?? []) as BlockRow[],
  };
}

// ── Capacidad de un día — la primitiva única (tiling greedy por barbero) ────────
// Honra el horario recurrente de ese día-de-semana, el break, los staff_blocks
// aprobados y la staff_schedule_exception (día libre → 0, horario especial → reemplaza).
// bookedByStaff: conteo de citas agendadas del día por barbero (numerador).
export function dayCapacity(
  dateStr: string,
  ctx: PulsoContext,
  rows: DateRangeRows,
  bookedByStaff: Map<string, number>,
): DayOccupancy {
  const dow = weekdayFromDateStr(dateStr);
  const reqDate = noonUTCDate(dateStr);
  const { start: dayStart, end: dayEnd } = localDayRangeUtc(dateStr, ctx.tz);
  const dayStartMs = new Date(dayStart).getTime();
  const dayEndMs = new Date(dayEnd).getTime();

  const perBarber: DayOccupancy['perBarber'] = [];
  let totalCapacity = 0;
  let totalBooked = 0;

  for (const b of ctx.barbers) {
    const avail = ctx.availabilityRows.find((r) => r.staff_id === b.id && r.day_of_week === dow);
    const booked = bookedByStaff.get(b.id) ?? 0;

    let capacity = 0;
    if (avail) {
      const exception = rows.exceptionRows.find((e) => e.staff_id === b.id && e.exception_date === dateStr) ?? null;
      // Bloqueos del barbero que solapan el día (día libre puntual, vacaciones).
      const blocks = rows.blockRows
        .filter((k) => k.staff_id === b.id && new Date(k.starts_at).getTime() < dayEndMs && new Date(k.ends_at).getTime() > dayStartMs)
        .map((k) => ({ starts_at: k.starts_at, ends_at: k.ends_at }));

      // Capacidad = candidatos del bot con ocupación VACÍA (lo que se podía vender),
      // menos break/bloqueos/excepción, tileados sin solaparse.
      const slots = generateSlotsForStaff(
        b.id, b.name, avail, reqDate, dateStr, ctx.repDuration,
        [], blocks, null, null, ctx.tz, exception,
      );
      capacity = tileCapacity(slots.map((s) => ({ startsAtMs: s.startsAt.getTime(), endsAtMs: s.endsAt.getTime() })));
    }

    perBarber.push({ staffId: b.id, staffName: b.name, capacity, booked, pct: occupancyPct(booked, capacity) });
    totalCapacity += capacity;
    totalBooked += booked;
  }

  return {
    dateStr,
    dow,
    capacity: totalCapacity,
    booked: totalBooked,
    pct: occupancyPct(totalBooked, totalCapacity),
    perBarber,
  };
}
