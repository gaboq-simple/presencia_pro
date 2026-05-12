// ─── Admin Page ────────────────────────────────────────────────────────────────
// Server Component. Fetcha en paralelo con service role:
//   - Todos los leads JOIN sellers
//   - Todos los commission_payouts pendientes JOIN leads JOIN sellers
//   - Todos los sellers activos (métricas + filtros de tabla)

// Guard: forzar renderizado dinámico — requiere sesión y datos reales.
export const dynamic = 'force-dynamic';

import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireRole } from '@/lib/auth';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminMetrics from '@/components/admin/AdminMetrics';
import AdminPageClient from './AdminPageClient';
import type { Seller, LeadWithSeller, CommissionPayout } from '@presenciapro/engine/types';
import type { AdminPayoutRow } from '@/components/admin/PayoutsPanel';

// ─── Service client factory ───────────────────────────────────────────────────

function serviceClient() {
  return createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchAllLeads(): Promise<LeadWithSeller[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from('leads')
    .select('*, seller:sellers(id, name, phone)')
    .order('created_at', { ascending: false });
  return (data ?? []) as LeadWithSeller[];
}

async function fetchPendingPayouts(): Promise<AdminPayoutRow[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from('commission_payouts')
    .select('*, lead:leads(doctor_name, client_id), seller:sellers(id, name, phone)')
    .is('paid_at', null)
    .order('created_at', { ascending: false });
  return (data ?? []) as AdminPayoutRow[];
}

async function fetchActiveSellers(): Promise<Seller[]> {
  const supabase = serviceClient();
  const { data } = await supabase
    .from('sellers')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });
  return (data ?? []) as Seller[];
}

// ─── Metric helpers ───────────────────────────────────────────────────────────

function currentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

interface GlobalMetrics {
  readonly totalPendingMxn: number;
  readonly activeClients: number;
  readonly activeSellers: number;
  readonly leadsThisMonth: number;
}

function computeMetrics(
  leads: LeadWithSeller[],
  payouts: CommissionPayout[],
  activeSellers: number,
): GlobalMetrics {
  const monthStart = currentMonthStart();

  const totalPendingMxn = payouts.reduce((sum, p) => sum + p.amount_mxn, 0);
  const activeClients = leads.filter((l) => l.status === 'deploy_completed').length;
  const leadsThisMonth = leads.filter((l) => l.created_at >= monthStart).length;

  return { totalPendingMxn, activeClients, activeSellers, leadsThisMonth };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminPage() {
  const { seller: operator } = await requireRole('operator');

  const [leads, pendingPayouts, sellers] = await Promise.all([
    fetchAllLeads(),
    fetchPendingPayouts(),
    fetchActiveSellers(),
  ]);

  const metrics = computeMetrics(leads, pendingPayouts, sellers.length);

  const uniqueSellers: Pick<Seller, 'id' | 'name'>[] = sellers.map((s) => ({
    id: s.id,
    name: s.name,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdminHeader operatorName={operator.name} />

      <main className="mx-auto w-full max-w-screen-xl flex-1 space-y-8 p-4 sm:p-6">
        <AdminMetrics {...metrics} />

        <AdminPageClient
          initialLeads={leads}
          initialPayouts={pendingPayouts}
          sellers={sellers}
          uniqueSellers={uniqueSellers}
        />
      </main>
    </div>
  );
}
