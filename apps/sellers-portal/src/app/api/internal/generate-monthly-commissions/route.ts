// ─── API /api/internal/generate-monthly-commissions ─────────────────────────
// POST — genera commission_payouts mensuales para clientes activos dentro del
//         período de comisión pactado con el vendedor.
// Solo accesible por Edge Functions autenticadas con CRON_SECRET.

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Seller } from '@presenciapro/engine/types';
import { notifySellerMonthlyReport } from '@/lib/notify-seller';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveLeadRow {
  readonly id: string;
  readonly seller_id: string;
  readonly deployed_at: string;
  readonly sellers: Seller;
}

interface ExistingPayout {
  readonly id: string;
}

interface GeneratedPayout {
  readonly seller_id: string;
  readonly amount_mxn: number;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Verificar CRON_SECRET ─────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  // ── 2. Calcular período del mes anterior ─────────────────────────────────
  const now = new Date();
  const periodMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString()
    .split('T')[0]!; // 'YYYY-MM-01'

  // ── 3. Buscar leads activos con deploy completado ────────────────────────
  const { data: activeLeads, error: leadsError } = await supabase
    .from('leads')
    .select('id, seller_id, deployed_at, sellers!inner(*)')
    .eq('status', 'deploy_completed')
    .not('deployed_at', 'is', null)
    .returns<ActiveLeadRow[]>();

  if (leadsError) {
    return Response.json({ error: leadsError.message }, { status: 500 });
  }

  if (!activeLeads || activeLeads.length === 0) {
    return Response.json({ generated: 0, skipped: 0 });
  }

  let generated = 0;
  let skipped = 0;
  const newPayouts: GeneratedPayout[] = [];

  // ── 4. Procesar cada lead ─────────────────────────────────────────────────
  for (const lead of activeLeads) {
    const seller = lead.sellers as Seller;

    // ── 4a. Verificar que aún está dentro del período de comisión ─────────
    const mesesDesdeDeploy = Math.floor(
      (Date.now() - new Date(lead.deployed_at).getTime()) / (30.44 * 86_400_000),
    );

    if (mesesDesdeDeploy > seller.commission_monthly_months) {
      skipped++;
      continue;
    }

    // ── 4b. Verificar que no existe ya un payout para este período ────────
    const { data: existingPayout } = await supabase
      .from('commission_payouts')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('type', 'monthly')
      .eq('period_month', periodMonth)
      .maybeSingle<ExistingPayout>();

    if (existingPayout) {
      skipped++;
      continue;
    }

    // ── 4c. Insertar payout mensual ───────────────────────────────────────
    const { error: insertError } = await supabase
      .from('commission_payouts')
      .insert({
        seller_id: lead.seller_id,
        lead_id: lead.id,
        type: 'monthly',
        amount_mxn: seller.commission_monthly_mxn,
        period_month: periodMonth,
      });

    if (insertError) {
      skipped++;
      continue;
    }

    generated++;
    newPayouts.push({ seller_id: lead.seller_id, amount_mxn: seller.commission_monthly_mxn });
  }

  // ── 5. Notificar a cada vendedor con payouts generados ───────────────────
  const sellerMap = new Map<string, Seller>();
  for (const lead of activeLeads) {
    sellerMap.set(lead.seller_id, lead.sellers as Seller);
  }

  // Agrupar payouts nuevos por seller
  const payoutsBySeller = new Map<string, number[]>();
  for (const payout of newPayouts) {
    const amounts = payoutsBySeller.get(payout.seller_id) ?? [];
    amounts.push(payout.amount_mxn);
    payoutsBySeller.set(payout.seller_id, amounts);
  }

  const monthLabel = new Date(periodMonth).toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  });

  for (const [sellerId, amounts] of payoutsBySeller) {
    const seller = sellerMap.get(sellerId);
    if (!seller) continue;

    const totalGeneratedMxn = amounts.reduce((sum, a) => sum + a, 0);
    const activeClientsCount = activeLeads.filter((l) => l.seller_id === sellerId).length;

    try {
      await notifySellerMonthlyReport({
        seller,
        monthLabel,
        totalGeneratedMxn,
        activeClientsCount,
      });
    } catch { /* best-effort */ }
  }

  return Response.json({ generated, skipped });
}
