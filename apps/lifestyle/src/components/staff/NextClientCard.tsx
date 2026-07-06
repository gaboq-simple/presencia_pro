// ─── NextClientCard ───────────────────────────────────────────────────────────
// Client Component — tarjeta del «Próximo cliente» del barbero (el momento firma).
// Diseño: maqueta v5 (zlot-barber-dashboard-v5) — sistema Zentriq claro.
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

/** Iniciales del cliente para el avatar (máx. 2, primera + última palabra). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
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
    return { appointment: sorted[0]!, ongoing: false };
  }

  const now = Date.now();

  // Busca el primer appointment que no haya terminado
  const next = sorted.find((a) => new Date(a.ends_at).getTime() > now);

  if (!next) return null;

  return { appointment: next, ongoing: isOngoing(next) };
}

// ─── Subcomponente: estado vacío ──────────────────────────────────────────────
// Gesto B atenuado (border-left neutro) para diferenciar del momento firma.

function EmptyCard({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="rounded-r-card border border-l-[3px] border-line border-l-line-2 bg-card px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink-2">{message}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
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

  // Todas las citas terminaron (el tratamiento de fin de jornada rico es PR3)
  if (!result) {
    return <EmptyCard message="Jornada terminada" sub="No hay más citas para hoy" />;
  }

  const { appointment: appt, ongoing } = result;
  const hasCustomer = Boolean(appt.customer?.name);
  const customerName = appt.customer?.name ?? 'Sin cliente registrado';

  return (
    // Gesto B: border-left teal + esquina izquierda plana (rounded-r-card = 0 16px 16px 0)
    <div className="relative overflow-hidden rounded-r-card border border-l-[3px] border-line border-l-teal bg-tint-1 pt-[17px] pr-4 pb-[15px] pl-4 shadow-hero">
      <div className="flex items-center gap-[11px]">
        {/* Avatar con iniciales (tinta oscura sobre gradiente teal) */}
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-avatar bg-hero-grad text-[15px] font-bold text-avatar-ink">
          {hasCustomer ? initials(customerName) : '–'}
        </div>

        <div className="min-w-0">
          {/* Eyebrow con dot; pulso data-beat solo en curso */}
          <div className="flex items-center gap-[7px] text-[12px] font-semibold text-teal-ink">
            <span
              className={`h-[7px] w-[7px] rounded-full bg-teal${
                ongoing ? ' animate-data-beat motion-reduce:animate-none' : ''
              }`}
              aria-hidden="true"
            />
            {ongoing ? 'En curso' : 'Próximo cliente'}
          </div>

          {/* Nombre del cliente — momento firma (clamp a 2 líneas para nombres largos) */}
          <p className="mt-0.5 line-clamp-2 text-[27px] font-semibold leading-[1.02] tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
            {customerName}
          </p>
        </div>
      </div>

      {/* Servicio */}
      <p className="mt-2 text-[13.5px] text-ink-2">{appt.service.name}</p>

      {/* Hora — tabular-nums, separada por línea sutil */}
      <div className="mt-[13px] flex items-baseline gap-2.5 border-t border-line pt-3">
        <span className="text-[19px] font-semibold tabular-nums tracking-[-0.01em] text-teal-ink">
          {formatTime(appt.starts_at)}
        </span>
        <span className="text-[13px] tabular-nums text-faint">
          – {formatTime(appt.ends_at)}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-faint">
          {appt.service.duration_minutes} min
        </span>
      </div>
    </div>
  );
}
