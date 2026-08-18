// ─── atencionCount — el badge de la fila plegada (dv3-4') ────────────────────
// Server-only. Una fila de configuración cerrada esconde lo que hay adentro; si
// adentro hay algo que atender, el badge es lo único que lo delata. Sin él, la
// lista de espera pasa de ser un panel visible a ser una carpeta que nadie abre.
//
// Cuenta con `head: true` (solo el COUNT, sin traer filas): el badge es un
// número y no hay razón para hidratar dos listas enteras para dibujarlo.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * Clientes inactivos + gente esperando lugar. Los dos van en el MISMO badge
 * porque comparten fila y las dos cosas son lo mismo desde la silla del dueño:
 * personas que quieren venir y a las que nadie contestó.
 *
 * Inactivo = `last_visit` anterior a hoy − `inactive_threshold_days` (default
 * 21). Es la misma definición de `GET /api/customers/inactive`, que es el panel
 * que vive detrás de esta fila — si fueran dos reglas, el badge diría 4 y la
 * lista mostraría 6.
 */
export async function getAtencionCount(businessId: string): Promise<number> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  const { data: biz } = await supabase
    .from('businesses')
    .select('inactive_threshold_days')
    .eq('id', businessId)
    .maybeSingle();
  const dias = (biz as { inactive_threshold_days: number } | null)?.inactive_threshold_days ?? 21;

  const corte = new Date();
  corte.setDate(corte.getDate() - dias);

  const [inactivos, esperando] = await Promise.all([
    db.table('customers')
      .select('id', { count: 'exact', head: true })
      .not('last_visit', 'is', null)
      .lt('last_visit', corte.toISOString()),
    db.table('waitlist')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'waiting'),
  ]);

  return (inactivos.count ?? 0) + (esperando.count ?? 0);
}
