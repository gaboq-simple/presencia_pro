// ─── AssistantUpcoming ────────────────────────────────────────────────────────
// Sección prominente — citas que empiezan en las próximas 2 horas.
// Diseñada para el asistente que necesita visión inmediata del flujo del negocio.
//
// Muestra el nombre del cliente, servicio, barbero y hora.
// Si no hay citas próximas: mensaje tranquilizador.

'use client';

import type { DashboardAppointment } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantUpcoming({ appointments }: Props) {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;

  // Citas que empiezan en los próximos 120 minutos (o están en curso ahora)
  const upcoming = appointments
    .filter((a) => {
      const start = new Date(a.starts_at).getTime();
      const end   = new Date(a.ends_at).getTime();
      return end > now && start <= now + twoHoursMs;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  if (upcoming.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center">
        <p className="text-sm font-medium text-gray-500">Sin citas en las próximas 2 horas</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-gray-400">
        Próximas 2 horas · {upcoming.length} {upcoming.length === 1 ? 'cita' : 'citas'}
      </p>
      {upcoming.map((appt) => {
        const isOngoing =
          new Date(appt.starts_at).getTime() <= now &&
          now < new Date(appt.ends_at).getTime();
        const mins = minutesUntil(appt.starts_at);
        const customerName = appt.customer?.name ?? 'Sin cliente';

        return (
          <div
            key={appt.id}
            className={`rounded-xl px-4 py-3 ${
              isOngoing
                ? 'border-2 border-green-400 bg-green-50'
                : 'border-2 border-gray-900 bg-white'
            }`}
          >
            {/* Etiqueta: en curso o tiempo restante */}
            <p className={`text-xs font-semibold uppercase tracking-wide ${
              isOngoing ? 'text-green-700' : 'text-gray-400'
            }`}>
              {isOngoing
                ? '● En curso'
                : mins <= 0
                ? 'Ahora'
                : `En ${mins} min`}
            </p>

            {/* Cliente */}
            <p className="mt-0.5 truncate text-xl font-bold text-gray-900">
              {customerName}
            </p>

            {/* Servicio */}
            <p className="mt-0.5 truncate text-sm text-gray-600">
              {appt.service.name}
            </p>

            {/* Hora + barbero */}
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold tabular-nums text-gray-800">
                {formatTime(appt.starts_at)}
                <span className="font-normal text-gray-400"> – {formatTime(appt.ends_at)}</span>
              </span>
              <span className="truncate ml-3 text-right text-gray-400">
                {appt.staff.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
