// ─── EndOfDaySummary ──────────────────────────────────────────────────────────
// Resumen de fin de día para el barbero.
// Se muestra solo cuando:
//   · El día visualizado es hoy, Y
//   · Todas las citas tienen status completado/no_show/cancelado (nada pendiente/confirmado/walkin)
//     O el array de citas está vacío (día sin citas — no mostrar resumen).
//
// Cálculos en memoria sobre el array de citas recibido — sin queries adicionales.

'use client';

import type { DayAppointmentForStaff } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DayAppointmentForStaff[];
  date: string;   // 'YYYY-MM-DD' que se está visualizando
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'no_show', 'cancelled']);
const ACTIVE_STATUSES   = new Set(['pending', 'confirmed', 'walkin']);

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EndOfDaySummary({ appointments, date }: Props) {
  // Solo visible para el día de hoy
  if (!isToday(date)) return null;

  // Sin citas = nada que mostrar
  if (appointments.length === 0) return null;

  // Hay citas pendientes/activas = no es fin de día aún
  const hasActive = appointments.some((a) => ACTIVE_STATUSES.has(a.status));
  if (hasActive) return null;

  // Todos en estado terminal — calcular resumen
  const completedAppts = appointments.filter((a) => a.status === 'completed');
  const noShowCount    = appointments.filter((a) => a.status === 'no_show').length;
  const revenue        = completedAppts.reduce((sum, a) => sum + (a.service.price ?? 0), 0);
  const completedCount = completedAppts.length;

  const allTerminal = appointments.every((a) => TERMINAL_STATUSES.has(a.status));
  if (!allTerminal) return null;

  // Mensaje motivacional
  const message = noShowCount === 0
    ? 'Buen dia!'
    : 'Dia completo.';

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-green-800">{message}</p>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          Fin del dia
        </span>
      </div>

      {/* Resumen compacto */}
      <p className="mt-1 text-xs text-green-700">
        Tu dia:{' '}
        <span className="font-semibold">{completedCount}</span>{' '}
        {completedCount === 1 ? 'cita completada' : 'citas completadas'}
        {noShowCount > 0 && (
          <>, <span className="font-semibold">{noShowCount}</span> no-show</>
        )}
        {revenue > 0 && (
          <>, <span className="font-semibold">{formatCurrency(revenue)}</span> en servicios</>
        )}
      </p>

      {/* Detalle en pills */}
      <div className="mt-3 flex gap-2">
        <Pill value={completedCount} label="completadas" color="text-green-700" bg="bg-green-100" />
        {noShowCount > 0 && (
          <Pill value={noShowCount} label="no-show" color="text-red-600" bg="bg-red-50" />
        )}
        {revenue > 0 && (
          <div className="flex-1 rounded px-2 py-1.5 bg-white border border-green-200">
            <p className="text-sm font-semibold text-green-800">{formatCurrency(revenue)}</p>
            <p className="text-xs text-gray-400">en servicios</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({
  value,
  label,
  color,
  bg,
}: {
  value: number;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={`flex-1 rounded px-2 py-1.5 ${bg}`}>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
