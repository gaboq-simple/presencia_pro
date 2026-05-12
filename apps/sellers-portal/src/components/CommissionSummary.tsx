'use client';

// ─── CommissionSummary ────────────────────────────────────────────────────────
// Resumen de comisiones: 3 metric cards + tabla de historial (máx 20 filas).

import type { PayoutWithLead } from '@presenciapro/engine/types';

interface CommissionSummaryProps {
  readonly payouts: PayoutWithLead[];
  readonly currentMonthTotal: number;
  readonly pendingTotal: number;
  readonly activeClientsCount: number;
}

const COMMISSION_TYPE_LABELS = {
  setup:   'Setup',
  monthly: 'Mensual',
} as const;

export default function CommissionSummary({
  payouts,
  currentMonthTotal,
  pendingTotal,
  activeClientsCount,
}: CommissionSummaryProps) {
  const displayPayouts = payouts.slice(0, 20);

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-800">Comisiones</h2>
      </div>

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
        <MetricCard
          label="Comisión este mes"
          value={formatMXN(currentMonthTotal)}
        />
        <MetricCard
          label="Pendiente de cobro"
          value={formatMXN(pendingTotal)}
          valueClass="text-amber-600"
        />
        <MetricCard
          label="Clientes activos"
          value={String(activeClientsCount)}
        />
      </div>

      {/* ── Historial ── */}
      {displayPayouts.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-gray-400">
          Aún no hay comisiones registradas.
        </p>
      ) : (
        <div className="overflow-x-auto px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase text-gray-500">
                <th className="pb-2 pr-4">Cliente</th>
                <th className="pb-2 pr-4">Tipo</th>
                <th className="pb-2 pr-4 text-right">Monto</th>
                <th className="pb-2 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayPayouts.map((payout) => (
                <tr key={payout.id} className="hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-800">
                    {payout.lead.doctor_name}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {COMMISSION_TYPE_LABELS[payout.type]}
                  </td>
                  <td className="py-2 pr-4 text-right font-medium text-gray-800">
                    {formatMXN(payout.amount_mxn)}
                  </td>
                  <td className="py-2 text-right">
                    {payout.paid_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Pagado · {formatDate(payout.paid_at)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly valueClass?: string;
}

function MetricCard({ label, value, valueClass = 'text-gray-900' }: MetricCardProps) {
  return (
    <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
