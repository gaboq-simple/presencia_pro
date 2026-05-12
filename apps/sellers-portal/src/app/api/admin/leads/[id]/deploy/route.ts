// ─── API /api/admin/leads/[id]/deploy ─────────────────────────────────────────
// PATCH — marca un lead como deploy_completed y genera el payout de setup.
// Solo accesible por operadores (is_operator = true).

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { DeployLeadSchema } from '@presenciapro/engine/types';
import { getSession } from '@/lib/auth';
import type { Lead, CommissionPayout, Seller } from '@presenciapro/engine/types';
import { notifySellerDeployComplete } from '@/lib/notify-seller';

function serviceClient() {
  return createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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
  const parsed = DeployLeadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { setup_amount_mxn, client_id } = parsed.data;
  const { id: leadId } = await params;

  const supabase = serviceClient();

  // ── 4. Verificar que el lead existe ─────────────────────────────────────
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single<Lead>();

  if (leadError || !lead) {
    return Response.json({ error: 'Lead no encontrado' }, { status: 404 });
  }

  // ── 5. Rechazar si ya fue desplegado ─────────────────────────────────────
  // Guard: reject with 409 if deploy already completed
  if (lead.status === 'deploy_completed') {
    return Response.json(
      { error: 'Este lead ya fue desplegado' },
      { status: 409 },
    );
  }

  // ── 6a. Actualizar el lead ───────────────────────────────────────────────
  const { data: updatedLead, error: updateError } = await supabase
    .from('leads')
    .update({
      status: 'deploy_completed',
      setup_amount_mxn,
      client_id,
      deployed_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .select()
    .single<Lead>();

  if (updateError || !updatedLead) {
    return Response.json(
      { error: updateError?.message ?? 'Error al actualizar el lead' },
      { status: 500 },
    );
  }

  // ── 6b. Obtener datos del vendedor ───────────────────────────────────────
  const { data: seller, error: sellerError } = await supabase
    .from('sellers')
    .select('*')
    .eq('id', lead.seller_id)
    .single<Seller>();

  if (sellerError || !seller) {
    return Response.json({ error: 'Vendedor no encontrado' }, { status: 500 });
  }

  const commissionAmount = setup_amount_mxn * (seller.commission_setup_pct / 100);

  // ── 6c. Insertar payout de setup ─────────────────────────────────────────
  // commission_payouts es append-only: nunca UPDATE, solo INSERT
  const { data: payout, error: payoutError } = await supabase
    .from('commission_payouts')
    .insert({
      seller_id: lead.seller_id,
      lead_id: leadId,
      type: 'setup',
      amount_mxn: commissionAmount,
    })
    .select()
    .single<CommissionPayout>();

  if (payoutError || !payout) {
    return Response.json(
      { error: payoutError?.message ?? 'Error al crear el payout' },
      { status: 500 },
    );
  }

  try {
    await notifySellerDeployComplete({
      seller,
      doctorName: updatedLead.doctor_name,
      commissionMxn: payout.amount_mxn,
    });
  } catch { /* best-effort */ }

  return Response.json({ lead: updatedLead, payout });
}
