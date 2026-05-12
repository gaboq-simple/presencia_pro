// ─── StaffDayTimeline ─────────────────────────────────────────────────────────
// Client Component — lista cronológica de citas del barbero.
//
// Recibe appointments desde StaffLayout (que gestiona Realtime).
// No tiene suscripción Realtime propia.
//
// Por cada cita:
//   · pending / confirmed / walkin → botones "Completar" y "No se presentó"
//   · completed / no_show / cancelled → solo lectura, estado visual diferenciado

'use client';

import { useTransition } from 'react';
import type { DayAppointmentForStaff } from '@/lib/dashboard.types';
import { updateAppointmentStatusAsBarber } from '@/app/staff/actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DayAppointmentForStaff[];
  date: string;
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
  pending:   'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
  no_show:   'bg-red-100 text-red-800',
  walkin:    'bg-purple-100 text-purple-800',
};

const STATUS_BORDER: Record<string, string> = {
  pending:   'border-yellow-200',
  confirmed: 'border-blue-200',
  completed: 'border-green-200 opacity-70',
  cancelled: 'border-gray-200 opacity-50',
  no_show:   'border-red-200 opacity-50',
  walkin:    'border-purple-200',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isActionable(status: string): boolean {
  return ['pending', 'confirmed', 'walkin'].includes(status);
}

// ─── StaffAppointmentCard ─────────────────────────────────────────────────────

type CardProps = {
  appointment: DayAppointmentForStaff;
};

function StaffAppointmentCard({ appointment }: CardProps) {
  const [isPending, startTransition] = useTransition();

  const { id, starts_at, ends_at, status, service, customer } = appointment;
  const badgeClass = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600';
  const borderClass = STATUS_BORDER[status] ?? 'border-gray-200';

  function handleAction(newStatus: 'completed' | 'no_show') {
    startTransition(async () => {
      await updateAppointmentStatusAsBarber(id, newStatus);
    });
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 bg-white transition-opacity ${borderClass} ${isPending ? 'opacity-50' : ''}`}
    >
      {/* Fila superior: hora + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold tabular-nums text-gray-700">
            {formatTime(starts_at)}
            <span className="font-normal text-gray-400"> – {formatTime(ends_at)}</span>
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
            {service.name}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Cliente + duración */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
        <span className="truncate">
          {customer ? customer.name : 'Sin cliente registrado'}
        </span>
        <span className="ml-auto shrink-0 text-gray-300">
          {service.duration_minutes} min
        </span>
      </div>

      {/* Acciones — solo para estados accionables */}
      {isActionable(status) && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => handleAction('completed')}
            disabled={isPending}
            className="flex-1 rounded border border-green-300 bg-green-50 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Completar
          </button>
          <button
            onClick={() => handleAction('no_show')}
            disabled={isPending}
            className="flex-1 rounded border border-red-200 bg-red-50 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            No se presentó
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffDayTimeline({ appointments, date }: Props) {
  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
        <p className="text-sm text-gray-400">Sin citas para este día.</p>
        <p className="mt-1 text-xs text-gray-300">{date}</p>
      </div>
    );
  }

  const sorted = [...appointments].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-medium text-gray-500">
        Tu agenda · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
      </p>
      <div className="space-y-2">
        {sorted.map((appt) => (
          <StaffAppointmentCard key={appt.id} appointment={appt} />
        ))}
      </div>
    </div>
  );
}
