// ─── AvailabilityTimeline ──────────────────────────────────────────────────────
// Vista tipo grilla horizontal de disponibilidad del dia.
//
// Eje Y (filas): barberos activos.
// Eje X (columnas): horas del dia (rango derivado de los horarios del negocio).
// Bloques: citas ocupadas (oscuro), staff_blocks aprobados (gris rayado),
//          fuera de horario (overlay gris claro).
// Linea roja vertical: hora actual (actualiza cada minuto).
// Huecos clickeables: abren NewAppointmentForm con hora y barbero pre-llenados.
//
// Mobile-first: scroll horizontal, columna de nombres sticky a la izquierda.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type { StaffBlockForDay } from '@/app/staff/assistant-actions';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type StaffWithAvailability = {
  id: string;
  name: string;
  availabilityToday: { start_time: string; end_time: string } | null;
};

type Props = {
  appointments: DashboardAppointment[];
  staff: StaffWithAvailability[];
  staffBlocks: StaffBlockForDay[];
  date: string;         // 'YYYY-MM-DD'
  timezone: string;     // IANA — p.ej. 'America/Mexico_City'
  onSlotClick: (staffId: string, time: string) => void;
};

// ─── Config visual ────────────────────────────────────────────────────────────

const HOUR_WIDTH_PX = 60;   // ancho de cada hora en px
const ROW_HEIGHT_PX = 44;   // altura de cada fila de barbero
const NAME_WIDTH_PX = 80;   // ancho de la columna de nombres (sticky)
const FALLBACK_START = 9;   // hora de apertura default si no hay datos
const FALLBACK_END   = 20;  // hora de cierre default si no hay datos

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte 'HH:MM' o 'HH:MM:SS' a minutos desde medianoche */
function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** Convierte ISO a minutos desde medianoche en el timezone dado */
function isoToLocalMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));

  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  // Intl puede devolver hora 24 como "24" — normalizar
  return (h === 24 ? 0 : h) * 60 + m;
}

/** Hora actual en minutos desde medianoche segun el timezone del negocio */
function nowLocalMinutes(timezone: string): number {
  return isoToLocalMinutes(new Date().toISOString(), timezone);
}

/** 'HH:MM' a partir de minutos desde medianoche */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Posicion y ancho como porcentaje dentro del rango total */
function toPercent(
  valueMinutes: number,
  startMinutes: number,
  totalMinutes: number,
): number {
  return ((valueMinutes - startMinutes) / totalMinutes) * 100;
}

/** Verifica si la fecha dada es hoy segun el timezone */
function isToday(date: string, timezone: string): boolean {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    .format(new Date());
  return localDate === date;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AvailabilityTimeline({
  appointments,
  staff,
  staffBlocks,
  date,
  timezone,
  onSlotClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Hora actual (actualiza cada minuto) ──────────────────────────────────
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [prevDateTz, setPrevDateTz] = useState(`${date}|${timezone}`);
  const dateTz = `${date}|${timezone}`;
  if (prevDateTz !== dateTz) {
    setPrevDateTz(dateTz);
    if (!isToday(date, timezone)) {
      setNowMinutes(null);
    }
  }

  useEffect(() => {
    if (!isToday(date, timezone)) return;
    const update = () => setNowMinutes(nowLocalMinutes(timezone));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [date, timezone]);

  // ── Rango de horas del dia ────────────────────────────────────────────────
  // Derivar del min start_time y max end_time de todos los barberos con horario
  const hoursWithAvail = staff
    .map((s) => s.availabilityToday)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const startHour = hoursWithAvail.length > 0
    ? Math.min(...hoursWithAvail.map((a) => Math.floor(timeToMinutes(a.start_time) / 60)))
    : FALLBACK_START;

  const endHour = hoursWithAvail.length > 0
    ? Math.max(...hoursWithAvail.map((a) => Math.ceil(timeToMinutes(a.end_time) / 60)))
    : FALLBACK_END;

  const startMinutes  = startHour * 60;
  const endMinutes    = endHour   * 60;
  const totalMinutes  = endMinutes - startMinutes;
  const totalHours    = endHour - startHour;
  const gridWidthPx   = totalHours * HOUR_WIDTH_PX;

  // ── Click en hueco: calcular hora desde posicion X ────────────────────────
  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, staffId: string) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const clickedMinutes = startMinutes + Math.round((relX / gridWidthPx) * totalMinutes / 15) * 15;
      const clamped = Math.max(startMinutes, Math.min(endMinutes - 15, clickedMinutes));
      onSlotClick(staffId, minutesToTime(clamped));
    },
    [startMinutes, endMinutes, totalMinutes, gridWidthPx, onSlotClick],
  );

  if (staff.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center">
        <p className="text-xs text-gray-400">Sin barberos activos para mostrar.</p>
      </div>
    );
  }

  // ── Renderizado ──────────────────────────────────────────────────────────
  const nowPct = nowMinutes !== null
    ? toPercent(nowMinutes, startMinutes, totalMinutes)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex">

        {/* ── Columna de nombres (sticky) ──────────────────────────────── */}
        <div
          className="shrink-0 border-r border-gray-100 bg-white z-10"
          style={{ width: NAME_WIDTH_PX }}
        >
          {/* Espacio del header de horas */}
          <div
            className="border-b border-gray-100 bg-gray-50"
            style={{ height: 24 }}
          />
          {/* Filas de nombres */}
          {staff.map((s) => (
            <div
              key={s.id}
              className="flex items-center border-b border-gray-50 px-2 last:border-b-0"
              style={{ height: ROW_HEIGHT_PX }}
            >
              <span
                className="truncate text-xs font-medium text-gray-700"
                title={s.name}
              >
                {s.name}
              </span>
            </div>
          ))}
        </div>

        {/* ── Zona scrollable ───────────────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <div style={{ width: gridWidthPx, minWidth: gridWidthPx, position: 'relative' }}>

            {/* ── Header de horas ──────────────────────────────────────── */}
            <div
              className="flex border-b border-gray-100 bg-gray-50"
              style={{ height: 24 }}
            >
              {Array.from({ length: totalHours }, (_, i) => (
                <div
                  key={i}
                  className="shrink-0 border-r border-gray-100 flex items-center pl-1"
                  style={{ width: HOUR_WIDTH_PX }}
                >
                  <span className="text-[10px] text-gray-400 tabular-nums">
                    {String(startHour + i).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {/* ── Filas por barbero ────────────────────────────────────── */}
            {staff.map((s) => {
              const avail = s.availabilityToday;
              const availStart = avail ? timeToMinutes(avail.start_time) : null;
              const availEnd   = avail ? timeToMinutes(avail.end_time)   : null;

              // Citas de este barbero en el dia actual
              const barberAppts = appointments.filter(
                (a) =>
                  a.staff.id === s.id &&
                  a.status !== 'cancelled',
              );

              // Bloques de este barbero
              const barberBlocks = staffBlocks.filter((b) => b.staffId === s.id);

              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Seleccionar slot para ${s.name}`}
                  className="relative border-b border-gray-50 last:border-b-0 cursor-pointer"
                  style={{ height: ROW_HEIGHT_PX, width: gridWidthPx }}
                  onClick={(e) => handleRowClick(e, s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSlotClick(s.id, minutesToTime(startMinutes + Math.floor(totalMinutes / 2)));
                    }
                  }}
                >
                  {/* Guias verticales por hora */}
                  {Array.from({ length: totalHours }, (_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-r border-gray-100"
                      style={{ left: i * HOUR_WIDTH_PX }}
                    />
                  ))}

                  {/* Overlay: fuera de horario (antes del inicio) */}
                  {availStart !== null && availStart > startMinutes && (
                    <div
                      className="absolute top-0 bottom-0 bg-gray-100/70"
                      style={{
                        left: 0,
                        width: `${toPercent(availStart, startMinutes, totalMinutes)}%`,
                      }}
                    />
                  )}

                  {/* Overlay: fuera de horario (despues del cierre) */}
                  {availEnd !== null && availEnd < endMinutes && (
                    <div
                      className="absolute top-0 bottom-0 bg-gray-100/70"
                      style={{
                        left: `${toPercent(availEnd, startMinutes, totalMinutes)}%`,
                        right: 0,
                      }}
                    />
                  )}

                  {/* Overlay: sin horario configurado (todo el dia inactivo) */}
                  {avail === null && (
                    <div className="absolute inset-0 bg-gray-100/70" />
                  )}

                  {/* Bloques de staff_blocks (rayas — aprobados) */}
                  {barberBlocks.map((block, idx) => {
                    const bStart = isoToLocalMinutes(block.startsAt, timezone);
                    const bEnd   = isoToLocalMinutes(block.endsAt,   timezone);
                    const left   = toPercent(Math.max(bStart, startMinutes), startMinutes, totalMinutes);
                    const right  = toPercent(Math.min(bEnd,   endMinutes),   startMinutes, totalMinutes);
                    const width  = Math.max(0, right - left);
                    if (width <= 0) return null;
                    return (
                      <div
                        key={idx}
                        className="absolute top-1 bottom-1 rounded"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: 'repeating-linear-gradient(45deg,#d1d5db,#d1d5db 3px,#e5e7eb 3px,#e5e7eb 8px)',
                        }}
                      />
                    );
                  })}

                  {/* Bloques de citas */}
                  {barberAppts.map((appt) => {
                    const apptStart  = isoToLocalMinutes(appt.starts_at, timezone);
                    const apptEnd    = isoToLocalMinutes(appt.ends_at,   timezone);
                    const left       = toPercent(Math.max(apptStart, startMinutes), startMinutes, totalMinutes);
                    const right      = toPercent(Math.min(apptEnd,   endMinutes),   startMinutes, totalMinutes);
                    const widthPct   = Math.max(0, right - left);
                    if (widthPct <= 0) return null;
                    const widthPx    = (widthPct / 100) * gridWidthPx;
                    const label      = appt.customer?.name ?? appt.service.name;
                    return (
                      <div
                        key={appt.id}
                        className="absolute top-1 bottom-1 rounded bg-gray-800 px-1 flex items-center overflow-hidden"
                        style={{ left: `${left}%`, width: `${widthPct}%` }}
                        onClick={(e) => e.stopPropagation()}
                        title={`${label} · ${appt.service.name}`}
                      >
                        {widthPx >= 32 && (
                          <span className="truncate text-[10px] font-medium text-white leading-tight">
                            {label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* ── Linea "ahora" (vertical, roja) ───────────────────────── */}
            {nowPct !== null && nowPct >= 0 && nowPct <= 100 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{ left: `${nowPct}%`, top: 24 }}
              >
                <div className="absolute inset-0 w-0.5 bg-red-500 opacity-80" />
                <div
                  className="absolute -top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500"
                  style={{ left: 1 }}
                />
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
