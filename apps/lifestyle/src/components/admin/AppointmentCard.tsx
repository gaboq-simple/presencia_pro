// ─── AppointmentCard ──────────────────────────────────────────────────────────
// Client Component — tarjeta individual de cita en el dashboard admin.
//
// Muestra: hora inicio/fin, servicio, cliente, barbero asignado, estado.
// Estado visual diferenciado por color.
// Acciones rápidas: completar / no_show (máximo 2 botones).

'use client';

import { useTransition } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import { updateAppointmentStatus } from '@/app/dashboard/actions';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Props = {
  appointment: DashboardAppointment;
};

// ─── Config visual por status ─────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show:   'No asistió',
  walkin:    'Walk-in',
};

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-tint text-amber',
  confirmed: 'bg-past-bg text-ink-2',
  completed: 'bg-tint-1 text-teal-ink',
  cancelled: 'bg-past-bg text-faint',
  no_show:   'bg-red-tint text-red-ink',
  walkin:    'bg-walk-tint text-walk',
};

const STATUS_BORDER: Record<string, string> = {
  pending:   'border-amber-border',
  confirmed: 'border-line-2',
  completed: 'border-teal-border',
  cancelled: 'border-line opacity-60',
  no_show:   'border-red-border opacity-60',
  walkin:    'border-walk-border',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Determina si el status permite acciones rápidas. */
function isActionable(status: string): boolean {
  return ['pending', 'confirmed', 'walkin'].includes(status);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppointmentCard({ appointment }: Props) {
  const [isPending, startTransition] = useTransition();

  const { id, starts_at, ends_at, status, service, customer, staff } = appointment;

  const badgeClass = STATUS_BADGE[status] ?? 'bg-past-bg text-ink-2';
  const borderClass = STATUS_BORDER[status] ?? 'border-line';

  function handleAction(newStatus: 'completed' | 'no_show') {
    startTransition(async () => {
      await updateAppointmentStatus(id, newStatus);
    });
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${borderClass} bg-white transition-opacity ${isPending ? 'opacity-50' : ''}`}
    >
      {/* Fila superior: hora + badge de estado */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold tabular-nums text-ink-2">
            {formatTime(starts_at)}
            <span className="font-normal text-faint"> – {formatTime(ends_at)}</span>
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-ink">
            {service.name}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Fila media: cliente + barbero */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-faint">
        <span className="truncate">
          {customer ? customer.name : 'Sin cliente registrado'}
        </span>
        <span className="shrink-0 text-past-line">·</span>
        <span className="shrink-0">{staff.name}</span>
      </div>

      {/* Acciones rápidas — solo en estados accionables */}
      {isActionable(status) && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => handleAction('completed')}
            disabled={isPending}
            className="flex-1 rounded border border-teal-border bg-tint-1 py-1 text-xs font-medium text-teal-ink hover:bg-tint-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Completar
          </button>
          <button
            onClick={() => handleAction('no_show')}
            disabled={isPending}
            className="flex-1 rounded border border-red-border bg-red-tint py-1 text-xs font-medium text-red-ink hover:bg-red-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            No asistió
          </button>
        </div>
      )}
    </div>
  );
}
