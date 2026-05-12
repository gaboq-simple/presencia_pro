// ─── API /api/admin/sellers ────────────────────────────────────────────────────
// GET — lista todos los vendedores activos.
// Solo accesible por operadores (is_operator = true).

import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/auth';
import type { Seller } from '@presenciapro/engine/types';

function serviceClient() {
  return createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

export async function GET(): Promise<Response> {
  // ── 1. Verificar sesión ──────────────────────────────────────────────────
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  // ── 2. Verificar rol de operador ─────────────────────────────────────────
  // Guard: reject if caller is not an operator
  if (!session.seller.is_operator) {
    return Response.json({ error: 'Acceso denegado' }, { status: 403 });
  }

  const supabase = serviceClient();

  const { data: sellers, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ sellers: (sellers ?? []) as Seller[] });
}
