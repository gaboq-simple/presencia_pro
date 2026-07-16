// ─── Retención: query del feed "Para recuperar" ──────────────────────────────
// Arma los inputs de cadencia desde la DB y llama al módulo puro (cadence.ts).
// 🔴 SCOPE: el businessId viene de la sesión del owner (nunca del cliente) — igual
// que Ola 1 / PR0. Cada query filtra por él; nunca lee cross-tenant.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import {
  computeRetentionFeed,
  MIN_VISITS_FOR_CADENCE,
  type CustomerCadenceInput,
  type RetentionFeed,
} from './cadence';

// Server-only: mismo patrón que lib/dashboard.types (service_role, nunca al cliente).
function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type ApptRow = { customer_id: string; starts_at: string; price_charged: number | null };
type CustomerRow = {
  id: string;
  name: string;
  visit_count: number | null;
  is_flagged: boolean | null;
  noshow_count: number | null;
  created_at: string;
};

/**
 * Feed de retención del negocio. Solo clientes con ≥ MIN_VISITS_FOR_CADENCE citas
 * completadas ligadas (cap de cómputo). `now` inyectable para tests/estabilidad.
 */
export async function getRetentionFeed(
  businessId: string,
  now: Date = new Date(),
  opts?: { topN?: number },
): Promise<RetentionFeed> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  // 1. Serie de citas completadas del negocio, ligadas a cliente.
  const { data: apptData } = await db
    .table('appointments')
    .select('customer_id, starts_at, price_charged')
    .eq('status', 'completed')
    .not('customer_id', 'is', null)
    .order('starts_at', { ascending: true });

  const byCustomer = new Map<string, { visits: string[]; monetary: Array<number | null> }>();
  for (const r of (apptData ?? []) as ApptRow[]) {
    const g = byCustomer.get(r.customer_id) ?? { visits: [], monetary: [] };
    g.visits.push(r.starts_at);
    g.monetary.push(r.price_charged);
    byCustomer.set(r.customer_id, g);
  }

  // 2. Cap de cómputo: solo clientes con historial suficiente para cadencia.
  const eligibleIds = [...byCustomer.entries()]
    .filter(([, g]) => g.visits.length >= MIN_VISITS_FOR_CADENCE)
    .map(([id]) => id);

  if (eligibleIds.length === 0) return { rows: [], porRecuperar: 0 };

  // 3. Campos denormalizados de esos clientes (scope por business_id).
  const { data: custData } = await db
    .table('customers')
    .select('id, name, visit_count, is_flagged, noshow_count, created_at')
    .in('id', eligibleIds);

  const inputs: CustomerCadenceInput[] = ((custData ?? []) as CustomerRow[]).map((c) => {
    const g = byCustomer.get(c.id)!;
    return {
      customerId:      c.id,
      name:            c.name,
      completedVisits: g.visits,
      monetaryValues:  g.monetary,
      visitCount:      c.visit_count ?? g.visits.length,
      createdAt:       c.created_at,
      isFlagged:       c.is_flagged ?? false,
      noshowCount:     c.noshow_count ?? 0,
    };
  });

  return computeRetentionFeed(inputs, now.getTime(), opts);
}

/**
 * Pulso "contactados": reactivaciones enviadas por el negocio. Contable a nivel
 * negocio aunque `customer_id` no esté poblado en scheduled_notifications (la
 * conversión "volvieron" NO es computable hoy — se omite en el pulso).
 */
export async function getContactadosCount(
  businessId: string,
): Promise<number> {
  const supabase = getServiceClient();
  const { count } = await tenantDb(supabase, businessId)
    .table('scheduled_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'reactivation');
  return count ?? 0;
}
