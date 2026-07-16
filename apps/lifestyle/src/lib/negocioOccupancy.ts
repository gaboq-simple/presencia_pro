// ─── Ocupación (Negocio) — aggregator server ──────────────────────────────────
// Capacidad por franja (día×hora) reusando la PRIMITIVA DEL BOT (generateSlotsForStaff)
// sobre los horarios RECURRENTES (semana típica): una sola definición de "slot". Citas
// bucketeadas por franja en una ventana. Llama al módulo puro (occupancy) para armar el
// heatmap + ocupación % + oportunidades + potencial.
// 🔴 SCOPE Ola 1: businessId de la sesión; cada query filtra por él.
// Caveat: capacidad = slots de un servicio REPRESENTATIVO (el más común) → estimada, no
// exacta con catálogo multi-servicio. Ignora excepciones/blocks por-fecha (patrón semanal).

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { generateSlotsForStaff } from '@presenciapro/engine/bot/lifestyle/scheduling';
import { utcToLocalMinutes, noonUTCDate, weekdayFromDateStr } from '@presenciapro/engine/bot/lifestyle/tzUtils';
import { assembleOccupancy, occCellKey, type OccupancyResult } from './occupancy';

const WINDOW_WEEKS = 8; // ventana de citas para el patrón de ocupación

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type AvailRow = { staff_id: string; day_of_week: number; start_time: string; end_time: string; break_start: string | null; break_end: string | null };

/** 'YYYY-MM-DD' de una fecha reciente cuyo día-de-semana (tz) == `dow`. */
function representativeDateStr(dow: number, tz: string): string {
  // Buscar hacia atrás desde hoy hasta 6 días: alguno cae en ese dow.
  const today = new Date();
  for (let back = 0; back < 7; back++) {
    const d = new Date(today.getTime() - back * 86_400_000);
    const ds = d.toISOString().slice(0, 10);
    if (weekdayFromDateStr(ds) === dow) return ds;
  }
  return today.toISOString().slice(0, 10);
}

export async function getNegocioOccupancy(
  businessId: string,
  now: Date = new Date(),
): Promise<OccupancyResult> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const nowMs = now.getTime();

  // ── Timezone del negocio ──
  const { data: biz } = await supabase.from('businesses').select('timezone').eq('id', businessId).maybeSingle();
  const tz = (biz as { timezone: string | null } | null)?.timezone ?? 'America/Mexico_City';

  // ── Barberos activos ──
  const { data: staffData } = await db
    .table('staff').select('id, name').eq('role', 'barber').eq('active', true);
  const staff = (staffData ?? []) as { id: string; name: string }[];
  const staffIds = staff.map((s) => s.id);
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  // ── Servicio representativo (el más común) → duración + precio para la capacidad ──
  const { data: svcData } = await db
    .table('services').select('id, duration_minutes, price').eq('active', true);
  const services = (svcData ?? []) as { id: string; duration_minutes: number; price: number }[];
  // El más completado; si no hay completadas, el primero.
  let repService = services[0] ?? null;
  if (services.length > 1) {
    const { data: apptSvc } = await db
      .table('appointments').select('service_id').eq('status', 'completed').not('service_id', 'is', null);
    const counts = new Map<string, number>();
    for (const r of (apptSvc ?? []) as { service_id: string }[]) counts.set(r.service_id, (counts.get(r.service_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) repService = services.find((s) => s.id === top[0]) ?? repService;
  }
  const duration = repService?.duration_minutes ?? 30;
  const repPrice = repService?.price ?? 0;

  // ── Horarios recurrentes activos ──
  const capacityByCell = new Map<string, number>();
  if (staffIds.length > 0 && repService) {
    const { data: availData } = await supabase
      .from('staff_availability')
      .select('staff_id, day_of_week, start_time, end_time, break_start, break_end')
      .in('staff_id', staffIds)
      .eq('is_active', true);

    for (const a of (availData ?? []) as AvailRow[]) {
      const dateStr = representativeDateStr(a.day_of_week, tz);
      const reqDate = noonUTCDate(dateStr);
      // Slots candidatos del bot (ocupación vacía) → misma definición de "slot".
      const slots = generateSlotsForStaff(
        a.staff_id, staffName.get(a.staff_id) ?? '', a,
        reqDate, dateStr, duration,
        [], [], null, null, tz, null,
      ).slice().sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
      // Capacidad REALIZABLE: los candidatos van cada 15 min (se solapan); una cita bloquea
      // los siguientes. Tiling greedy no-solapado = throughput real del barbero (minutos/
      // duración), no las posiciones de arranque. Bucket por hora del slot que SÍ entra.
      let lastEndMs = -Infinity;
      for (const s of slots) {
        if (s.startsAt.getTime() < lastEndMs) continue; // se solapa con el anterior tomado
        lastEndMs = s.endsAt.getTime();
        const hour = Math.floor(utcToLocalMinutes(s.startsAt, tz) / 60);
        const k = occCellKey(a.day_of_week, hour);
        capacityByCell.set(k, (capacityByCell.get(k) ?? 0) + 1);
      }
    }
  }

  // ── Citas de la ventana (completadas + confirmadas) por franja ──
  const windowStart = new Date(nowMs - WINDOW_WEEKS * 7 * 86_400_000);
  const { data: apptData } = await db
    .table('appointments')
    .select('starts_at')
    .in('status', ['completed', 'confirmed'])
    .gte('starts_at', windowStart.toISOString())
    .lte('starts_at', now.toISOString());

  const bookedByCell = new Map<string, number>();
  const dowCounts: Record<number, number> = {};
  for (const r of (apptData ?? []) as { starts_at: string }[]) {
    const d = new Date(r.starts_at);
    const localMin = utcToLocalMinutes(d, tz);
    const hour = Math.floor(localMin / 60);
    // día-de-semana local: fecha local del negocio.
    const localDateStr = new Date(d.getTime()).toLocaleDateString('en-CA', { timeZone: tz });
    const dow = weekdayFromDateStr(localDateStr);
    const k = occCellKey(dow, hour);
    bookedByCell.set(k, (bookedByCell.get(k) ?? 0) + 1);
  }

  // Cuántas veces aparece cada día-de-semana en la ventana (denominador de ocupación).
  for (let back = 0; back < WINDOW_WEEKS * 7; back++) {
    const ds = new Date(nowMs - back * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz });
    const dow = weekdayFromDateStr(ds);
    dowCounts[dow] = (dowCounts[dow] ?? 0) + 1;
  }

  return assembleOccupancy(capacityByCell, bookedByCell, dowCounts, repPrice);
}
