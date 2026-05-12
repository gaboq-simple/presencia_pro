// ─── StaffAvailability ────────────────────────────────────────────────────────
// Client Component — chips de estado por barbero activo.
//
// Estado por barbero (calculado en cliente cada minuto):
//   "En cita · [nombre cliente]"  — cita activa ahora mismo
//   "Disponible"                  — tiene horario hoy, sin cita activa
//   "Sin horario hoy"             — no hay registro en staff_availability
//
// Recibe appointments desde DashboardRealtimeProvider — se actualiza
// automáticamente cuando Realtime entrega cambios de estado.

'use client';

import { useState, useEffect } from 'react';
import type { DashboardAppointment, DashboardStaff } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  staffList: DashboardStaff[];
  appointments: DashboardAppointment[];
};

// ─── Status discriminated union ───────────────────────────────────────────────

type StaffStatus =
  | { kind: 'in_appointment'; customerName: string }
  | { kind: 'available' }
  | { kind: 'no_schedule' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Statuses que cuentan como "el barbero está ocupado en este momento"
const ACTIVE_STATUSES = new Set<string>(['pending', 'confirmed', 'walkin']);

function computeStatus(
  staff: DashboardStaff,
  appointments: DashboardAppointment[],
  now: Date,
): StaffStatus {
  if (!staff.availabilityToday) {
    return { kind: 'no_schedule' };
  }

  const nowMs = now.getTime();

  const current = appointments.find(
    (a) =>
      a.staff.id === staff.id &&
      ACTIVE_STATUSES.has(a.status) &&
      new Date(a.starts_at).getTime() <= nowMs &&
      new Date(a.ends_at).getTime() > nowMs,
  );

  if (current) {
    return {
      kind: 'in_appointment',
      customerName: current.customer?.name ?? 'Cliente',
    };
  }

  return { kind: 'available' };
}

// ─── Chip visual config ───────────────────────────────────────────────────────

function chipClasses(kind: StaffStatus['kind']): string {
  switch (kind) {
    case 'in_appointment':
      return 'border-gray-300 bg-gray-100 text-gray-700';
    case 'available':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'no_schedule':
      return 'border-gray-200 bg-white text-gray-400';
  }
}

function statusLabel(status: StaffStatus): string {
  switch (status.kind) {
    case 'in_appointment':
      return `En cita · ${status.customerName}`;
    case 'available':
      return 'Disponible';
    case 'no_schedule':
      return 'Sin horario hoy';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffAvailability({ staffList, appointments }: Props) {
  // Reloj interno — se actualiza cada minuto para mantener el estado live
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // Alinear al siguiente minuto entero para mayor precisión
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000;

    const timeout = setTimeout(() => {
      setNow(new Date());

      const interval = setInterval(() => {
        setNow(new Date());
      }, 60_000);

      return () => clearInterval(interval);
    }, msUntilNextMinute);

    return () => clearTimeout(timeout);
  }, []);

  const statuses = staffList.map((s) => ({
    staff: s,
    status: computeStatus(s, appointments, now),
  }));

  // Orden: en cita primero, disponibles después, sin horario al final
  const ORDER: Record<StaffStatus['kind'], number> = {
    in_appointment: 0,
    available: 1,
    no_schedule: 2,
  };
  const sorted = [...statuses].sort(
    (a, b) => ORDER[a.status.kind] - ORDER[b.status.kind],
  );

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">
        Barberos
        <span className="ml-1 font-normal text-gray-400">
          · {staffList.length} activo{staffList.length !== 1 ? 's' : ''}
        </span>
      </p>

      {staffList.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">Sin barberos registrados.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {sorted.map(({ staff, status }) => (
            <div
              key={staff.id}
              className={`rounded-full border px-3 py-1 text-xs ${chipClasses(status.kind)}`}
            >
              <span className="font-medium">{staff.name}</span>
              <span className="ml-1 opacity-75">· {statusLabel(status)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
