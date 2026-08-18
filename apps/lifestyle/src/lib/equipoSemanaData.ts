// ─── equipoSemanaData — la capa de datos de "El equipo · esta semana" ────────
// Server-only. Arma el insumo de `computeEquipoSemana` (puro) con la MISMA regla
// que `/api/reports/staff-metrics?period=week`: mismo rango (`getPeriodRange`,
// acotado a la tz del negocio), mismos estados y el mismo ingreso
// (`price_charged ?? services.price` sobre completadas). Coincidir con ese panel
// no es una casualidad que haya que cuidar: es el caso numérico del paso.
//
// Va por el server y no por el endpoint client-side a propósito. El panel que
// reemplaza tarda 1–3.3 s en dev con el seed denso y deja un "Cargando…" que
// cambia el alto de la página en miles de píxeles — el modo de falla que ya
// arruinó una red visual (D1). Renderizado en el server, la card llega con la
// página y no hay estado intermedio que capturar mal.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { getPeriodRange } from '@/lib/dashboard.types';
import { staffColorIndex } from '@/lib/staffColors';
import { computeEquipoSemana, type EquipoStaffInput, type EquipoSemana } from '@/lib/equipoSemana';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type RawStaffRow = { id: string; name: string };

type RawApptRow = {
  staff_id: string;
  status:   string;
  price_charged: number | null;
  service:  { price: number } | null;
};

/**
 * El equipo de la semana que contiene `date`, en la tz del negocio.
 * `date` es el día ancla del dashboard — la semana es la suya (lunes→domingo),
 * no "los últimos 7 días": navegar al martes pasado tiene que mostrar ESA semana.
 */
export async function getEquipoSemana(
  businessId: string,
  date: string,
  timezone: string,
): Promise<EquipoSemana> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const { start, end } = getPeriodRange('week', date, timezone);

  const { data: staffData, error: staffError } = await db
    .table('staff')
    .select('id, name')
    .eq('active', true)
    .order('name');
  if (staffError) throw new Error(`getEquipoSemana staff failed: ${staffError.message}`);

  const staffList = (staffData ?? []) as RawStaffRow[];
  if (staffList.length === 0) {
    return computeEquipoSemana([], new Map());
  }

  const { data: apptData, error: apptError } = await db
    .table('appointments')
    .select('staff_id, status, price_charged, service:service_id(price)')
    .in('staff_id', staffList.map((s) => s.id))
    .gte('starts_at', start)
    .lt('starts_at', end)
    .in('status', ['completed', 'no_show']);
  if (apptError) throw new Error(`getEquipoSemana appointments failed: ${apptError.message}`);

  const acc = new Map<string, EquipoStaffInput>(
    staffList.map((s) => [s.id, { staffId: s.id, name: s.name, revenue: 0, completed: 0, noShow: 0 }]),
  );

  for (const row of (apptData ?? []) as unknown as RawApptRow[]) {
    const a = acc.get(row.staff_id);
    if (!a) continue;
    if (row.status === 'completed') {
      a.completed++;
      // Precio SELLADO al completar (migración 049); el vivo solo si falta el sello.
      // Idéntico a staff-metrics: el fallback exige que el embed exista.
      if (row.service) a.revenue += row.price_charged ?? row.service.price;
    } else if (row.status === 'no_show') {
      a.noShow++;
    }
  }

  return computeEquipoSemana([...acc.values()], staffColorIndex(staffList));
}
