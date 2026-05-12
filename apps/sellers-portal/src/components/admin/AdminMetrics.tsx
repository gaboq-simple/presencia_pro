'use client';

// ─── AdminMetrics ─────────────────────────────────────────────────────────────
// 4 metric cards con totales globales del negocio.

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly valueClass?: string;
}

function MetricCard({ label, value, valueClass = 'text-gray-900' }: MetricCardProps) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

export interface AdminMetricsProps {
  readonly totalPendingMxn: number;
  readonly activeClients: number;
  readonly activeSellers: number;
  readonly leadsThisMonth: number;
}

export default function AdminMetrics({
  totalPendingMxn,
  activeClients,
  activeSellers,
  leadsThisMonth,
}: AdminMetricsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Comisiones por pagar"
        value={formatMXN(totalPendingMxn)}
        valueClass="text-amber-600"
      />
      <MetricCard label="Clientes activos" value={String(activeClients)} />
      <MetricCard label="Vendedores activos" value={String(activeSellers)} />
      <MetricCard label="Leads este mes" value={String(leadsThisMonth)} />
    </div>
  );
}
