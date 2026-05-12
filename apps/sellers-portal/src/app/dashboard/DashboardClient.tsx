'use client';

// ─── DashboardClient ──────────────────────────────────────────────────────────
// Wrapper client que coordina LeadForm → refresh → PipelineBoard.
// Recibe datos iniciales del Server Component y refresca leads via API route.

import { useState, useCallback } from 'react';
import LeadForm from '@/components/LeadForm';
import PipelineBoard from '@/components/PipelineBoard';
import CommissionSummary from '@/components/CommissionSummary';
import type { Lead, PayoutWithLead } from '@presenciapro/engine/types';

interface DashboardClientProps {
  readonly sellerId: string;
  readonly initialLeads: Lead[];
  readonly payouts: PayoutWithLead[];
  readonly currentMonthTotal: number;
  readonly pendingTotal: number;
  readonly activeClientsCount: number;
}

export default function DashboardClient({
  sellerId,
  initialLeads,
  payouts,
  currentMonthTotal,
  pendingTotal,
  activeClientsCount,
}: DashboardClientProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [refreshing, setRefreshing] = useState(false);

  const refreshLeads = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/leads');
      if (res.ok) {
        const data = (await res.json()) as { leads: Lead[] };
        setLeads(data.leads);
      }
    } catch {
      // Error de red — mantener datos actuales
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Captura rápida */}
      <LeadForm sellerId={sellerId} onSuccess={refreshLeads} />

      {/* Pipeline */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-800">Pipeline</h2>
          {refreshing && (
            <span className="text-xs text-gray-400">Actualizando...</span>
          )}
        </div>
        <PipelineBoard leads={leads} onUpdate={refreshLeads} />
      </section>

      {/* Comisiones */}
      <CommissionSummary
        payouts={payouts}
        currentMonthTotal={currentMonthTotal}
        pendingTotal={pendingTotal}
        activeClientsCount={activeClientsCount}
      />
    </div>
  );
}
