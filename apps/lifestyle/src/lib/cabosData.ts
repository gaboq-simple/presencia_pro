// ─── Cabos sueltos — capa de datos server ─────────────────────────────────────
// La query scopeada que alimenta a `lib/cabos.ts` (puro). Mismo reparto que
// fuga.ts/fugaData.ts y pulso.ts/pulsoData.ts: la matemática no toca la BD y la
// BD no hace matemática.
//
// 🔴 SCOPE: `tenantDb` inyecta el business_id de la sesión — un cabo suelto de
//    otro negocio no existe para esta consulta.

import { getServiceClient } from '@/lib/pulsoData';
import { tenantDb } from '@/lib/tenantDb';
import { computeCabos, VENTANA_CABOS_DIAS, type Cabos, type CitaSinResolver } from '@/lib/cabos';

type Row = {
  id:         string;
  starts_at:  string;
  status:     string;
  arrived_at: string | null;
  customer:   { name: string } | null;
};

/**
 * Cabos sueltos del negocio: citas ya pasadas que siguen `pending`/`confirmed`.
 *
 * La ventana se aplica en la QUERY (no en memoria) para no traer meses de
 * historia y descartarla después; el módulo puro la vuelve a aplicar sobre el
 * "ahora" exacto, que es lo que hace el resultado determinista y testeable.
 */
export async function getCabos(
  businessId: string,
  ahoraMs: number = Date.now(),
): Promise<Cabos> {
  const desde = new Date(ahoraMs - VENTANA_CABOS_DIAS * 24 * 60 * 60_000).toISOString();
  const hasta = new Date(ahoraMs).toISOString();

  const { data, error } = await tenantDb(getServiceClient(), businessId)
    .table('appointments')
    .select('id, starts_at, status, arrived_at, customer:customer_id(name)')
    .in('status', ['pending', 'confirmed'])
    .gte('starts_at', desde)
    .lt('starts_at', hasta)
    .order('starts_at', { ascending: true });

  if (error) throw new Error(`getCabos failed: ${error.message}`);

  const citas: CitaSinResolver[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id:         r.id,
    startsAtMs: Date.parse(r.starts_at),
    status:     r.status,
    llego:      r.arrived_at !== null,
    cliente:    r.customer?.name ?? null,
  }));

  return computeCabos(citas, ahoraMs);
}
