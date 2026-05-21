// ─── BarberWeekView ───────────────────────────────────────────────────────────
// Vista semanal del barbero — 7 días compactos + citas del día seleccionado.
//
// Diseño:
//   · Fila de 7 pills (Lun–Dom) con conteo de citas por día.
//   · Hoy marcado con anillo y texto en negrita.
//   · Clic en un día → muestra sus citas abajo (lectura, sin botones de acción).
//   · Carga lazy al primer render (Server Action getBarberWeekAppointments).
//
// El estado de carga / error se maneja localmente.
// Las citas de la semana se cargan una sola vez por semana.

'use client';

import { useState, useEffect } from 'react';
import type { DayAppointmentForStaff } from '@/lib/dashboard.types';
import { getBarberWeekAppointments } from '@/app/staff/actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  /** Fecha actual del dashboard (día ancla para calcular la semana). */
  anchorDate: string;      // 'YYYY-MM-DD'
  /** Citas ya cargadas para anchorDate — evita fetch duplicado para ese día. */
  todayAppointments: DayAppointmentForStaff[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_ABBREV = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

function getWeekDates(anchorDate: string): string[] {
  const anchor = new Date(`${anchorDate}T12:00:00`);
  const day = anchor.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDayLabel(dateStr: string): { abbrev: string; num: number; mon: string } {
  const d = new Date(`${dateStr}T12:00:00`);
  return {
    abbrev: DAY_ABBREV[d.getDay()] ?? '',
    num:    d.getDate(),
    mon:    MONTH_SHORT[d.getMonth()] ?? '',
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
  no_show:   'bg-red-100 text-red-700',
  walkin:    'bg-purple-100 text-purple-700',
};

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pend.',
  confirmed: 'Conf.',
  completed: 'Comp.',
  cancelled: 'Cancel.',
  no_show:   'N/A',
  walkin:    'Walk-in',
};

// ─── Subcomponente: pill de un día ────────────────────────────────────────────

function DayPill({
  dateStr,
  count,
  isSelected,
  isToday,
  onClick,
}: {
  dateStr: string;
  count: number;
  isSelected: boolean;
  isToday: boolean;
  onClick: () => void;
}) {
  const { abbrev, num } = formatDayLabel(dateStr);

  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center rounded-xl py-2 transition-colors ${
        isSelected
          ? 'bg-gray-900 text-white'
          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
      }`}
    >
      <span className={`text-[10px] font-medium ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
        {abbrev}
      </span>
      <span
        className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
          isToday && !isSelected
            ? 'ring-2 ring-gray-900 ring-offset-1'
            : ''
        }`}
      >
        {num}
      </span>
      {count > 0 ? (
        <span
          className={`mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
            isSelected ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'
          }`}
        >
          {count}
        </span>
      ) : (
        <span className="mt-1 h-4" aria-hidden="true" />
      )}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BarberWeekView({ anchorDate, todayAppointments }: Props) {
  const today = todayStr();
  const weekDates = getWeekDates(anchorDate);

  // Inicializar weekData con las citas de hoy que ya están disponibles
  const [weekData, setWeekData] = useState<Record<string, DayAppointmentForStaff[]>>(() => {
    const initial: Record<string, DayAppointmentForStaff[]> = {};
    for (const d of weekDates) initial[d] = [];
    // Prellenar el día ancla con los datos ya disponibles
    initial[anchorDate] = todayAppointments;
    return initial;
  });

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Día seleccionado — default: hoy si está en la semana, si no anchorDate
  const defaultSelected = weekDates.includes(today) ? today : anchorDate;
  const [selected, setSelected] = useState(defaultSelected);

  // Cargar datos de la semana completa (una sola vez)
  useEffect(() => {
    void (async () => {
      try {
        const data = await getBarberWeekAppointments(anchorDate);
        setWeekData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar la semana');
      } finally {
        setLoading(false);
      }
    })();
   
  }, [anchorDate]);

  const selectedAppts = weekData[selected] ?? [];

  // Formato del rango de la semana para el encabezado
  const first = weekDates[0];
  const last  = weekDates[6];
  const { num: firstNum, mon: firstMon } = first ? formatDayLabel(first) : { num: 0, mon: '' };
  const { num: lastNum,  mon: lastMon  } = last  ? formatDayLabel(last)  : { num: 0, mon: '' };
  const weekLabel =
    firstMon === lastMon
      ? `${firstNum}–${lastNum} ${firstMon}`
      : `${firstNum} ${firstMon} – ${lastNum} ${lastMon}`;

  return (
    <div className="space-y-3">
      {/* Encabezado de la semana */}
      <p className="px-0.5 text-xs font-medium text-gray-500 capitalize">{weekLabel}</p>

      {/* Fila de pills */}
      <div className="flex gap-1">
        {weekDates.map((dateStr) => (
          <DayPill
            key={dateStr}
            dateStr={dateStr}
            count={(weekData[dateStr] ?? []).length}
            isSelected={selected === dateStr}
            isToday={dateStr === today}
            onClick={() => setSelected(dateStr)}
          />
        ))}
      </div>

      {/* Citas del día seleccionado */}
      <div className="space-y-1.5">
        {loading && (
          <p className="py-4 text-center text-xs text-gray-400">Cargando semana…</p>
        )}

        {error && !loading && (
          <p className="py-2 text-center text-xs text-red-500">{error}</p>
        )}

        {!loading && !error && selectedAppts.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
            <p className="text-sm text-gray-400">Sin citas este día</p>
          </div>
        )}

        {!loading && selectedAppts.map((appt) => {
          const badgeClass = STATUS_BADGE[appt.status] ?? 'bg-gray-100 text-gray-500';

          return (
            <div
              key={appt.id}
              className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2"
            >
              {/* Hora */}
              <p className="shrink-0 text-xs font-semibold tabular-nums text-gray-600 pt-0.5">
                {formatTime(appt.starts_at)}
              </p>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {appt.service.name}
                </p>
                {appt.customer && (
                  <p className="truncate text-xs text-gray-400">{appt.customer.name}</p>
                )}
              </div>

              {/* Badge */}
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badgeClass}`}>
                {STATUS_LABEL[appt.status] ?? appt.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
