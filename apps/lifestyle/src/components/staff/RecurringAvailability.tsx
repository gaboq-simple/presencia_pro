// ─── RecurringAvailability ────────────────────────────────────────────────────
// Componente de display puro — sin 'use client', sin estado, sin efectos.
// Muestra la disponibilidad recurrente del barbero por día de semana.
// Solo lectura — modificaciones las gestiona el admin.

import type { StaffAvailabilitySlot } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  availability: StaffAvailabilitySlot[];
};

// ─── Config de días ───────────────────────────────────────────────────────────

const DAYS: { index: number; short: string; label: string }[] = [
  { index: 1, short: 'Lun', label: 'Lunes' },
  { index: 2, short: 'Mar', label: 'Martes' },
  { index: 3, short: 'Mié', label: 'Miércoles' },
  { index: 4, short: 'Jue', label: 'Jueves' },
  { index: 5, short: 'Vie', label: 'Viernes' },
  { index: 6, short: 'Sáb', label: 'Sábado' },
  { index: 0, short: 'Dom', label: 'Domingo' },
];

// ─── Helper: 'HH:MM:SS' → 'HH:MM' ───────────────────────────────────────────

function trimSeconds(time: string): string {
  return time.slice(0, 5);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RecurringAvailability({ availability }: Props) {
  const slotByDay = new Map<number, StaffAvailabilitySlot>(
    availability.map((s) => [s.day_of_week, s]),
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">Horario semanal</p>
      </div>

      <div className="space-y-1.5">
        {DAYS.map(({ index, short, label }) => {
          const slot = slotByDay.get(index);

          return (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
              aria-label={label}
            >
              <span className="w-8 text-xs font-semibold text-gray-500">
                {short}
              </span>
              {slot ? (
                <div className="text-right">
                  <span className="text-xs tabular-nums text-gray-800">
                    {trimSeconds(slot.start_time)} – {trimSeconds(slot.end_time)}
                  </span>
                  {slot.break_start && slot.break_end && (
                    <p className="mt-0.5 text-[10px] tabular-nums text-gray-400">
                      Descanso: {trimSeconds(slot.break_start)} – {trimSeconds(slot.break_end)}
                    </p>
                  )}
                </div>
              ) : (
                <span className="text-xs text-gray-300">Descanso</span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Para modificar tu horario fijo, habla con el administrador.
      </p>
    </div>
  );
}
