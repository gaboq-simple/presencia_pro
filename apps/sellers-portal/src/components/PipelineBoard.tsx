'use client';

// ─── PipelineBoard ────────────────────────────────────────────────────────────
// Tablero de leads en columnas por status. Actualización optimista al cambiar status.

import { useState } from 'react';
import type { Lead, LeadStatus } from '@presenciapro/engine/types';

// ─── Column config ────────────────────────────────────────────────────────────

interface Column {
  readonly status: LeadStatus;
  readonly label: string;
}

const COLUMNS: readonly Column[] = [
  { status: 'lead',             label: 'Lead' },
  { status: 'proposal_sent',   label: 'Propuesta enviada' },
  { status: 'negotiating',     label: 'Negociando' },
  { status: 'deploy_completed',label: 'Deploy completado' },
  { status: 'lost',            label: 'Perdido' },
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  lead:             'Lead',
  proposal_sent:    'Propuesta enviada',
  negotiating:      'Negociando',
  deploy_completed: 'Deploy completado',
  lost:             'Perdido',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PipelineBoardProps {
  readonly leads: Lead[];
  readonly onUpdate: () => void;
}

export default function PipelineBoard({ leads, onUpdate }: PipelineBoardProps) {
  const [optimisticLeads, setOptimisticLeads] = useState<Lead[]>(leads);

  // Sync when parent refreshes data
  if (leads !== optimisticLeads && !hasPendingChanges(leads, optimisticLeads)) {
    setOptimisticLeads(leads);
  }

  async function handleStatusChange(leadId: string, newStatus: LeadStatus) {
    // Actualización optimista
    setOptimisticLeads((prev) =>
      prev.map((l) =>
        l.id === leadId ? { ...l, status: newStatus } : l,
      ),
    );

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        // Revertir si el servidor falla
        setOptimisticLeads(leads);
      } else {
        onUpdate();
      }
    } catch {
      // Revertir en error de red
      setOptimisticLeads(leads);
    }
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4" style={{ minWidth: `${COLUMNS.length * 260}px` }}>
        {COLUMNS.map((col) => (
          <PipelineColumn
            key={col.status}
            column={col}
            leads={optimisticLeads.filter((l) => l.status === col.status)}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

interface PipelineColumnProps {
  readonly column: Column;
  readonly leads: Lead[];
  readonly onStatusChange: (id: string, status: LeadStatus) => void;
}

function PipelineColumn({ column, leads, onStatusChange }: PipelineColumnProps) {
  return (
    <div className="flex w-60 flex-shrink-0 flex-col rounded-xl bg-gray-50 ring-1 ring-gray-200">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{column.label}</h3>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {leads.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {leads.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">Sin prospectos</p>
        )}
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onStatusChange={onStatusChange} />
        ))}
      </div>
    </div>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

interface LeadCardProps {
  readonly lead: Lead;
  readonly onStatusChange: (id: string, status: LeadStatus) => void;
}

function LeadCard({ lead, onStatusChange }: LeadCardProps) {
  const daysSinceCreated = getDaysSince(lead.created_at);
  const isCold = daysSinceCreated > 15;
  const isExpiring = daysSinceCreated > 28;

  return (
    <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-200">
      <p className="text-sm font-semibold text-gray-900">{lead.doctor_name}</p>

      <p className="mt-0.5 text-xs text-gray-500">
        {[lead.specialty, lead.city].filter(Boolean).join(' · ')}
      </p>

      <p className={`mt-1 text-xs ${isCold ? 'text-amber-600' : 'text-gray-400'}`}>
        {formatDays(daysSinceCreated)}
      </p>

      {isExpiring && (
        <span className="mt-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          Exclusividad vence pronto
        </span>
      )}
      {!isExpiring && isCold && (
        <span className="mt-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          Frío
        </span>
      )}

      <select
        value={lead.status}
        onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
        className="mt-3 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        {(Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getDaysSince(isoDate: string): number {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatDays(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  return `hace ${days} días`;
}

function hasPendingChanges(incoming: Lead[], current: Lead[]): boolean {
  if (incoming.length !== current.length) return false;
  return current.some((c) => {
    const match = incoming.find((i) => i.id === c.id);
    return match && match.status !== c.status;
  });
}
