// ─── AppointmentSheet ────────────────────────────────────────────────────────
// La ficha de una cita (Paso 4): bottom sheet que abre al tocar una card del hilo.
// Es el DESTINO de las acciones secundarias (Reagendar / Cancelar / Notas) — que
// antes vivían como botones planos en la card — más el contacto con el cliente
// (tel:/wa.me, reemplaza la mensajería business-wide que sacamos en el Paso 1) y,
// como fallback accesible al swipe, Terminó / No vino.
//
// Reusa los server actions existentes (mismo wiring que AssistantDayTimeline):
// completeAppointment, noShowAppointment, cancelAppointment, rescheduleAppointment,
// updateAppointmentNotes. useTransition + error inline, como el resto de la vista.

'use client';

import { useState, useTransition } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import {
  cancelAppointment,
  completeAppointment,
  noShowAppointment,
  updateAppointmentNotes,
  rescheduleAppointment,
} from '@/app/staff/assistant-actions';

export type StaffOption = { id: string; name: string };

const ACTIVE = new Set(['pending', 'confirmed', 'walkin']);

type Props = {
  appt: DashboardAppointment;
  date: string;
  timezone: string;
  staffOptions: StaffOption[];
  onClose: () => void;
  onMutated: () => void;
};

type Panel = 'none' | 'reschedule' | 'cancel' | 'notes';

export default function AppointmentSheet({ appt, date, timezone, staffOptions, onClose, onMutated }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');

  const [cancelReason, setCancelReason] = useState('');
  const [notesValue, setNotesValue]     = useState(appt.notes ?? '');
  const [reschedDate, setReschedDate]   = useState(date);
  const [reschedTime, setReschedTime]   = useState('');
  const [reschedStaffId, setReschedStaffId] = useState(appt.staff?.id ?? staffOptions[0]?.id ?? '');

  const isActive = ACTIVE.has(appt.status);
  const phoneRaw = appt.customer?.phone ?? '';
  const telHref = phoneRaw ? `tel:${phoneRaw}` : undefined;
  const waHref  = phoneRaw ? `https://wa.me/${phoneRaw.replace(/\D/g, '')}` : undefined;

  const timeLabel = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatRange(new Date(appt.starts_at), new Date(appt.ends_at));

  function run(fn: () => Promise<{ error?: string } | void>, failMsg: string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res?.error) { setError(res.error); return; }
        onMutated();
      } catch {
        setError(failMsg);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30" onClick={onClose}>
      <div
        className="animate-card-in max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-card border border-line bg-card px-4 pb-8 pt-3 shadow-hero"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Asa */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{appt.customer?.name ?? 'Cliente'}</p>
            <p className="text-sm text-ink-2">{appt.service?.name ?? ''}</p>
            <p className="mt-0.5 text-sm tabular-nums text-ink-2">{timeLabel}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg px-2 py-1 text-ink-2 hover:bg-past-bg">✕</button>
        </div>

        {/* Contacto — tel: / wa.me (reemplaza la bandeja business-wide del Paso 1) */}
        {phoneRaw && (
          <div className="mt-3 flex gap-2">
            <a href={telHref} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-card py-2.5 text-sm font-semibold text-ink-2 hover:bg-tint-1">
              Llamar
            </a>
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-card py-2.5 text-sm font-semibold text-teal-ink hover:bg-tint-1">
              WhatsApp
            </a>
          </div>
        )}

        {/* Acciones secundarias */}
        {isActive && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')} className="rounded-xl border border-line bg-card py-2.5 text-sm font-semibold text-ink-2 hover:bg-tint-1">Reagendar</button>
            <button onClick={() => setPanel(panel === 'notes' ? 'none' : 'notes')} className="rounded-xl border border-line bg-card py-2.5 text-sm font-semibold text-ink-2 hover:bg-tint-1">Notas</button>
            <button onClick={() => setPanel(panel === 'cancel' ? 'none' : 'cancel')} className="rounded-xl border border-line bg-card py-2.5 text-sm font-semibold text-red-ink hover:bg-red-tint">Cancelar</button>
          </div>
        )}

        {/* Panel Reagendar */}
        {panel === 'reschedule' && (
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-past-bg/40 p-3">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink" />
              <input type="time" value={reschedTime} onChange={(e) => setReschedTime(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink" />
            </div>
            {staffOptions.length > 1 && (
              <select value={reschedStaffId} onChange={(e) => setReschedStaffId(e.target.value)} className="w-full rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink">
                {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button
              disabled={isPending || !reschedTime}
              onClick={() => run(() => rescheduleAppointment({
                appointmentId: appt.id,
                newDate: reschedDate,
                newStartTime: reschedTime,
                newStaffId: reschedStaffId !== appt.staff?.id ? reschedStaffId : undefined,
              }), 'No se pudo reagendar.')}
              className="w-full rounded-xl bg-teal-ink py-2.5 text-sm font-semibold text-card disabled:opacity-50"
            >
              Confirmar reagenda
            </button>
          </div>
        )}

        {/* Panel Notas */}
        {panel === 'notes' && (
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-past-bg/40 p-3">
            <textarea value={notesValue} onChange={(e) => setNotesValue(e.target.value)} maxLength={500} rows={3} placeholder="Nota sobre este cliente…" className="w-full rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink" />
            <button disabled={isPending} onClick={() => run(() => updateAppointmentNotes(appt.id, notesValue), 'No se pudo guardar la nota.')} className="w-full rounded-xl bg-teal-ink py-2.5 text-sm font-semibold text-card disabled:opacity-50">Guardar nota</button>
          </div>
        )}

        {/* Panel Cancelar */}
        {panel === 'cancel' && (
          <div className="mt-3 space-y-2 rounded-xl border border-red-border bg-red-tint p-3">
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={200} rows={2} placeholder="Motivo (opcional)…" className="w-full rounded-lg border border-line bg-card px-2 py-2 text-sm text-ink" />
            <button disabled={isPending} onClick={() => run(() => cancelAppointment(appt.id, cancelReason), 'No se pudo cancelar.')} className="w-full rounded-xl bg-red-ink py-2.5 text-sm font-semibold text-card disabled:opacity-50">Confirmar cancelación</button>
          </div>
        )}

        {/* Fallback accesible al swipe: Terminó / No vino */}
        {isActive && (
          <div className="mt-4 flex gap-2 border-t border-line pt-4">
            <button disabled={isPending} onClick={() => run(() => completeAppointment(appt.id), 'No se pudo completar.')} className="min-h-[44px] flex-1 rounded-xl bg-teal-ink text-sm font-semibold text-card disabled:opacity-50">Terminó</button>
            <button disabled={isPending} onClick={() => run(() => noShowAppointment(appt.id), 'No se pudo marcar No vino.')} className="min-h-[44px] flex-1 rounded-xl border border-line bg-card text-sm font-semibold text-ink-2 disabled:opacity-50">No vino</button>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}
      </div>
    </div>
  );
}
