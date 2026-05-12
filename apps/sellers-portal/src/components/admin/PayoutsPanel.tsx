'use client';

// ─── PayoutsPanel ─────────────────────────────────────────────────────────────
// Panel de comisiones pendientes agrupadas por vendedor.
// Botón "Marcar todo pagado" por vendedor con confirmación inline.

import { useState, useEffect } from 'react';
import type { PayoutWithLead } from '@presenciapro/engine/types';

// ─── Extended type for admin payouts (includes seller info) ───────────────────

export interface AdminPayoutRow extends PayoutWithLead {
  readonly seller: {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
  };
}

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Group payouts by seller ──────────────────────────────────────────────────

interface SellerGroup {
  readonly sellerId: string;
  readonly sellerName: string;
  readonly payouts: AdminPayoutRow[];
  readonly total: number;
}

function groupBySeller(payouts: AdminPayoutRow[]): SellerGroup[] {
  const map = new Map<string, SellerGroup>();

  for (const payout of payouts) {
    const existing = map.get(payout.seller.id);
    if (existing) {
      map.set(payout.seller.id, {
        ...existing,
        payouts: [...existing.payouts, payout],
        total: existing.total + payout.amount_mxn,
      });
    } else {
      map.set(payout.seller.id, {
        sellerId: payout.seller.id,
        sellerName: payout.seller.name,
        payouts: [payout],
        total: payout.amount_mxn,
      });
    }
  }

  return Array.from(map.values());
}

// ─── SellerPayoutCard ─────────────────────────────────────────────────────────

interface SellerPayoutCardProps {
  readonly group: SellerGroup;
  readonly onPaid: (sellerId: string) => void;
}

function SellerPayoutCard({ group, onPaid }: SellerPayoutCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payouts/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: group.sellerId }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Error al registrar el pago');
        return;
      }

      onPaid(group.sellerId);
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{group.sellerName}</p>
          <p className="text-xs text-gray-400">{group.payouts.length} comisión(es) pendiente(s)</p>
        </div>
        <p className="text-base font-semibold text-amber-600 tabular-nums">
          {formatMXN(group.total)}
        </p>
      </div>

      {/* Payout rows */}
      <ul className="divide-y divide-gray-50 px-5">
        {group.payouts.map((payout) => (
          <li key={payout.id} className="flex items-center justify-between py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  payout.type === 'setup'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-green-50 text-green-700'
                }`}
              >
                {payout.type === 'setup' ? 'Setup' : 'Mensual'}
              </span>
              <span className="text-gray-600">{payout.lead.doctor_name}</span>
            </div>
            <span className="font-medium text-gray-900 tabular-nums">
              {formatMXN(payout.amount_mxn)}
            </span>
          </li>
        ))}
      </ul>

      {/* Actions */}
      <div className="px-5 pb-4 pt-3">
        {error !== null && (
          <p className="mb-2 text-xs text-red-600">{error}</p>
        )}

        {confirming ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-700">
              ¿Confirmar pago de{' '}
              <span className="font-semibold">{formatMXN(group.total)}</span> a{' '}
              {group.sellerName}?
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Procesando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Marcar todo pagado
          </button>
        )}
      </div>
    </div>
  );
}

// ─── PayoutsPanel ─────────────────────────────────────────────────────────────

interface PayoutsPanelProps {
  readonly payouts: AdminPayoutRow[];
}

export default function PayoutsPanel({ payouts }: PayoutsPanelProps) {
  const [visible, setVisible] = useState<AdminPayoutRow[]>(payouts);

  // Sincronizar estado interno cuando el Server Component entrega datos frescos
  // (por ejemplo, después de router.refresh() post-deploy).
  useEffect(() => {
    setVisible(payouts);
  }, [payouts]);

  function handlePaid(sellerId: string) {
    setVisible((prev) => prev.filter((p) => p.seller.id !== sellerId));
  }

  const groups = groupBySeller(visible);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Comisiones pendientes de pago
      </h2>

      {groups.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-8 text-center shadow-sm ring-1 ring-gray-200">
          <p className="text-sm text-gray-400">No hay comisiones pendientes. 🎉</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <SellerPayoutCard key={group.sellerId} group={group} onPaid={handlePaid} />
          ))}
        </div>
      )}
    </section>
  );
}
