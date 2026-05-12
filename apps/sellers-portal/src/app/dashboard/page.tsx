// ─── Dashboard Page ───────────────────────────────────────────────────────────
// Server Component. Fetcha en paralelo: seller, leads y payouts.
// Compone: DashboardHeader + LeadForm + PipelineBoard + CommissionSummary.

// Guard: forzar renderizado dinámico — la página requiere sesión y datos reales.
export const dynamic = 'force-dynamic';

import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireRole } from '@/lib/auth';
import DashboardHeader from '@/components/DashboardHeader';
import LeadForm from '@/components/LeadForm';
import PipelineBoard from '@/components/PipelineBoard';
import CommissionSummary from '@/components/CommissionSummary';
import DashboardClient from './DashboardClient';
import type { Lead, CommissionPayout, PayoutWithLead } from '@presenciapro/engine/types';

// ─── Data helpers ─────────────────────────────────────────────────────────────

function serviceClient() {
  return createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

async function fetchLeads(sellerId: string): Promise<Lead[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Lead[];
}

async function fetchPayouts(sellerId: string): Promise<PayoutWithLead[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from('commission_payouts')
    .select('*, lead:leads(doctor_name, client_id)')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });
  return (data ?? []) as PayoutWithLead[];
}

// ─── Commission aggregations ──────────────────────────────────────────────────

function currentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function aggregateCommissions(payouts: PayoutWithLead[]): {
  currentMonthTotal: number;
  pendingTotal: number;
} {
  const monthStart = currentMonthStart();
  let currentMonthTotal = 0;
  let pendingTotal = 0;

  for (const p of payouts) {
    if (p.created_at >= monthStart) currentMonthTotal += p.amount_mxn;
    if (p.paid_at === null) pendingTotal += p.amount_mxn;
  }

  return { currentMonthTotal, pendingTotal };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const { seller } = await requireRole('seller');

  const [leads, payouts] = await Promise.all([
    fetchLeads(seller.id),
    fetchPayouts(seller.id),
  ]);

  const { currentMonthTotal, pendingTotal } = aggregateCommissions(payouts);
  const activeClientsCount = leads.filter((l) => l.status === 'deploy_completed').length;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <DashboardHeader sellerName={seller.name} />

      <main className="mx-auto w-full max-w-screen-xl flex-1 space-y-6 p-4 sm:p-6">
        {/* LeadForm + PipelineBoard — requieren interactividad: Client Component wrapper */}
        <DashboardClient
          sellerId={seller.id}
          initialLeads={leads}
          payouts={payouts}
          currentMonthTotal={currentMonthTotal}
          pendingTotal={pendingTotal}
          activeClientsCount={activeClientsCount}
        />
      </main>
    </div>
  );
}
