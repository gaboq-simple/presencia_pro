// ─── BarberWeekView ───────────────────────────────────────────────────────────
// Vista semanal del barbero — 7 días compactos + citas del día seleccionado.
// Cableado al sistema Zentriq claro (tokens de marca).
//
// Diseño:
//   · Fila de 7 pills (Lun–Dom) con conteo de citas por día.
//   · Hoy marcado con anillo teal; día seleccionado en teal-ink relleno.
//   · Clic en un día → muestra sus citas abajo (lectura, sin botones de acción).
//   · Carga lazy al primer render (Server Action getBarberWeekAppointments).

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
  pending:   'bg-tint-1 text-teal-ink',
  confirmed: 'bg-tint-1 text-teal-ink',
  walkin:    'bg-tint-1 text-teal-ink',
  completed: 'bg-[#E6E9E9] text-past-ink',
  no_show:   'bg-red-tint text-red-ink',
  cancelled: 'bg-past-bg text-past-faint',
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
      className={`flex flex-1 flex-col items-center rounded-md py-2 transition-colors ${
        isSelected
          ? 'bg-teal-ink text-card'
          : 'bg-tint-1 text-ink-2 hover:bg-tint-2'
      }`}
    >
      <span className={`text-[10px] font-medium ${isSelected ? 'text-tint-2' : 'text-faint'}`}>
        {abbrev}
      </span>
      <span
        className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
          isToday && !isSelected ? 'ring-2 ring-teal ring-offset-1' : ''
        }`}
      >
        {num}
      </span>
      {count > 0 ? (
        <span
          className={`mt-1 rounded-pill px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${
            isSelected ? 'bg-white/25 text-card' : 'bg-tint-2 text-teal-ink'
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

  const [weekData, setWeekData] = useState<Record<string, DayAppointmentForStaff[]>>(() => {
    const initial: Record<string, DayAppointmentForStaff[]> = {};
    for (const d of weekDates) initial[d] = [];
    initial[anchorDate] = todayAppointments;
    return initial;
  });

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const defaultSelected = weekDates.includes(today) ? today : anchorDate;
  const [selected, setSelected] = useState(defaultSelected);

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
      <p className="px-0.5 text-xs font-semibold capitalize text-ink-2 tabular-nums">{weekLabel}</p>

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
          <div className="space-y-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-r-[12px] border border-l-[3px] border-line border-l-line-2 bg-card px-3 py-2.5 motion-safe:animate-pulse"
              >
                <div className="h-3 w-9 rounded bg-tint-2" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 rounded bg-tint-2" />
                  <div className="h-2.5 w-1/3 rounded bg-tint-1" />
                </div>
                <div className="h-4 w-12 rounded-pill bg-tint-2" />
              </div>
            ))}
            <span className="sr-only">Cargando semana…</span>
          </div>
        )}

        {error && !loading && (
          <p className="py-2 text-center text-xs text-red-ink">{error}</p>
        )}

        {!loading && !error && selectedAppts.length === 0 && (
          <div className="rounded-r-card border border-l-[3px] border-line border-l-line-2 py-6 text-center">
            <p className="text-sm text-ink-2">Sin citas este día</p>
          </div>
        )}

        {!loading && selectedAppts.map((appt) => {
          const badgeClass = STATUS_BADGE[appt.status] ?? 'bg-tint-1 text-teal-ink';

          return (
            <div
              key={appt.id}
              className="flex items-start gap-2 rounded-r-[12px] border border-l-[3px] border-line border-l-teal-border bg-card px-3 py-2"
            >
              {/* Hora */}
              <p className="shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-ink-2">
                {formatTime(appt.starts_at)}
              </p>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{appt.service.name}</p>
                {appt.customer && (
                  <p className="truncate text-xs text-faint">{appt.customer.name}</p>
                )}
              </div>

              {/* Badge */}
              <span className={`shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
                {STATUS_LABEL[appt.status] ?? appt.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
