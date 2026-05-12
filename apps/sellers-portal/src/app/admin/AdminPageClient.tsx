'use client';

// ─── AdminPageClient ──────────────────────────────────────────────────────────
// Wrapper client que coordina deploy completion → router.refresh().
// Recibe datos iniciales del Server Component; tras un deploy exitoso llama
// router.refresh() para que el Server Component re-ejecute con datos frescos.

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PayoutsPanel from '@/components/admin/PayoutsPanel';
import AdminLeadsTable from '@/components/admin/AdminLeadsTable';
import type { LeadWithSeller, Seller } from '@presenciapro/engine/types';
import type { AdminPayoutRow } from '@/components/admin/PayoutsPanel';

interface AdminPageClientProps {
  readonly initialLeads: LeadWithSeller[];
  readonly initialPayouts: AdminPayoutRow[];
  readonly sellers: Seller[];
  readonly uniqueSellers: Pick<Seller, 'id' | 'name'>[];
}

export default function AdminPageClient({
  initialLeads,
  initialPayouts,
  sellers,
  uniqueSellers,
}: AdminPageClientProps) {
  const router = useRouter();

  const handleDeployComplete = useCallback(() => {
    // Refresca el Server Component para obtener leads y payouts actualizados.
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-8">
      <PayoutsPanel payouts={initialPayouts} />
      <AdminLeadsTable
        leads={initialLeads}
        sellers={sellers}
        uniqueSellers={uniqueSellers}
        onDeployComplete={handleDeployComplete}
      />
    </div>
  );
}
