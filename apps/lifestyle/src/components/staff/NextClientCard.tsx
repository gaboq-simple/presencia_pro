// ─── NextClientCard ───────────────────────────────────────────────────────────
// Client Component — tarjeta del próximo cliente del barbero.
//
// Recibe el array de citas del día desde StaffLayout (que gestiona Realtime).
// Deriva el "próximo cliente" en cada render — no tiene estado propio.
//
// Lógica de selección:
//   · Primer appointment cuyo ends_at > ahora (cubre en curso y futuros).
//   · Si date !== hoy → primer appointment del día (todos son futuros).
//   · Sin citas → "Sin citas para este día".
//   · Todas terminadas → "Jornada terminada".

'use client';

import type { DayAppointmentForStaff } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DayAppointmentForStaff[];
  date: string;   // 'YYYY-MM-DD' — para comparar con hoy
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isToday(date: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return date === today;
}

function isOngoing(appointment: DayAppointmentForStaff): boolean {
  const now = Date.now();
  return (
    new Date(appointment.starts_at).getTime() <= now &&
    now < new Date(appointment.ends_at).getTime()
  );
}

// ─── Derivación: próximo appointment ─────────────────────────────────────────

function getNextAppointment(
  appointments: DayAppointmentForStaff[],
  date: string,
): { appointment: DayAppointmentForStaff; ongoing: boolean } | null {
  if (appointments.length === 0) return null;

  const sorted = [...appointments].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );

  if (!isToday(date)) {
    // Fecha futura: primer appointment del día
    return { appointment: sorted[0], ongoing: false };
  }

  const now = Date.now();

  // Busca el primer appointment que no haya terminado
  const next = sorted.find(
    (a) => new Date(a.ends_at).getTime() > now,
  );

  if (!next) return null;

  return { appointment: next, ongoing: isOngoing(next) };
}

// ─── Subcomponente: estado vacío ──────────────────────────────────────────────

function EmptyCard({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
      <p className="text-sm font-medium text-gray-500">{message}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NextClientCard({ appointments, date }: Props) {
  const result = getNextAppointment(appointments, date);

  // Sin citas en el día
  if (appointments.length === 0) {
    return <EmptyCard message="Sin citas para este día" />;
  }

  // Todas las citas terminaron
  if (!result) {
    return (
      <EmptyCard
        message="Jornada terminada"
        sub="No hay más citas para hoy"
      />
    );
  }

  const { appointment: appt, ongoing } = result;
  const customerName = appt.customer?.name ?? 'Sin cliente registrado';

  return (
    <div className="rounded-xl border-2 border-gray-900 bg-white px-4 py-4">
      {/* Etiqueta superior */}
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
        {ongoing ? 'En curso' : 'Próximo cliente'}
      </p>

      {/* Nombre del cliente */}
      <p className="mt-1 text-2xl font-bold leading-tight text-gray-900 truncate">
        {customerName}
      </p>

      {/* Servicio */}
      <p className="mt-0.5 text-sm text-gray-600 truncate">
        {appt.service.name}
      </p>

      {/* Hora + duración */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-lg font-semibold tabular-nums text-gray-900">
          {formatTime(appt.starts_at)}
        </span>
        <span className="text-sm text-gray-400">
          – {formatTime(appt.ends_at)}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {appt.service.duration_minutes} min
        </span>
      </div>

      {/* Indicador visual de en curso */}
      {ongoing && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
          <span className="text-xs text-green-700 font-medium">Atendiendo ahora</span>
        </div>
      )}
    </div>
  );
}
