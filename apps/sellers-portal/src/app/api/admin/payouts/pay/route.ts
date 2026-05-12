// ─── API /api/admin/payouts/pay ───────────────────────────────────────────────
// POST — marca todos los payouts pendientes de un vendedor como pagados.
// Solo accesible por operadores (is_operator = true).
// commission_payouts es append-only: se actualiza paid_at y paid_by (no INSERT).

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import type { Seller } from '@presenciapro/engine/types';
import { notifySellerPaymentSent } from '@/lib/notify-seller';

const PaySellerSchema = z.object({
  sellerId: z.string().uuid(),
});

function serviceClient() {
  return createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Verificar sesión ──────────────────────────────────────────────────
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  // ── 2. Verificar rol de operador ─────────────────────────────────────────
  // Guard: reject if caller is not an operator
  if (!session.seller.is_operator) {
    return Response.json({ error: 'Acceso denegado' }, { status: 403 });
  }

  // ── 3. Validar body ──────────────────────────────────────────────────────
  const body: unknown = await request.json();
  const parsed = PaySellerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { sellerId } = parsed.data;
  const now = new Date().toISOString();

  const supabase = serviceClient();

  // ── 4. Obtener vendedor para la notificación ─────────────────────────────
  const { data: targetSeller } = await supabase
    .from('sellers')
    .select('*')
    .eq('id', sellerId)
    .single<Seller>();

  // ── 5. Actualizar todos los payouts pendientes del vendedor ──────────────
  const { data, error } = await supabase
    .from('commission_payouts')
    .update({ paid_at: now, paid_by: session.userId })
    .eq('seller_id', sellerId)
    .is('paid_at', null)
    .select('id, amount_mxn');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const updated = (data ?? []).length;
  const totalMxn = (data ?? []).reduce(
    (sum, p) => sum + (p as { amount_mxn: number }).amount_mxn,
    0,
  );

  if (targetSeller && updated > 0) {
    try {
      await notifySellerPaymentSent({ seller: targetSeller, totalMxn });
    } catch { /* best-effort */ }
  }

  return Response.json({ updated });
}
