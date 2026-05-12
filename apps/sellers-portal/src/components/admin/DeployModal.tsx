'use client';

// ─── DeployModal ──────────────────────────────────────────────────────────────
// Modal para marcar un lead como deploy_completed.
// Valida con DeployLeadSchema, muestra preview de comisión, llama al API route.
// Implementado como overlay con flex para evitar problemas con position: fixed.

import { useState } from 'react';
import { DeployLeadSchema } from '@presenciapro/engine/types';
import type { LeadWithSeller, Seller } from '@presenciapro/engine/types';

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface DeployModalProps {
  readonly lead: LeadWithSeller;
  readonly seller: Seller;
  readonly onSuccess: () => void;
  readonly onClose: () => void;
}

export default function DeployModal({ lead, seller, onSuccess, onClose }: DeployModalProps) {
  const [setupAmount, setSetupAmount] = useState('');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const parsedAmount = parseFloat(setupAmount);
  const validAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const commissionPreview = validAmount
    ? parsedAmount * (seller.commission_setup_pct / 100)
    : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Guard: validar con Zod antes del fetch
    const parsed = DeployLeadSchema.safeParse({
      setup_amount_mxn: parsedAmount,
      client_id: clientId.trim(),
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(firstIssue?.message ?? 'Datos inválidos');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/deploy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Error al marcar el deploy');
        return;
      }

      onSuccess();
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setLoading(false);
    }
  }

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal */}
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Marcar deploy completado</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {lead.doctor_name} · {lead.seller.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* setup_amount_mxn */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Monto cobrado al cliente (MXN)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="6000"
              value={setupAmount}
              onChange={(e) => setSetupAmount(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* client_id */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              ID del cliente en el monorepo
            </label>
            <input
              type="text"
              placeholder="dra-quevedo"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              El slug del cliente tal como aparece en clients/
            </p>
          </div>

          {/* Commission preview */}
          {commissionPreview !== null && (
            <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Comisión de setup:{' '}
              <span className="font-semibold">{formatMXN(commissionPreview)}</span>{' '}
              MXN ({seller.commission_setup_pct}%)
              <br />
              <span className="text-xs text-blue-600">
                El cálculo definitivo ocurre en el servidor.
              </span>
            </div>
          )}

          {/* Error */}
          {error !== null && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Guardando…' : 'Confirmar deploy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
