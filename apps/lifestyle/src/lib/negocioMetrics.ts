// ─── Ingresos (Negocio) — aggregator server ───────────────────────────────────
// Arma el bloque de Ingresos: héroe del mes en curso, comparación con el mismo tramo
// del mes anterior, y la serie de 6 meses. La matemática de fechas vive en el módulo
// puro (revenueTrend); acá se suma el revenue SELLADO por ventana.
// 🔴 SCOPE: businessId de la sesión del owner (Ola 1); cada query filtra por él.
// 🔴 Precio: COALESCE(price_charged, service.price) sobre completadas — idéntico a #81.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import {
  tramoRanges,
  monthlySpecs,
  prevMonthName,
  type RevenueRange,
} from './revenueTrend';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type RawRevenueRow = { price_charged: number | null; service: { price: number } | null };

export type MonthBar = { label: string; revenue: number; partial: boolean };

export type RevenueComparison = {
  thisMonthToDate: number;
  prevMonthSameTramo: number;
  prevMonthClamped: boolean;   // hoy > días del mes anterior → tramo = mes anterior completo
  prevMonthName: string;
};

export type NegocioRevenue = {
  currency: string;
  thisMonth: number;                     // revenue del mes en curso hasta ahora (sellado)
  comparison: RevenueComparison | null;  // null si el mes anterior no tiene ingresos (degradado)
  months: MonthBar[];                    // 6, del más viejo al más nuevo; el último es parcial
  hasAnyRevenue: boolean;                // false → "aún juntando historia"
};

/** Suma el revenue SELLADO de las completadas en [start, end] del negocio. */
async function sumSealedRevenue(
  supabase: ReturnType<typeof getServiceClient>,
  businessId: string,
  range: RevenueRange,
): Promise<number> {
  const { data } = await tenantDb(supabase, businessId)
    .table('appointments')
    .select('price_charged, service:service_id(price)')
    .eq('status', 'completed')
    .gte('starts_at', new Date(range.startMs).toISOString())
    .lte('starts_at', new Date(range.endMs).toISOString());

  let sum = 0;
  for (const r of (data ?? []) as unknown as RawRevenueRow[]) {
    sum += r.price_charged ?? r.service?.price ?? 0;
  }
  return sum;
}

export async function getNegocioRevenue(
  businessId: string,
  now: Date = new Date(),
): Promise<NegocioRevenue> {
  const supabase = getServiceClient();
  const nowMs = now.getTime();

  const tr = tramoRanges(nowMs);
  const specs = monthlySpecs(nowMs, 6);

  // Todas las ventanas en paralelo (queries chicas, scopeadas por negocio).
  const [thisMonth, prevTramo, monthRevenues] = await Promise.all([
    sumSealedRevenue(supabase, businessId, tr.thisMonth),
    sumSealedRevenue(supabase, businessId, tr.prevTramo),
    Promise.all(specs.map((s) => sumSealedRevenue(supabase, businessId, s))),
  ]);

  const months: MonthBar[] = specs.map((s, i) => ({
    label: s.label,
    revenue: monthRevenues[i] ?? 0,
    partial: s.partial,
  }));

  // Degradado: sin ingresos el mes anterior (negocio nuevo o mes vacío) → sin comparación,
  // para no mostrar un "vs $0" engañoso. (0 como proxy de "sin dato comparable".)
  const comparison: RevenueComparison | null = prevTramo > 0
    ? {
        thisMonthToDate: thisMonth,
        prevMonthSameTramo: prevTramo,
        prevMonthClamped: tr.prevClamped,
        prevMonthName: prevMonthName(nowMs),
      }
    : null;

  const hasAnyRevenue = thisMonth > 0 || months.some((m) => m.revenue > 0);

  return { currency: 'MXN', thisMonth, comparison, months, hasAnyRevenue };
}
