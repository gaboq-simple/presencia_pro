// ─── La semana que viene (Negocio · Paso 2) — orquestador server ──────────────
// Los próximos ~7 días (a partir de MAÑANA en la tz del negocio), cada uno con su
// ocupación proyectada = citas futuras ÷ capacidad futura. Reusa la MISMA primitiva
// del pulso (`pulsoData.dayCapacity`) — la capacidad futura es sólida porque los
// horarios que vienen son los actuales, y se honran las staff_schedule_exception y
// staff_blocks ya cargados para esos días (día libre futuro baja la capacidad).
//
// 🔴 SCOPE Ola 1 (businessId de la sesión). 🔴 Es OCUPACIÓN — no toca revenue ni la
//    tabla privada de propinas. Informa dónde mirar (dato + señal), no concluye.

import { getServiceClient, loadPulsoContext, loadDateRangeRows, dayCapacity, shiftDateStr } from '@/lib/pulsoData';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
import { utcToLocalDateStr } from '@presenciapro/engine/bot/lifestyle/tzUtils';

const HORIZON_DAYS = 7;
// Estados que ocupan un slot a futuro (numerador). Excluye cancelled; no_show no aplica
// a futuro pero se incluye por consistencia con el pulso de hoy.
const BOOKED_STATUSES = ['completed', 'confirmed', 'pending', 'walkin', 'no_show'] as const;

export type SemanaDia = {
  dateStr: string;
  dow: number;
  pct: number | null;    // ocupación proyectada (0..1), null si nadie trabaja ese día
  capacity: number;
  booked: number;
  emptySlots: number;    // huecos = capacity − booked (para señalar "N huecos", no "vacío")
};

export type SemanaProxima = {
  days: SemanaDia[];
};

export async function getPulsoSemana(businessId: string, now: Date = new Date()): Promise<SemanaProxima> {
  const ctx = await loadPulsoContext(businessId);
  const tz = ctx.tz;
  const today = todayStrInTz(tz, now);

  // Próximos HORIZON_DAYS a partir de mañana.
  const first = shiftDateStr(today, 1);
  const last = shiftDateStr(today, HORIZON_DAYS);
  const dateStrs: string[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) dateStrs.push(shiftDateStr(first, i));

  const rangeRows = await loadDateRangeRows(businessId, ctx, first, last);

  // Una sola query de citas para todo el rango; bucketeo por día local + barbero.
  const bookedByDayStaff = new Map<string, Map<string, number>>();
  for (const d of dateStrs) bookedByDayStaff.set(d, new Map());

  if (ctx.barbers.length > 0) {
    const supabase = getServiceClient();
    const startISO = localDayRangeUtc(first, tz).start;
    const endISO = localDayRangeUtc(last, tz).end;
    const { data } = await tenantDb(supabase, businessId)
      .table('appointments')
      .select('staff_id, status, starts_at')
      .gte('starts_at', startISO)
      .lt('starts_at', endISO)
      .in('status', BOOKED_STATUSES as unknown as string[]);

    for (const r of (data ?? []) as { staff_id: string; status: string; starts_at: string }[]) {
      const localDate = utcToLocalDateStr(new Date(r.starts_at), tz);
      const perStaff = bookedByDayStaff.get(localDate);
      if (perStaff) perStaff.set(r.staff_id, (perStaff.get(r.staff_id) ?? 0) + 1);
    }
  }

  const days: SemanaDia[] = dateStrs.map((d) => {
    const occ = dayCapacity(d, ctx, rangeRows, bookedByDayStaff.get(d) ?? new Map());
    return {
      dateStr: d,
      dow: occ.dow,
      pct: occ.pct,
      capacity: occ.capacity,
      booked: occ.booked,
      emptySlots: Math.max(0, occ.capacity - occ.booked),
    };
  });

  return { days };
}
