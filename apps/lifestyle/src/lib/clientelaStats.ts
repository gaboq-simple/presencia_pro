// ─── Clientela: query de agregados de la base ─────────────────────────────────
// Arma los inputs de cadencia desde la DB (TODOS los clientes del negocio, no solo
// los del feed) y llama al módulo puro (`cadence.ts` → computeClientelaStats).
// 🔴 SCOPE: el businessId viene de la sesión del owner (nunca del cliente) — igual
// que Ola 1 / PR0. Cada query filtra por él; nunca lee cross-tenant.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import {
  computeClientelaStats,
  type CustomerCadenceInput,
  type ClientelaStats,
} from './cadence';

// Server-only: mismo patrón que lib/retentionFeed (service_role, nunca al cliente).
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
 * Agregados de la clientela (crecimiento + grupos por segmento) del negocio.
 * A diferencia del feed (`getRetentionFeed`, que solo carga los de ≥3 visitas),
 * incluye a TODOS los clientes — los de <3 visitas caen a "Nuevos" (degradado con
 * gracia). `now` inyectable para tests/estabilidad.
 */
export async function getClientelaStats(
  businessId: string,
  now: Date = new Date(),
): Promise<ClientelaStats> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  // 1. Todos los clientes del negocio (scope Ola 1).
  const { data: custData } = await db
    .table('customers')
    .select('id, name, visit_count, is_flagged, noshow_count, created_at');

  const customers = (custData ?? []) as CustomerRow[];

  // 2. Serie de visitas completadas del negocio, ligadas a cliente (scope Ola 1).
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

  // 3. Inputs para TODOS los clientes (sin visitas → completedVisits vacío → Nuevos).
  const inputs: CustomerCadenceInput[] = customers.map((c) => {
    const g = byCustomer.get(c.id) ?? { visits: [], monetary: [] };
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

  return computeClientelaStats(inputs, now.getTime());
}
