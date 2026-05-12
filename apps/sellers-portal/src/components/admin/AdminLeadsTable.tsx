'use client';

// ─── AdminLeadsTable ──────────────────────────────────────────────────────────
// Tabla de todos los leads con filtros client-side por vendedor y status.
// Acciona DeployModal en filas sin deploy completado.

import { useState } from 'react';
import type { LeadWithSeller, Seller, LeadStatus } from '@presenciapro/engine/types';
import DeployModal from './DeployModal';

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<LeadStatus, string> = {
  lead: 'Lead',
  proposal_sent: 'Propuesta',
  negotiating: 'Negociando',
  deploy_completed: 'Desplegado',
  lost: 'Perdido',
};

const STATUS_CLASSES: Record<LeadStatus, string> = {
  lead: 'bg-gray-100 text-gray-600',
  proposal_sent: 'bg-blue-50 text-blue-700',
  negotiating: 'bg-yellow-50 text-yellow-700',
  deploy_completed: 'bg-green-50 text-green-700',
  lost: 'bg-red-50 text-red-600',
};

function StatusBadge({ status }: { readonly status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function daysActive(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  return Math.floor((Date.now() - created) / 86_400_000);
}

// ─── AdminLeadsTable ──────────────────────────────────────────────────────────

interface AdminLeadsTableProps {
  readonly leads: LeadWithSeller[];
  /** Full seller records — needed by DeployModal for commission_setup_pct */
  readonly sellers: Seller[];
  /** Subset for the filter dropdown (id + name only) */
  readonly uniqueSellers: Pick<Seller, 'id' | 'name'>[];
  readonly onDeployComplete: () => void;
}

export default function AdminLeadsTable({
  leads,
  sellers,
  uniqueSellers,
  onDeployComplete,
}: AdminLeadsTableProps) {
  const [sellerFilter, setSellerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deployLead, setDeployLead] = useState<LeadWithSeller | null>(null);

  // ── Unique seller options come from props (pre-computed server-side) ──
  const filtered = leads.filter((l) => {
    const matchesSeller = sellerFilter === 'all' || l.seller.id === sellerFilter;
    const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchesSeller && matchesStatus;
  });

  // Find the full Seller object for DeployModal (needs commission_setup_pct)
  function findSellerForLead(lead: LeadWithSeller): Seller | undefined {
    return sellers.find((s) => s.id === lead.seller.id);
  }

  function handleDeploySuccess() {
    setDeployLead(null);
    onDeployComplete();
  }

  const ALL_STATUSES: LeadStatus[] = [
    'lead',
    'proposal_sent',
    'negotiating',
    'deploy_completed',
    'lost',
  ];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Todos los leads
        </h2>
        <span className="text-xs text-gray-400">{filtered.length} resultado(s)</span>
      </div>

      {/* ── Filters ── */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">Todos los vendedores</option>
          {uniqueSellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">Todos los estados</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        {filtered.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">
            No hay leads que coincidan con los filtros.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Prospecto</th>
                <th className="px-4 py-3">Ciudad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Días activo</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">{lead.seller.name}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{lead.doctor_name}</p>
                    {lead.specialty !== null && (
                      <p className="text-xs text-gray-400">{lead.specialty}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.city}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {daysActive(lead.created_at)}d
                  </td>
                  <td className="px-4 py-3 text-right">
                    {lead.status === 'deploy_completed' ? (
                      <span className="text-xs text-gray-400">{lead.client_id ?? '—'}</span>
                    ) : lead.status !== 'lost' ? (
                      <button
                        type="button"
                        onClick={() => setDeployLead(lead)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Marcar deploy
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── DeployModal ── */}
      {deployLead !== null && (() => {
        const fullSeller = findSellerForLead(deployLead);
        if (fullSeller === undefined) return null;
        return (
          <DeployModal
            lead={deployLead}
            seller={fullSeller}
            onSuccess={handleDeploySuccess}
            onClose={() => setDeployLead(null)}
          />
        );
      })()}
    </section>
  );
}
