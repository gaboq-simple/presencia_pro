// ─── BlockRequestsInbox ───────────────────────────────────────────────────────
// Client Component — bandeja de aprobaciones de solicitudes de bloqueo.
//
// Datos iniciales: prop initialRequests (fetch en Server Component page.tsx).
// Aprobar/Rechazar: PATCH /api/staff/block-request/[id]
// Al resolver: elimina la solicitud de la lista local sin reload completo.
// Orden: urgentes primero (badge rojo), normales después (badge gris).

'use client';

import { useState } from 'react';
import type { BlockRequestWithStaff } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialRequests: BlockRequestWithStaff[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end   = new Date(endsAt);

  const date = start.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const startTime = start.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endTime = end.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `${date} · ${startTime}–${endTime}`;
}

// ─── RequestCard ──────────────────────────────────────────────────────────────

type CardProps = {
  request: BlockRequestWithStaff;
  onResolve: (id: string, status: 'approved' | 'rejected') => Promise<void>;
};

function RequestCard({ request, onResolve }: CardProps) {
  const [resolving, setResolving] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(status: 'approved' | 'rejected') {
    setError(null);
    setResolving(status);
    try {
      await onResolve(request.id, status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al actualizar');
      setResolving(null);
    }
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${
      request.urgent
        ? 'border-red-200 bg-red-50'
        : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Nombre + badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {request.staff_name}
            </span>
            {request.urgent ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                URGENTE
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                Pendiente
              </span>
            )}
          </div>

          {/* Fecha y hora */}
          <p className="mt-0.5 text-xs tabular-nums text-gray-600">
            {formatTimeRange(request.starts_at, request.ends_at)}
          </p>

          {/* Motivo */}
          {request.reason && (
            <p className="mt-1 text-xs text-gray-500 line-clamp-2">
              {request.reason}
            </p>
          )}

          {/* Error inline */}
          {error && (
            <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={() => handleAction('approved')}
            disabled={resolving !== null}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolving === 'approved' ? '…' : 'Aprobar'}
          </button>
          <button
            onClick={() => handleAction('rejected')}
            disabled={resolving !== null}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolving === 'rejected' ? '…' : 'Rechazar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlockRequestsInbox({ initialRequests }: Props) {
  const [requests, setRequests] = useState<BlockRequestWithStaff[]>(initialRequests);

  async function handleResolve(id: string, status: 'approved' | 'rejected') {
    const res = await fetch(`/api/staff/block-request/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? 'Error al actualizar');
    }

    // Quitar de la lista local — revalida sin reload
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <p className="text-xs font-semibold text-gray-700">
          Solicitudes de bloqueo pendientes
          {requests.length > 0 && (
            <span className="ml-1.5 rounded-full bg-gray-900 px-1.5 py-0.5 text-xs font-medium text-white">
              {requests.length}
            </span>
          )}
        </p>
      </div>

      <div className="p-3">
        {requests.length === 0 ? (
          <p className="py-2 text-center text-sm text-gray-400">
            Sin solicitudes pendientes ✓
          </p>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => (
              <RequestCard
                key={req.id}
                request={req}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
