// ─── DayTimeline ─────────────────────────────────────────────────────────────
// Client Component — lista cronológica de citas del día.
//
// Muestra citas ordenadas por hora. Entre citas con una brecha ≥ 30 min
// muestra un indicador de tiempo disponible.
// No tiene suscripción Realtime propia — recibe appointments como prop
// desde DashboardRealtimeProvider.

'use client';

import type { DashboardAppointment } from '@/lib/dashboard.types';
import AppointmentCard from './AppointmentCard';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
  date: string;   // 'YYYY-MM-DD' — para mostrar en el estado vacío
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIN_GAP_MINUTES = 30;

function minutesBetween(endIso: string, startIso: string): number {
  return (new Date(startIso).getTime() - new Date(endIso).getTime()) / 60_000;
}

function formatGap(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min disponibles`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}min disponibles` : `${h}h disponibles`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DayTimeline({ appointments, date }: Props) {
  if (appointments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
        <p className="text-sm text-gray-400">Sin citas para este día.</p>
        <p className="mt-1 text-xs text-gray-300">{date}</p>
      </div>
    );
  }

  // Las citas ya llegan ordenadas por starts_at desde getDayAppointments,
  // pero si Realtime insertó alguna fuera de orden, re-ordenamos.
  const sorted = [...appointments].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );

  const items: React.ReactNode[] = [];

  sorted.forEach((appt, i) => {
    // Indicador de hueco antes de esta cita
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = minutesBetween(prev.ends_at, appt.starts_at);
      if (gap >= MIN_GAP_MINUTES) {
        items.push(
          <div
            key={`gap-${i}`}
            className="flex items-center gap-2 px-1"
            aria-label={`Hueco disponible: ${Math.round(gap)} minutos`}
          >
            <div className="h-px flex-1 border-t border-dashed border-gray-200" />
            <span className="shrink-0 text-xs text-gray-300">
              {formatGap(gap)}
            </span>
            <div className="h-px flex-1 border-t border-dashed border-gray-200" />
          </div>,
        );
      }
    }

    items.push(
      <AppointmentCard key={appt.id} appointment={appt} />,
    );
  });

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-medium text-gray-500">
        Agenda del día · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
      </p>
      <div className="space-y-2">{items}</div>
    </div>
  );
}
