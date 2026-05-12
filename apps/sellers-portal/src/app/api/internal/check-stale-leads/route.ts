// ─── API /api/internal/check-stale-leads ────────────────────────────────────
// POST — detecta leads sin avanzar ≥15 días y notifica al vendedor por WhatsApp.
// Solo accesible por Edge Functions autenticadas con CRON_SECRET.

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Seller } from '@presenciapro/engine/types';
import { notifySellerStaleLead } from '@/lib/notify-seller';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaleLeadRow {
  readonly id: string;
  readonly doctor_name: string;
  readonly updated_at: string;
  readonly sellers: Pick<Seller, 'id' | 'name' | 'phone' | 'email'>;
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

  // ── 2. Buscar leads estancados ≥15 días ──────────────────────────────────
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86_400_000).toISOString();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, doctor_name, updated_at, sellers!inner(id, name, phone, email)')
    .in('status', ['lead', 'proposal_sent', 'negotiating'])
    .lt('updated_at', fifteenDaysAgo)
    .returns<StaleLeadRow[]>();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return Response.json({ processed: 0, notified: 0 });
  }

  // ── 3. Notificar vendedor por cada lead estancado ────────────────────────
  let notified = 0;

  for (const lead of leads) {
    const daysStale = Math.floor(
      (Date.now() - new Date(lead.updated_at).getTime()) / 86_400_000,
    );
    const isUrgent = daysStale >= 28;

    const seller = lead.sellers as Pick<Seller, 'id' | 'name' | 'phone' | 'email'> & Seller;

    try {
      await notifySellerStaleLead({
        seller,
        doctorName: lead.doctor_name,
        daysStale,
        isUrgent,
      });
      notified++;
    } catch { /* best-effort */ }
  }

  return Response.json({ processed: leads.length, notified });
}
