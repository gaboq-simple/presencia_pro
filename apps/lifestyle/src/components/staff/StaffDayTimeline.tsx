// ─── StaffDayTimeline ─────────────────────────────────────────────────────────
// Client Component — lista cronológica de citas del barbero (jerarquía v5).
//
// Recibe appointments desde StaffLayout (que gestiona Realtime).
//
// Jerarquía visual (maqueta v5 "Estructura 1 — atenuación pura"):
//   · Futuro / en curso = presencia plena (blanco, teal), gesto B border-left teal.
//   · Pasado completado = retrocede POR COLOR (past-bg/past-ink), sin opacity.
//   · No-show pasado = apagado igual, PERO border-left rojo (red-ink) que lo rescata.
//   · Marcador "Ahora · HH:MM" separando pasado de futuro (solo hoy).

'use client';

import { useState, useTransition } from 'react';
import type { DayAppointmentForStaff } from '@/lib/dashboard.types';
import { updateAppointmentStatusAsBarber } from '@/app/staff/actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DayAppointmentForStaff[];
  date: string;
};

type VState = 'ongoing' | 'upcoming' | 'done' | 'noshow';

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show:   'No asistió',
  walkin:    'Walk-in',
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

function isToday(date: string): boolean {
  return date === new Date().toISOString().slice(0, 10);
}

/** Estado visual de la fila (independiente del status crudo para la jerarquía). */
function visualState(appt: DayAppointmentForStaff, now: number): VState {
  if (appt.status === 'completed' || appt.status === 'cancelled') return 'done';
  if (appt.status === 'no_show') return 'noshow';
  const start = new Date(appt.starts_at).getTime();
  const end = new Date(appt.ends_at).getTime();
  if (start <= now && now < end) return 'ongoing';
  return 'upcoming';
}

// Clases del gesto B (border-left) + fondo por estado visual.
const ROW_SHELL: Record<VState, string> = {
  ongoing:  'bg-card border-line border-l-teal shadow-card',
  upcoming: 'bg-card border-line border-l-teal-border shadow-card',
  done:     'bg-past-bg border-past-line border-l-past-line',
  noshow:   'bg-past-bg border-past-line border-l-red-ink',
};
// Texto atenuado POR COLOR en el pasado (nunca opacity).
const ROW_TIME: Record<VState, string> = {
  ongoing:  'text-ink font-semibold',
  upcoming: 'text-ink font-semibold',
  done:     'text-past-ink font-medium',
  noshow:   'text-past-ink font-medium',
};
const ROW_SVC: Record<VState, string> = {
  ongoing:  'text-ink font-medium',
  upcoming: 'text-ink font-medium',
  done:     'text-past-ink font-normal',
  noshow:   'text-past-ink font-normal',
};
const ROW_CUST: Record<VState, string> = {
  ongoing:  'text-ink-2',
  upcoming: 'text-ink-2',
  done:     'text-past-faint',
  noshow:   'text-past-faint',
};
const TAG_CLASS: Record<VState, string> = {
  ongoing:  'text-teal-ink bg-tint-1',
  upcoming: 'text-teal-ink bg-tint-1',
  done:     'text-past-ink bg-[#E6E9E9]',
  noshow:   'text-red-ink bg-red-tint',
};

function tagLabel(appt: DayAppointmentForStaff, vs: VState): string {
  if (vs === 'ongoing') return 'En curso';
  return STATUS_LABEL[appt.status] ?? appt.status;
}

// ─── Fila ─────────────────────────────────────────────────────────────────────

function StaffAppointmentRow({
  appointment,
  vs,
}: {
  appointment: DayAppointmentForStaff;
  vs: VState;
}) {
  const [isPending, startTransition] = useTransition();
  const { id, starts_at, ends_at, status, service, customer } = appointment;

  function handleAction(newStatus: 'completed' | 'no_show') {
    startTransition(async () => {
      await updateAppointmentStatusAsBarber(id, newStatus);
    });
  }

  return (
    <div
      className={`rounded-r-[12px] border border-l-[3px] px-[13px] py-[11px] ${ROW_SHELL[vs]} ${
        isPending ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-[11px]">
        {/* Hora */}
        <span className={`text-[13px] tabular-nums ${ROW_TIME[vs]}`}>
          {formatTime(starts_at)}
        </span>

        {/* Servicio + cliente */}
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[14px] leading-[1.2] ${ROW_SVC[vs]}`}>
            {service.name}
          </div>
          <div className={`mt-px truncate text-[12px] ${ROW_CUST[vs]}`}>
            {customer ? customer.name : 'Sin cliente registrado'}
          </div>
        </div>

        {/* Tag de estado */}
        <span
          className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[10.5px] font-semibold ${TAG_CLASS[vs]}`}
        >
          {vs === 'ongoing' && (
            <span
              className="h-[5px] w-[5px] rounded-full bg-teal animate-data-beat motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {tagLabel(appointment, vs)}
        </span>
      </div>

      {/* Acciones — solo estados accionables */}
      {isActionable(status) && (
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => handleAction('completed')}
            disabled={isPending}
            className="flex-1 rounded-lg border border-teal-border bg-tint-1 py-1.5 text-[12px] font-semibold text-teal-ink hover:bg-tint-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Completar
          </button>
          <button
            onClick={() => handleAction('no_show')}
            disabled={isPending}
            className="flex-1 rounded-lg border border-red-border bg-red-tint py-1.5 text-[12px] font-semibold text-red-ink hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            No se presentó
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Marcador "Ahora" ─────────────────────────────────────────────────────────

function NowMarker() {
  const label = new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return (
    <div className="my-2.5 flex items-center gap-2" aria-hidden="true">
      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-teal-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-teal animate-data-beat motion-reduce:animate-none" />
        Ahora · {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-teal to-transparent" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffDayTimeline({ appointments, date }: Props) {
  // Congelado al montar (lazy init) para no llamar Date.now() durante el render.
  // Debe ir antes de cualquier return condicional (regla de hooks).
  const [now] = useState(() => Date.now());

  if (appointments.length === 0) {
    return (
      <div className="rounded-r-card border border-l-[3px] border-line border-l-line-2 bg-card px-4 py-8 text-center">
        <p className="text-sm text-ink-2">Sin citas para este día.</p>
        <p className="mt-1 text-xs text-faint tabular-nums">{date}</p>
      </div>
    );
  }

  const sorted = [...appointments].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );

  const today = isToday(date);
  // Índice de la primera cita que NO ha terminado (frontera pasado/futuro).
  const boundary = today
    ? sorted.findIndex((a) => new Date(a.ends_at).getTime() > now)
    : -1;
  // Solo mostramos el marcador si hay pasado Y futuro alrededor de la frontera.
  const showNow = boundary > 0 && boundary < sorted.length;

  return (
    <div className="space-y-2">
      <div className="mb-1 flex items-baseline gap-1.5 px-0.5">
        <span className="text-[12px] font-semibold text-ink-2">Tu agenda</span>
        <span className="text-[11px] tabular-nums text-faint">
          · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
        </span>
      </div>

      <div className="space-y-2">
        {sorted.map((appt, i) => (
          <div key={appt.id}>
            {showNow && i === boundary && <NowMarker />}
            <StaffAppointmentRow appointment={appt} vs={visualState(appt, now)} />
          </div>
        ))}
      </div>
    </div>
  );
}
