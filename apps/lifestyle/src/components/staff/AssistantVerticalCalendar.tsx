// ─── AssistantVerticalCalendar ─────────────────────────────────────────────────
// Calendario VERTICAL de día completo de la mesa de control del asistente.
//
// Reemplaza el panorama horizontal de 3h (PanoramaTimeline) por un calendario de
// día completo: barberos en COLUMNAS, tiempo en el eje Y con scroll vertical natural.
// Al montar hace auto-scroll para dejar "ahora" visible (arranca en el presente,
// pero sin limitar a 3h — el asistente puede scrollear a todo el día).
//
// Se pliega al contenedor (AssistantControlDesk): recibe la MISMA data que hoy
// recibe PanoramaTimeline (appointments, staff=PanoramaStaff, staffBlocks, date,
// timezone) y el callback de creación onTapFreeSlot(staffId, startMin).
//
// ALCANCE (Paso 1): geometría vertical + tokens Zentriq + auto-scroll + línea-ahora
// + click-en-hueco. Estilo de bloque Zentriq con tono mínimo por estado (completed
// atenuado, no_show / walk-in distinguibles) para NO regresar respecto al panorama.
// PENDIENTE de pasos siguientes: diferenciación fina de los 6 estados (curso/late/
// pending), card de detalle, drag / click-to-place / walk-in de un toque, "banda
// sutil" del ahora, foco de barbero, descansos (break_start/end), y el retiro final
// de PanoramaTimeline. Los callbacks de interacción que aún no honramos se aceptan
// inertes (ver más abajo) para no romper el montaje.
//
// NOTA: los helpers de tiempo son un espejo de PanoramaTimeline/AvailabilityTimeline
// (module-local, no exportados). Extraerlos a un util compartido es de un paso posterior.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type {
  PanoramaStaff,
  PanoramaBlock,
  MoveState,
  WalkinRequest,
  RescheduleRequest,
  PlaceOpts,
} from './PanoramaTimeline';

// ─── Props ────────────────────────────────────────────────────────────────────
// Mismo contrato de data que PanoramaTimeline (el desk lo monta con las mismas
// props). Los callbacks de gesto que el vertical aún NO implementa se aceptan como
// opcionales e inertes (Paso 1) para no romper el montaje detrás del flag.

type Props = {
  date: string;                 // 'YYYY-MM-DD' del día mostrado
  timezone: string;             // IANA — p.ej. 'America/Mexico_City'
  appointments: DashboardAppointment[];
  staff: PanoramaStaff[];       // barberos (columnas), en orden
  staffBlocks: PanoramaBlock[]; // bloqueos aprobados del día
  // Click-en-hueco → crear cita: el desk abre la hoja de walk-in pre-apuntada.
  onTapFreeSlot?: (staffId: string, startMin: number) => void;
  // ── Inertes en Paso 1 (drag / click-to-place / walk-in de un toque = pasos sig.) ──
  onPlace?: (move: MoveState, newStaffId: string, newStartMin: number, opts?: PlaceOpts) => void;
  walkinRequest?: WalkinRequest | null;
  onWalkinConsumed?: () => void;
  rescheduleRequest?: RescheduleRequest | null;
  onRescheduleConsumed?: () => void;
  highlightApptId?: string | null;
  onInteractingChange?: (active: boolean) => void;
};

// ─── Config visual ────────────────────────────────────────────────────────────

const HOUR_HEIGHT_PX   = 60;   // alto de cada hora en px
const COL_MIN_WIDTH_PX = 200;  // ancho mínimo cómodo por barbero antes de scroll-X
const TIME_COL_WIDTH_PX = 52;  // ancho de la columna de horas (sticky izquierda)
const HEADER_HEIGHT_PX = 40;   // alto de la cabecera de nombres (sticky arriba)
const FALLBACK_START = 9;      // hora de apertura default si no hay datos
const FALLBACK_END   = 20;     // hora de cierre default si no hay datos

const PX_PER_MIN = HOUR_HEIGHT_PX / 60; // 60px/h = 1px/min

// Tono Zentriq por estado (Paso 1: base + mínimo para no regresar). El set fino de
// 6 estados (curso/late/pending distinguidos) es del Paso 2. Espejo del STATE_STYLE
// de PanoramaTimeline, sin los estados derivados del tiempo.
type BlockTone = 'conf' | 'done' | 'noshow' | 'walk';
const TONE: Record<BlockTone, { bar: string; bg: string; ink: string }> = {
  conf:   { bar: 'var(--color-ink-2)',       bg: 'bg-card',     ink: 'text-ink' },
  done:   { bar: 'var(--color-past-line)',   bg: 'bg-past-bg',  ink: 'text-past-ink' },
  noshow: { bar: 'var(--color-red-border)',  bg: 'bg-red-tint', ink: 'text-red-ink' },
  walk:   { bar: 'var(--color-walk-border)', bg: 'bg-walk-tint', ink: 'text-walk' },
};
function toneFor(a: DashboardAppointment): BlockTone {
  if (a.status === 'completed') return 'done';
  if (a.status === 'no_show') return 'noshow';
  if (a.status === 'walkin' || a.source === 'walkin') return 'walk';
  return 'conf';
}

// ─── Helpers de tiempo (espejo de PanoramaTimeline/AvailabilityTimeline) ──────

/** 'HH:MM[:SS]' → minutos desde medianoche */
function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** ISO → minutos desde medianoche en el timezone dado */
function isoToLocalMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return (h === 24 ? 0 : h) * 60 + m;
}

/** Hora actual en minutos desde medianoche según el timezone del negocio */
function nowLocalMinutes(timezone: string): number {
  return isoToLocalMinutes(new Date().toISOString(), timezone);
}

/** minutos desde medianoche → 'HH:MM' 24h */
function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ¿la fecha dada es hoy según el timezone? */
function isToday(date: string, timezone: string): boolean {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) === date;
}

/** iniciales para el avatar del barbero */
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantVerticalCalendar({
  date,
  timezone,
  appointments,
  staff,
  staffBlocks,
  onTapFreeSlot,
  walkinRequest,
  onWalkinConsumed,
  rescheduleRequest,
  onRescheduleConsumed,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef<string | null>(null);

  // ── Solicitudes de gesto que el vertical aún NO honra (Paso 1): las acusamos y
  //    limpiamos de inmediato para no dejar al desk en un estado colgado (p.ej. el
  //    botón "+ Walk-in" deshabilitado para siempre). El gesto real llega después.
  useEffect(() => {
    if (walkinRequest) onWalkinConsumed?.();
  }, [walkinRequest, onWalkinConsumed]);
  useEffect(() => {
    if (rescheduleRequest) onRescheduleConsumed?.();
  }, [rescheduleRequest, onRescheduleConsumed]);

  // ── Hora actual (poll 60s) — mismo patrón TZ-aware que el panorama ──
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [prevDateTz, setPrevDateTz] = useState(`${date}|${timezone}`);
  const dateTz = `${date}|${timezone}`;
  if (prevDateTz !== dateTz) {
    setPrevDateTz(dateTz);
    if (!isToday(date, timezone)) setNowMinutes(null);
  }
  useEffect(() => {
    if (!isToday(date, timezone)) return;
    const update = () => setNowMinutes(nowLocalMinutes(timezone));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [date, timezone]);

  // ── Rango de horas del día (min start / max end de barberos con turno) ──
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

  const minutesToPx = useCallback(
    (m: number) => (m - startMinutes) * PX_PER_MIN,
    [startMinutes],
  );

  // ── Auto-scroll: dejar "ahora" visible al montar / cambiar de día ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didAutoScrollRef.current === dateTz) return;
    didAutoScrollRef.current = dateTz;
    if (!isToday(date, timezone)) { el.scrollTop = 0; return; }
    const nowTop = (nowLocalMinutes(timezone) - startMinutes) * PX_PER_MIN;
    // "ahora" a ~1/3 desde arriba (contexto previo visible), clamp a [0, max].
    el.scrollTop = Math.max(0, HEADER_HEIGHT_PX + nowTop - el.clientHeight / 3);
  }, [dateTz, date, timezone, startMinutes, gridHeightPx]);

  // ── Click en hueco: posición Y → hora (redondeo a 15 min) → onTapFreeSlot ──
  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, staffId: string) => {
      if (!onTapFreeSlot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const clickedMin = startMinutes + Math.round((relY / gridHeightPx) * totalMinutes / 15) * 15;
      const clamped = Math.max(startMinutes, Math.min(endMinutes - 15, clickedMin));
      onTapFreeSlot(staffId, clamped);
    },
    [onTapFreeSlot, startMinutes, endMinutes, totalMinutes, gridHeightPx],
  );

  if (staff.length === 0) {
    return (
      <div className="m-3 rounded-card border border-dashed border-line px-4 py-6 text-center">
        <p className="text-xs text-faint">Sin barberos con turno hoy.</p>
      </div>
    );
  }

  const nowTop = nowMinutes !== null ? minutesToPx(nowMinutes) : null;
  const showNow = nowTop !== null && nowTop >= 0 && nowTop <= gridHeightPx;

  return (
    <div
      ref={scrollRef}
      className="overflow-auto bg-card"
      // El shell del desk es min-h-dvh (crece con el contenido), así que el calendario
      // se acota a sí mismo para poseer su scroll (sticky + auto-scroll funcionan) en
      // vez de estirar la página. Cap ~ viewport menos el header del desk.
      style={{ maxHeight: 'calc(100dvh - 132px)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
    >
      {/* w-max + min-w-full: pocos barberos → columnas llenan; muchos → scroll-X */}
      <div className="flex w-max min-w-full">

        {/* ── Columna de horas (sticky izquierda) ─────────────────────────── */}
        <div
          className="sticky left-0 z-30 shrink-0 border-r border-line bg-card"
          style={{ width: TIME_COL_WIDTH_PX }}
        >
          <div
            className="sticky top-0 z-10 border-b border-line bg-canvas"
            style={{ height: HEADER_HEIGHT_PX }}
          />
          <div className="relative" style={{ height: gridHeightPx }}>
            {Array.from({ length: totalHours }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-faint"
                style={{ top: i * HOUR_HEIGHT_PX }}
              >
                {String(startHour + i).padStart(2, '0')}:00
              </span>
            ))}
            {showNow && (
              <div
                className="absolute right-0 z-20 h-1.5 w-1.5 -translate-y-1/2 rounded-pill bg-red-ink"
                style={{ top: nowTop! }}
                aria-hidden
              />
            )}
          </div>
        </div>

        {/* ── Columnas por barbero ────────────────────────────────────────── */}
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
              className="flex flex-col border-r border-line last:border-r-0"
              style={{ flex: '1 0 auto', minWidth: COL_MIN_WIDTH_PX }}
            >
              {/* Cabecera de barbero (sticky arriba) — avatar + nombre */}
              <div
                className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-2.5"
                style={{ height: HEADER_HEIGHT_PX }}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-avatar bg-ink text-[10px] font-semibold text-card">
                  {initials(s.name)}
                </span>
                <span className="truncate text-[13px] font-semibold text-ink" title={s.name}>
                  {s.name}
                </span>
              </div>

              {/* Cuerpo (clickable → crear cita) */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Crear cita para ${s.name}`}
                className="relative cursor-pointer"
                style={{ height: gridHeightPx }}
                onClick={(e) => handleColumnClick(e, s.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && onTapFreeSlot) {
                    e.preventDefault();
                    onTapFreeSlot(s.id, startMinutes + Math.floor(totalMinutes / 2));
                  }
                }}
              >
                {/* Guías de hora (horizontales) */}
                {Array.from({ length: totalHours }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-line"
                    style={{ top: i * HOUR_HEIGHT_PX }}
                  />
                ))}

                {/* Fuera de horario (antes del inicio) — tono canvas, sin opacity */}
                {availStart !== null && availStart > startMinutes && (
                  <div className="absolute left-0 right-0 bg-canvas" style={{ top: 0, height: minutesToPx(availStart) }} />
                )}
                {/* Fuera de horario (después del cierre) */}
                {availEnd !== null && availEnd < endMinutes && (
                  <div className="absolute left-0 right-0 bg-canvas" style={{ top: minutesToPx(availEnd), bottom: 0 }} />
                )}
                {/* Sin horario configurado → todo el día inactivo */}
                {avail === null && <div className="absolute inset-0 bg-canvas" />}

                {/* staff_blocks (bloqueos aprobados) — rayas Zentriq */}
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
                      className="absolute left-1 right-1 rounded-[8px]"
                      style={{
                        top, height,
                        background:
                          'repeating-linear-gradient(45deg, var(--color-past-line) 0 2px, var(--color-past-bg) 2px 7px)',
                      }}
                    />
                  );
                })}

                {/* Bloques de cita — tono Zentriq mínimo por estado (fino = Paso 2) */}
                {barberAppts.map((appt) => {
                  const apptStart = isoToLocalMinutes(appt.starts_at, timezone);
                  const apptEnd   = isoToLocalMinutes(appt.ends_at,   timezone);
                  const top       = minutesToPx(Math.max(apptStart, startMinutes));
                  const bottom    = minutesToPx(Math.min(apptEnd,   endMinutes));
                  const height    = Math.max(0, bottom - top);
                  if (height <= 0) return null;
                  const dur   = apptEnd - apptStart;
                  const label = appt.customer?.name ?? appt.service.name;
                  const tone  = TONE[toneFor(appt)];
                  return (
                    <div
                      key={appt.id}
                      className={`absolute left-1 right-1 overflow-hidden rounded-[10px] border border-line shadow-card ${tone.bg}`}
                      style={{ top, height, borderLeft: `3px solid ${tone.bar}`, padding: '4px 8px' }}
                      onClick={(e) => e.stopPropagation()}
                      title={`${minutesToLabel(apptStart)} · ${label} · ${appt.service.name}`}
                    >
                      {height >= 20 && (
                        <>
                          <div className={`whitespace-nowrap text-[9.5px] font-semibold tabular-nums ${tone.ink}`}>
                            {minutesToLabel(apptStart)}
                          </div>
                          <div className={`truncate text-[12px] font-semibold ${tone.ink}`}>{label}</div>
                          {dur >= 45 && (
                            <div className="truncate text-[9.5px] text-faint">{appt.service.name}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Línea "ahora" (horizontal, roja) */}
                {showNow && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 bg-red-ink"
                    style={{ top: nowTop! }}
                    aria-hidden
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
