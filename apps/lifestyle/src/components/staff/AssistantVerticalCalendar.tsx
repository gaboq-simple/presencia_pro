// ─── AssistantVerticalCalendar ─────────────────────────────────────────────────
// Calendario VERTICAL de disponibilidad del dia (rediseño — trozo 1/5).
//
// Rotacion de AvailabilityTimeline (H → V):
//   Eje Y (scroll vertical): tiempo — etiquetas de hora en columna izquierda sticky.
//   Eje X (columnas): barberos — cabecera por barbero sticky arriba.
//   Bloques de cita: posicionados por top (inicio) + height (duracion) en su columna.
//   Overlays rotados: fuera-de-horario, staff_blocks (rayas), guias de hora horizontales.
//   Linea "ahora" HORIZONTAL: reusa nowLocalMinutes(timezone) (TZ-correcto), 60s, isToday.
//   Click-en-hueco: posicion VERTICAL del click → hora (redondeo a 15 min) → onSlotClick.
//
// ALCANCE trozo 1/5: solo geometria, paleta gris actual, mismos datos, sin interacciones
// nuevas (ni card de detalle, ni hover, ni drag, ni foco de barbero, ni tokens Zentriq).
//
// NOTA: los helpers de tiempo son un espejo de AvailabilityTimeline.tsx (:44-93). Son
// module-local (no exportados) alla, por eso se duplican aca. Extraerlos a un util
// compartido queda para un trozo posterior (implica tocar AvailabilityTimeline).

'use client';

import { useState, useEffect, useCallback } from 'react';
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

const HOUR_HEIGHT_PX  = 60;   // alto de cada hora en px (equivalente vertical a HOUR_WIDTH_PX)
const COL_MIN_WIDTH_PX = 200; // ancho minimo comodo por barbero antes de scroll horizontal
const TIME_COL_WIDTH_PX = 52; // ancho de la columna de horas (sticky izquierda)
const HEADER_HEIGHT_PX = 32;  // alto de la cabecera de nombres (sticky arriba)
const FALLBACK_START = 9;     // hora de apertura default si no hay datos
const FALLBACK_END   = 20;    // hora de cierre default si no hay datos

const PX_PER_MIN = HOUR_HEIGHT_PX / 60; // px por minuto (con 60px/h = 1px/min)

// ─── Helpers (espejo de AvailabilityTimeline.tsx :44-93) ──────────────────────

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

/** Verifica si la fecha dada es hoy segun el timezone */
function isToday(date: string, timezone: string): boolean {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    .format(new Date());
  return localDate === date;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantVerticalCalendar({
  appointments,
  staff,
  staffBlocks,
  date,
  timezone,
  onSlotClick,
}: Props) {
  // ── Hora actual (actualiza cada minuto) — mismo patron que AvailabilityTimeline ──
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

  // ── Rango de horas del dia (mismo calculo que AvailabilityTimeline :128-143) ──
  const hoursWithAvail = staff
    .map((s) => s.availabilityToday)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const startHour = hoursWithAvail.length > 0
    ? Math.min(...hoursWithAvail.map((a) => Math.floor(timeToMinutes(a.start_time) / 60)))
    : FALLBACK_START;

  const endHour = hoursWithAvail.length > 0
    ? Math.max(...hoursWithAvail.map((a) => Math.ceil(timeToMinutes(a.end_time) / 60)))
    : FALLBACK_END;

  const startMinutes = startHour * 60;
  const endMinutes   = endHour * 60;
  const totalMinutes = endMinutes - startMinutes;
  const totalHours   = endHour - startHour;
  const gridHeightPx = totalHours * HOUR_HEIGHT_PX;

  /** minutos-desde-medianoche → offset vertical en px dentro de la grilla */
  const minutesToPx = useCallback(
    (m: number) => (m - startMinutes) * PX_PER_MIN,
    [startMinutes],
  );

  // ── Click en hueco: calcular hora desde posicion Y (rotacion del click X→Y) ──
  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, staffId: string) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const clickedMinutes =
        startMinutes + Math.round((relY / gridHeightPx) * totalMinutes / 15) * 15;
      const clamped = Math.max(startMinutes, Math.min(endMinutes - 15, clickedMinutes));
      onSlotClick(staffId, minutesToTime(clamped));
    },
    [startMinutes, endMinutes, totalMinutes, gridHeightPx, onSlotClick],
  );

  if (staff.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center">
        <p className="text-xs text-gray-400">Sin barberos activos para mostrar.</p>
      </div>
    );
  }

  const nowTop = nowMinutes !== null ? minutesToPx(nowMinutes) : null;
  const showNow = nowTop !== null && nowTop >= 0 && nowTop <= gridHeightPx;

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white overflow-auto"
      style={{ maxHeight: '65vh', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {/* w-max + min-w-full: pocos barberos → columnas crecen y llenan; muchos → scroll-X */}
      <div className="flex w-max min-w-full">

        {/* ── Columna de horas (sticky izquierda) ────────────────────────── */}
        <div
          className="sticky left-0 z-30 shrink-0 bg-white border-r border-gray-100"
          style={{ width: TIME_COL_WIDTH_PX }}
        >
          {/* Esquina (sticky arriba tambien → queda fija en ambos ejes) */}
          <div
            className="sticky top-0 z-10 bg-gray-50 border-b border-gray-100"
            style={{ height: HEADER_HEIGHT_PX }}
          />
          {/* Etiquetas de hora */}
          <div className="relative" style={{ height: gridHeightPx }}>
            {Array.from({ length: totalHours }, (_, i) => (
              <span
                key={i}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums"
                style={{ top: i * HOUR_HEIGHT_PX }}
              >
                {String(startHour + i).padStart(2, '0')}:00
              </span>
            ))}
            {/* Punto rojo "ahora" sobre el eje de tiempo */}
            {showNow && (
              <div
                className="absolute right-0 w-2 h-2 rounded-full bg-red-500 -translate-y-1/2 pointer-events-none z-20"
                style={{ top: nowTop! }}
              />
            )}
          </div>
        </div>

        {/* ── Columnas por barbero ───────────────────────────────────────── */}
        {staff.map((s) => {
          const avail = s.availabilityToday;
          const availStart = avail ? timeToMinutes(avail.start_time) : null;
          const availEnd   = avail ? timeToMinutes(avail.end_time)   : null;

          const barberAppts = appointments.filter(
            (a) => a.staff.id === s.id && a.status !== 'cancelled',
          );
          const barberBlocks = staffBlocks.filter((b) => b.staffId === s.id);

          return (
            <div
              key={s.id}
              className="flex flex-col border-r border-gray-50 last:border-r-0"
              style={{ flex: '1 0 auto', minWidth: COL_MIN_WIDTH_PX }}
            >
              {/* Cabecera de barbero (sticky arriba) */}
              <div
                className="sticky top-0 z-20 flex items-center border-b border-gray-100 bg-gray-50 px-2"
                style={{ height: HEADER_HEIGHT_PX }}
              >
                <span className="truncate text-xs font-medium text-gray-700" title={s.name}>
                  {s.name}
                </span>
              </div>

              {/* Cuerpo de la columna (clickable → nueva cita) */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Seleccionar slot para ${s.name}`}
                className="relative cursor-pointer"
                style={{ height: gridHeightPx }}
                onClick={(e) => handleColumnClick(e, s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSlotClick(s.id, minutesToTime(startMinutes + Math.floor(totalMinutes / 2)));
                  }
                }}
              >
                {/* Guias de hora (horizontales) */}
                {Array.from({ length: totalHours }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: i * HOUR_HEIGHT_PX }}
                  />
                ))}

                {/* Overlay: fuera de horario (antes del inicio) */}
                {availStart !== null && availStart > startMinutes && (
                  <div
                    className="absolute left-0 right-0 bg-gray-100/70"
                    style={{ top: 0, height: minutesToPx(availStart) }}
                  />
                )}

                {/* Overlay: fuera de horario (despues del cierre) */}
                {availEnd !== null && availEnd < endMinutes && (
                  <div
                    className="absolute left-0 right-0 bg-gray-100/70"
                    style={{ top: minutesToPx(availEnd), bottom: 0 }}
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
                  const top    = minutesToPx(Math.max(bStart, startMinutes));
                  const bottom = minutesToPx(Math.min(bEnd,   endMinutes));
                  const height = Math.max(0, bottom - top);
                  if (height <= 0) return null;
                  return (
                    <div
                      key={idx}
                      className="absolute left-1 right-1 rounded"
                      style={{
                        top,
                        height,
                        background:
                          'repeating-linear-gradient(45deg,#d1d5db,#d1d5db 3px,#e5e7eb 3px,#e5e7eb 8px)',
                      }}
                    />
                  );
                })}

                {/* Bloques de citas */}
                {barberAppts.map((appt) => {
                  const apptStart = isoToLocalMinutes(appt.starts_at, timezone);
                  const apptEnd   = isoToLocalMinutes(appt.ends_at,   timezone);
                  const top       = minutesToPx(Math.max(apptStart, startMinutes));
                  const bottom    = minutesToPx(Math.min(apptEnd,   endMinutes));
                  const height    = Math.max(0, bottom - top);
                  if (height <= 0) return null;
                  const label = appt.customer?.name ?? appt.service.name;
                  return (
                    <div
                      key={appt.id}
                      className="absolute left-1 right-1 rounded bg-gray-800 px-1 overflow-hidden"
                      style={{ top, height }}
                      onClick={(e) => e.stopPropagation()}
                      title={`${label} · ${appt.service.name}`}
                    >
                      {height >= 20 && (
                        <span className="block truncate pt-0.5 text-[10px] font-medium text-white leading-tight">
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Linea "ahora" (horizontal, roja) */}
                {showNow && (
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-red-500 opacity-80 pointer-events-none z-10"
                    style={{ top: nowTop! }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
