// ─── AssistantDayTimeline ─────────────────────────────────────────────────────
// Lista cronológica de TODAS las citas del negocio para el día.
// Vista del asistente — incluye nombre del barbero en cada tarjeta.
//
// Capacidades adicionales vs StaffDayTimeline:
//   · Cancelar cita con razón (inline form).
//   · Editar notas inline por cita.
//   · Reagendar cita (Feature 3) — cambia fecha, hora y/o barbero.
//   · Trazabilidad (Feature 5) — muestra quién creó o modificó.
//   · Nombre del cliente prominente.
//
// Las mutaciones usan Server Actions de assistant-actions.ts.
// El callback onMutated() notifica a AssistantLayout para refrescar el estado.

'use client';

import { useState, useTransition, useEffect } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import {
  cancelAppointment,
  completeAppointment,
  noShowAppointment,
  updateAppointmentNotes,
  rescheduleAppointment,
} from '@/app/staff/assistant-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type StaffOption = { id: string; name: string };

type Props = {
  appointments: DashboardAppointment[];
  date: string;
  timezone: string;             // IANA — para la linea "Ahora"
  onMutated: () => void;
  staffOptions: StaffOption[];  // para el selector de barbero en reagendar
};

// ─── Config visual ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show:   'No asistio',
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

function isReschedulable(status: string): boolean {
  return ['pending', 'confirmed'].includes(status);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── AppointmentCard ──────────────────────────────────────────────────────────

type CardProps = {
  appointment: DashboardAppointment;
  onMutated: () => void;
  date: string;
  staffOptions: StaffOption[];
};

function AssistantAppointmentCard({ appointment, onMutated, date, staffOptions }: CardProps) {
  const [isPending, startTransition] = useTransition();

  // Cancel flow
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason]     = useState('');

  // Notes flow
  const [showNotes, setShowNotes]     = useState(false);
  const [notesValue, setNotesValue]   = useState(appointment.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);

  // Reschedule flow
  const [showReschedule, setShowReschedule] = useState(false);
  const [reschedDate, setReschedDate]       = useState(date);
  const [reschedTime, setReschedTime]       = useState('');
  const [reschedStaffId, setReschedStaffId] = useState(appointment.staff.id);
  const [reschedError, setReschedError]     = useState<string | null>(null);
  const [reschedPending, setReschedPending] = useState(false);

  // Error de acción (completar/no-asistió/cancelar/notas) — se muestra inline en
  // la tarjeta SIN tumbar el error boundary de la agenda. El gate 2b ("solo tus
  // citas") y demás mensajes esperados llegan como { error }; los throw de sistema
  // caen al catch con un aviso local genérico. Nunca escala a la página.
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    id, starts_at, ends_at, status, service, customer, staff, notes,
    created_by, modified_by,
  } = appointment;
  const badgeClass  = STATUS_BADGE[status]  ?? 'bg-gray-100 text-gray-600';
  const borderClass = STATUS_BORDER[status] ?? 'border-gray-200';

  function handleComplete() {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await completeAppointment(id);
        if (res?.error) { setActionError(res.error); return; }
        onMutated();
      } catch {
        setActionError('No se pudo completar la cita. Intenta de nuevo.');
      }
    });
  }

  function handleNoShow() {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await noShowAppointment(id);
        if (res?.error) { setActionError(res.error); return; }
        onMutated();
      } catch {
        setActionError('No se pudo marcar como no asistió. Intenta de nuevo.');
      }
    });
  }

  function handleCancel() {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await cancelAppointment(id, cancelReason);
        if (res?.error) { setActionError(res.error); return; }
        setShowCancelForm(false);
        setCancelReason('');
        onMutated();
      } catch {
        setActionError('No se pudo cancelar la cita. Intenta de nuevo.');
      }
    });
  }

  async function handleSaveNotes() {
    setActionError(null);
    setNotesSaving(true);
    try {
      const res = await updateAppointmentNotes(id, notesValue);
      if (res?.error) { setActionError(res.error); return; }
      setShowNotes(false);
      onMutated();
    } catch {
      setActionError('No se pudieron guardar las notas. Intenta de nuevo.');
    } finally {
      setNotesSaving(false);
    }
  }

  async function handleReschedule() {
    if (!reschedTime) {
      setReschedError('Indica la hora');
      return;
    }
    setReschedPending(true);
    setReschedError(null);
    try {
      const res = await rescheduleAppointment({
        appointmentId: id,
        newDate:       reschedDate,
        newStartTime:  reschedTime,
        newStaffId:    reschedStaffId !== appointment.staff.id ? reschedStaffId : undefined,
      });
      if (res?.error) { setReschedError(res.error); return; }
      setShowReschedule(false);
      onMutated();
    } catch {
      setReschedError('No se pudo reagendar. Intenta de nuevo.');
    } finally {
      setReschedPending(false);
    }
  }

  // Texto de trazabilidad sutil
  const traceText = modified_by
    ? `Modificada por ${modified_by.name}`
    : created_by
    ? `Creada por ${created_by.name}`
    : null;

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2.5 transition-opacity ${borderClass} ${isPending ? 'opacity-50' : ''}`}
    >
      {/* Nombre del cliente — prominente */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-gray-900">
            {customer ? customer.name : 'Sin nombre'}
          </p>
          <p className="truncate text-sm text-gray-500">{service.name}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Hora + barbero */}
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
        <span className="tabular-nums font-medium text-gray-600">
          {formatTime(starts_at)}
          <span className="font-normal text-gray-400"> – {formatTime(ends_at)}</span>
        </span>
        <span className="text-gray-300">·</span>
        <span className="truncate">{staff.name}</span>
        <span className="ml-auto shrink-0">{service.duration_minutes} min</span>
      </div>

      {/* Notas existentes (lectura) */}
      {notes && !showNotes && (
        <p className="mt-1.5 text-xs italic text-gray-400">📝 {notes}</p>
      )}

      {/* Trazabilidad — texto sutil */}
      {traceText && !showCancelForm && !showNotes && !showReschedule && (
        <p className="mt-1 text-xs text-gray-300">{traceText}</p>
      )}

      {/* Acciones del asistente */}
      {status !== 'cancelled' && status !== 'no_show' && !showCancelForm && !showNotes && !showReschedule && (
        <div className="mt-2 space-y-1.5">
          {/* Fila 1: Completar + No asistio */}
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

          {/* Fila 2: Reagendar + Cancelar + Notas */}
          <div className="flex gap-1.5">
            {isReschedulable(status) && (
              <button
                onClick={() => {
                  setReschedDate(date);
                  setReschedTime(
                    new Date(starts_at).toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    }),
                  );
                  setReschedStaffId(appointment.staff.id);
                  setReschedError(null);
                  setShowReschedule(true);
                }}
                disabled={isPending}
                className="flex-1 rounded border border-indigo-200 bg-indigo-50 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                Reagendar
              </button>
            )}
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

      {/* Reagendar inline */}
      {showReschedule && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs font-medium text-gray-600">Reagendar cita</p>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Fecha</label>
              <input
                type="date"
                value={reschedDate}
                min={todayString()}
                onChange={(e) => setReschedDate(e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Hora</label>
              <input
                type="time"
                value={reschedTime}
                onChange={(e) => setReschedTime(e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
                autoFocus
              />
            </div>
          </div>
          {staffOptions.length > 1 && (
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Barbero</label>
              <select
                value={reschedStaffId}
                onChange={(e) => setReschedStaffId(e.target.value)}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
              >
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {reschedError && (
            <p className="text-xs text-red-600">{reschedError}</p>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleReschedule()}
              disabled={reschedPending || !reschedTime}
              className="flex-1 rounded bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {reschedPending ? 'Guardando…' : 'Confirmar reagenda'}
            </button>
            <button
              onClick={() => setShowReschedule(false)}
              disabled={reschedPending}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              Volver
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

      {/* Aviso de acción rechazada — inline, NO tumba la agenda. Ej: gate 2b
          "solo tus citas". El barbero sigue en la vista, no recarga. */}
      {actionError && (
        <div className="mt-2 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
          <p className="flex-1 text-xs text-amber-800">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-xs text-amber-500 hover:text-amber-700"
            aria-label="Descartar aviso"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Helper: hora actual en el timezone del negocio ───────────────────────────

function getNowLocalTime(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function isLocalToday(date: string, timezone: string): boolean {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    .format(new Date());
  return localDate === date;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantDayTimeline({
  appointments,
  date,
  timezone,
  onMutated,
  staffOptions,
}: Props) {
  // Hora actual (actualiza cada minuto) — solo se usa cuando date === hoy
  const [nowTime, setNowTime] = useState<string | null>(null);
  const [prevDateTz, setPrevDateTz] = useState(`${date}|${timezone}`);
  const dateTz = `${date}|${timezone}`;
  if (prevDateTz !== dateTz) {
    setPrevDateTz(dateTz);
    if (!isLocalToday(date, timezone)) {
      setNowTime(null);
    }
  }

  useEffect(() => {
    if (!isLocalToday(date, timezone)) return;
    const update = () => setNowTime(getNowLocalTime(timezone));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [date, timezone]);

  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
        <p className="text-sm text-gray-400">Sin citas para este dia.</p>
        <p className="mt-1 text-xs text-gray-300">{date}</p>
      </div>
    );
  }

  const sorted = [...appointments].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );

  // Calcular el indice de corte "Ahora" (entre ultima pasada y primera futura)
  let nowSplitIndex: number | null = null;
  if (nowTime !== null) {
    // Comparar hora local de cada cita con la hora actual
    const nowHHMM = nowTime; // 'HH:MM'
    let lastPastIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      const apptTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(sorted[i]!.ends_at));
      if (apptTime <= nowHHMM) {
        lastPastIdx = i;
      }
    }
    // Insertar separador despues del ultimo pasado (antes del primero futuro)
    if (lastPastIdx >= 0 && lastPastIdx < sorted.length - 1) {
      nowSplitIndex = lastPastIdx;
    }
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-medium text-gray-500">
        Agenda completa · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
      </p>
      <div className="space-y-2">
        {sorted.map((appt, idx) => {
          const isPast = nowTime !== null && (() => {
            const apptEndTime = new Intl.DateTimeFormat('en-GB', {
              timeZone: timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(new Date(appt.ends_at));
            return apptEndTime <= nowTime;
          })();

          return (
            <div key={appt.id} className={isPast ? 'opacity-50' : undefined}>
              {/* Separador "Ahora" — se inserta DESPUES de la ultima cita pasada */}
              {nowSplitIndex === idx && (
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-red-400" />
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                    Ahora · {nowTime}
                  </span>
                  <div className="h-px flex-1 bg-red-400" />
                </div>
              )}
              <AssistantAppointmentCard
                appointment={appt}
                onMutated={onMutated}
                date={date}
                staffOptions={staffOptions}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
