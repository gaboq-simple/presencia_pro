// ─── AssistantDayTimeline ─────────────────────────────────────────────────────
// Lista cronológica de TODAS las citas del negocio para el día.
// Vista del asistente — incluye nombre del barbero en cada tarjeta.
//
// Capacidades adicionales vs StaffDayTimeline:
//   · Cancelar cita con razón (inline form).
//   · Editar notas inline por cita.
//
// Las mutaciones usan Server Actions de assistant-actions.ts.
// El callback onMutated() notifica a AssistantLayout para refrescar el estado.

'use client';

import { useState, useTransition } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import {
  cancelAppointment,
  completeAppointment,
  noShowAppointment,
  updateAppointmentNotes,
} from '@/app/staff/assistant-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
  date: string;
  onMutated: () => void;  // notifica al padre para refrescar
};

// ─── Config visual ────────────────────────────────────────────────────────────

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
  cancelled: 'border-gray-200 opacity-40',
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

function isCancellable(status: string): boolean {
  return ['pending', 'confirmed', 'walkin'].includes(status);
}

// ─── AppointmentCard ──────────────────────────────────────────────────────────

type CardProps = {
  appointment: DashboardAppointment;
  onMutated: () => void;
};

function AssistantAppointmentCard({ appointment, onMutated }: CardProps) {
  const [isPending, startTransition] = useTransition();

  // Cancel flow
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason]     = useState('');

  // Notes flow
  const [showNotes, setShowNotes]   = useState(false);
  const [notesValue, setNotesValue] = useState(appointment.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);

  const { id, starts_at, ends_at, status, service, customer, staff, notes } = appointment;
  const badgeClass  = STATUS_BADGE[status]  ?? 'bg-gray-100 text-gray-600';
  const borderClass = STATUS_BORDER[status] ?? 'border-gray-200';

  function handleComplete() {
    startTransition(async () => {
      await completeAppointment(id);
      onMutated();
    });
  }

  function handleNoShow() {
    startTransition(async () => {
      await noShowAppointment(id);
      onMutated();
    });
  }

  function handleCancel() {
    startTransition(async () => {
      await cancelAppointment(id, cancelReason);
      setShowCancelForm(false);
      setCancelReason('');
      onMutated();
    });
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    try {
      await updateAppointmentNotes(id, notesValue);
      setShowNotes(false);
      onMutated();
    } finally {
      setNotesSaving(false);
    }
  }

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2.5 transition-opacity ${borderClass} ${isPending ? 'opacity-50' : ''}`}
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

      {/* Cliente + barbero */}
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span className="truncate">
          {customer ? customer.name : 'Sin cliente'}
        </span>
        <span className="text-gray-300">·</span>
        <span className="shrink-0 text-gray-400">{staff.name}</span>
        <span className="ml-auto shrink-0 text-gray-300">
          {service.duration_minutes} min
        </span>
      </div>

      {/* Notas existentes (lectura) */}
      {notes && !showNotes && (
        <p className="mt-1.5 text-xs italic text-gray-400">📝 {notes}</p>
      )}

      {/* Acciones del asistente */}
      {status !== 'cancelled' && status !== 'no_show' && !showCancelForm && !showNotes && (
        <div className="mt-2 space-y-1.5">
          {/* Fila 1: Completar + No asistio (acciones de estado final) */}
          {status !== 'completed' && (
            <div className="flex gap-1.5">
              <button
                onClick={handleComplete}
                disabled={isPending}
                className="flex-1 rounded border border-gray-800 bg-gray-900 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Completar
              </button>
              {(status === 'pending' || status === 'confirmed') && (
                <button
                  onClick={handleNoShow}
                  disabled={isPending}
                  className="flex-1 rounded border border-orange-200 bg-orange-50 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                >
                  No asistio
                </button>
              )}
            </div>
          )}

          {/* Fila 2: Cancelar + Notas */}
          <div className="flex gap-1.5">
            {isCancellable(status) && (
              <button
                onClick={() => setShowCancelForm(true)}
                disabled={isPending}
                className="flex-1 rounded border border-red-200 bg-red-50 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={() => {
                setNotesValue(appointment.notes ?? '');
                setShowNotes(true);
              }}
              disabled={isPending}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              title="Editar notas"
            >
              📝
            </button>
          </div>
        </div>
      )}

      {/* Cancel form inline */}
      {showCancelForm && (
        <div className="mt-2 space-y-1.5">
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Razón (opcional)"
            maxLength={200}
            className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="flex-1 rounded bg-red-600 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isPending ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
            <button
              onClick={() => { setShowCancelForm(false); setCancelReason(''); }}
              disabled={isPending}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              Volver
            </button>
          </div>
        </div>
      )}

      {/* Notes inline editor */}
      {showNotes && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Notas operativas…"
            className="w-full resize-none rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleSaveNotes()}
              disabled={notesSaving}
              className="flex-1 rounded bg-gray-900 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {notesSaving ? 'Guardando…' : 'Guardar notas'}
            </button>
            <button
              onClick={() => setShowNotes(false)}
              disabled={notesSaving}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantDayTimeline({ appointments, date, onMutated }: Props) {
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
        Agenda completa · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
      </p>
      <div className="space-y-2">
        {sorted.map((appt) => (
          <AssistantAppointmentCard
            key={appt.id}
            appointment={appt}
            onMutated={onMutated}
          />
        ))}
      </div>
    </div>
  );
}
