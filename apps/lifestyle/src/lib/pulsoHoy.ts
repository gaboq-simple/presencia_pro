// ─── Pulso de hoy (Negocio · Paso 1) — orquestador server ─────────────────────
// El pulso operativo del día: gauge de ocupación (vs. mismo día la semana pasada),
// proyección de ingreso en tres capas, métricas del día (citas/no-shows/walk-ins con
// comparación) y barberos de hoy (ocupación % + lo que rindió).
//
// Reusa la primitiva única de capacidad (`pulsoData.dayCapacity`) — no duplica la
// matemática. TZ del negocio en todo (los días salen de la tz, no del server).
// 🔴 SCOPE Ola 1 (businessId de la sesión). 🔴 Cero propinas: revenue =
//    price_charged ∥ services.price sobre citas (nunca la tabla privada del barbero).

import { getServiceClient, loadPulsoContext, loadDateRangeRows, dayCapacity, shiftDateStr } from '@/lib/pulsoData';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
import { projectionLayers, occupancyDeltaPoints, type Projection } from '@/lib/pulso';

// Estados que ocupan un slot (numerador de ocupación). no_show incluido: ocupó el lugar.
const BOOKED_STATUSES = ['completed', 'confirmed', 'pending', 'walkin', 'no_show'] as const;

type ApptRow = {
  staff_id: string;
  status: string;
  starts_at: string;
  price_charged: number | null;
  service: { price: number } | null;
};

export type DayMetric = { today: number; lastWeek: number | null };

export type PulsoBarbero = {
  staffId: string;
  staffName: string;
  pct: number | null;      // ocupación de hoy (null si no trabaja hoy)
  booked: number;
  capacity: number;
  revenue: number;         // lo que rindió hoy (completadas × precio)
};

export type PulsoHoy = {
  dateStr: string;
  occupancyPct: number | null;     // ocupación de hoy (0..1), null si nadie agenda hoy
  occupancyDeltaPoints: number | null; // vs. mismo día la semana pasada (puntos %), null si no comparable
  capacity: number;
  booked: number;
  projection: Projection;
  citas: DayMetric;
  noShows: DayMetric;
  walkIns: DayMetric;
  noShowRate30d: number | null;    // tasa de no-show en ventana móvil 30 días
  barberos: PulsoBarbero[];
};

// Trae las citas de un día (rango tz-aware) con lo necesario para ocupación + revenue.
async function fetchDayAppts(businessId: string, dateStr: string, tz: string): Promise<ApptRow[]> {
  const supabase = getServiceClient();
  const { start, end } = localDayRangeUtc(dateStr, tz);
  const { data } = await tenantDb(supabase, businessId)
    .table('appointments')
    .select('staff_id, status, starts_at, price_charged, service:service_id(price)')
    .gte('starts_at', start)
    .lt('starts_at', end);
  return (data ?? []) as unknown as ApptRow[];
}

function bookedByStaff(rows: ApptRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if ((BOOKED_STATUSES as readonly string[]).includes(r.status)) {
      m.set(r.staff_id, (m.get(r.staff_id) ?? 0) + 1);
    }
  }
  return m;
}

const countStatus = (rows: ApptRow[], status: string): number => rows.filter((r) => r.status === status).length;
const priceOf = (r: ApptRow): number => Number(r.price_charged ?? r.service?.price ?? 0);

export async function getPulsoHoy(businessId: string, now: Date = new Date()): Promise<PulsoHoy> {
  const ctx = await loadPulsoContext(businessId);
  const tz = ctx.tz;
  const today = todayStrInTz(tz, now);
  const lastWeek = shiftDateStr(today, -7);
  const monthAgo = shiftDateStr(today, -30);

  // Excepciones/bloqueos que cubren hoy y el mismo día la semana pasada (para capacidad).
  const rangeRows = await loadDateRangeRows(businessId, ctx, lastWeek, today);

  // Citas de hoy y del mismo día la semana pasada.
  const [todayRows, lastWeekRows] = await Promise.all([
    fetchDayAppts(businessId, today, tz),
    fetchDayAppts(businessId, lastWeek, tz),
  ]);

  const occToday = dayCapacity(today, ctx, rangeRows, bookedByStaff(todayRows));
  const occLastWeek = dayCapacity(lastWeek, ctx, rangeRows, bookedByStaff(lastWeekRows));

  // ── Proyección (tres capas) ──
  const nowMs = now.getTime();
  const completedRevenue = todayRows.filter((r) => r.status === 'completed').reduce((s, r) => s + priceOf(r), 0);
  const scheduledRevenue = todayRows
    .filter((r) => (r.status === 'confirmed' || r.status === 'pending') && new Date(r.starts_at).getTime() >= nowMs)
    .reduce((s, r) => s + priceOf(r), 0);
  const emptySlots = Math.max(0, occToday.capacity - occToday.booked);
  const projection = projectionLayers({ completedRevenue, scheduledRevenue, emptySlots, repPrice: ctx.repPrice });

  // ── No-show 30d (ventana móvil) ──
  const noShowRate30d = await getNoShowRate30d(businessId, monthAgo, today, tz);

  // ── Barberos de hoy: ocupación (de occToday) + revenue de hoy ──
  const revByStaff = new Map<string, number>();
  for (const r of todayRows) if (r.status === 'completed') revByStaff.set(r.staff_id, (revByStaff.get(r.staff_id) ?? 0) + priceOf(r));
  const barberos: PulsoBarbero[] = occToday.perBarber.map((pb) => ({
    staffId: pb.staffId,
    staffName: pb.staffName,
    pct: pb.pct,
    booked: pb.booked,
    capacity: pb.capacity,
    revenue: Math.round(revByStaff.get(pb.staffId) ?? 0),
  }));

  return {
    dateStr: today,
    occupancyPct: occToday.pct,
    occupancyDeltaPoints: occupancyDeltaPoints(occToday.pct, occLastWeek.pct),
    capacity: occToday.capacity,
    booked: occToday.booked,
    projection,
    citas: { today: occToday.booked, lastWeek: occLastWeek.capacity > 0 ? occLastWeek.booked : null },
    noShows: { today: countStatus(todayRows, 'no_show'), lastWeek: countStatus(lastWeekRows, 'no_show') },
    walkIns: { today: countStatus(todayRows, 'walkin'), lastWeek: countStatus(lastWeekRows, 'walkin') },
    noShowRate30d,
    barberos,
  };
}

// Tasa de no-show sobre completadas+no_show en [monthAgo, today] (inclusive del día).
async function getNoShowRate30d(businessId: string, fromDateStr: string, toDateStr: string, tz: string): Promise<number | null> {
  const supabase = getServiceClient();
  const start = localDayRangeUtc(fromDateStr, tz).start;
  const end = localDayRangeUtc(toDateStr, tz).end;
  const { data } = await tenantDb(supabase, businessId)
    .table('appointments')
    .select('status')
    .in('status', ['completed', 'no_show'])
    .gte('starts_at', start)
    .lt('starts_at', end);
  const rows = (data ?? []) as { status: string }[];
  const noShow = rows.filter((r) => r.status === 'no_show').length;
  const denom = rows.length;
  return denom > 0 ? noShow / denom : null;
}
