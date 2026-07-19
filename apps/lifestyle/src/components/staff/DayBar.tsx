// ─── DayBar ──────────────────────────────────────────────────────────────────
// La barra del día del barbero (Paso 2). Una sola barra horizontal donde el ANCHO
// ES EL TIEMPO: cada cita es un bloque posicionado y dimensionado por su hora y
// duración reales. Los huecos son huecos de verdad (pista bg-gap visible). Una
// marca vertical señala el ahora. Debajo: hechas · por delante · libres.
//
// Regla: la estructura encodea hechos reales. Nada decorativo.
//
// Lectura pura — no muta nada. Tocar un bloque hace scroll a esa cita en la lista.
//
// Bordes decididos:
//   · Escala = jornada real del barbero HOY (staff_availability), en la tz del negocio.
//   · Break (break_start/end) → banda RAYADA distinta (no es hueco agendable) y NO
//     cuenta en "libres".
//   · Día libre / is_active=false / sin slot → sin escala: placeholder, no un cero.
//   · Cita fuera de la jornada (walk-in retroactivo, o cita que se pasa del cierre)
//     → se EXTIENDE la escala para que entre (una cita real no puede ser invisible);
//     el tramo fuera de jornada se pinta off-shift (past-bg), no cuenta en "libres".
//   · Ahora fuera de la escala (antes de abrir / después de cerrar) → se OCULTA la
//     marca (no se clava en el borde).

'use client';

import { useState, useEffect } from 'react';
import type { DashboardAppointment, StaffAvailabilitySlot } from '@/lib/dashboard.types';
import type { DriftProjection } from '@/lib/dayDrift';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
  availability: StaffAvailabilitySlot[];   // horario semanal recurrente del barbero
  date: string;                             // 'YYYY-MM-DD'
  timezone: string;                         // IANA — tz del negocio
  /** El día se corrió (Paso 6): id → proyección. El bloque se dibuja en su hora
      REAL y deja un fantasma punteado donde estaba. Ya filtradas por el umbral. */
  projections?: Map<string, DriftProjection>;
};

// ─── Helpers de tiempo ────────────────────────────────────────────────────────

/** 'HH:MM' o 'HH:MM:SS' → minutos desde medianoche */
function timeToMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/** ISO → minutos desde medianoche en el timezone dado (misma técnica que AvailabilityTimeline) */
function isoToLocalMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return (h === 24 ? 0 : h) * 60 + m;
}

function nowLocalMinutes(timezone: string): number {
  return isoToLocalMinutes(new Date().toISOString(), timezone);
}

function isToday(date: string, timezone: string): boolean {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) === date;
}

/** minutos desde medianoche → 'HH:MM' */
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** minutos → "Xh Ym" / "Xh" / "Ym" (para el resumen de libres) */
function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm} min`;
  if (mm === 0) return `${h} h`;
  return `${h} h ${mm} min`;
}

const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'walkin']);

// ─── Tono por estado (atenuar por COLOR, no opacity) ──────────────────────────
// done → past-line · conf → teal atenuado (tint-2) · no-show → rojo tenue ·
// walk-in → violeta · en curso → teal + halo estático.
function blockClass(status: string, isLive: boolean): string {
  if (isLive) return 'bg-teal text-card bar-block-live';
  switch (status) {
    case 'completed': return 'bg-past-line text-past-ink';
    case 'no_show':   return 'bg-red-tint text-red-ink border border-red-border';
    case 'walkin':    return 'bg-walk-tint text-walk border border-walk-border';
    default:          return 'bg-tint-2 text-teal-ink border border-teal-border'; // pending/confirmed
  }
}

// ─── Merge de intervalos (para "libres" = jornada − break − citas) ────────────
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push([cur[0], cur[1]]);
  }
  return out;
}

/** minutos ocupados dentro de [lo, hi] por una lista de intervalos ya mergeados */
function occupiedWithin(merged: [number, number][], lo: number, hi: number): number {
  let acc = 0;
  for (const [s, e] of merged) {
    const a = Math.max(s, lo), b = Math.min(e, hi);
    if (b > a) acc += b - a;
  }
  return acc;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DayBar({ appointments, availability, date, timezone, projections }: Props) {
  // Marca del ahora — solo si `date` es hoy en la tz; refresca cada minuto.
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [prevKey, setPrevKey] = useState(`${date}|${timezone}`);
  const key = `${date}|${timezone}`;
  if (prevKey !== key) {
    setPrevKey(key);
    if (!isToday(date, timezone)) setNowMin(null);
  }
  useEffect(() => {
    // No-hoy: no arrancar el intervalo. El reset a null lo hace el sync en render
    // (arriba) cuando cambia date/tz — no se llama setState dentro del effect.
    if (!isToday(date, timezone)) return;
    const update = () => setNowMin(nowLocalMinutes(timezone));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [date, timezone]);

  // ── Jornada de HOY (por day_of_week de `date`, activa) ──────────────────────
  const dow = new Date(`${date}T12:00:00`).getDay();
  const todayAvail = availability.find((a) => a.day_of_week === dow && a.is_active !== false) ?? null;

  // ── Bloques de citas (todas menos canceladas: una cancelada libera el hueco) ─
  const blocks = appointments
    .filter((a) => a.status !== 'cancelled')
    .map((a) => {
      const startMin = isoToLocalMinutes(a.starts_at, timezone);
      // duración por diferencia real de instantes, SIN redondear → el ancho es
      // exactamente ∝ duración (una de 45 min mide justo el doble que una de 22.5).
      // No depende del wrap de medianoche del formateo local.
      const durationMin = Math.max(
        1,
        (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000,
      );
      // El día se corrió (Paso 6): el bloque vive en su hora PROYECTADA (la real)
      // y el hueco programado queda como fantasma punteado (dispStart ≠ startMin).
      const proj = projections?.get(a.id);
      const dispStart = proj
        ? isoToLocalMinutes(new Date(proj.projectedStartMs).toISOString(), timezone)
        : startMin;
      return {
        id: a.id,
        startMin,
        endMin: startMin + durationMin,
        dispStart,
        dispEnd: dispStart + durationMin,
        shifted: dispStart !== startMin,
        status: a.status,
        appt: a,
      };
    })
    .sort((x, y) => x.startMin - y.startMin);

  // ── Escala ──────────────────────────────────────────────────────────────────
  const hasWorkday = todayAvail !== null;
  const baseStart = hasWorkday ? timeToMinutes(todayAvail!.start_time) : null;
  const baseEnd   = hasWorkday ? timeToMinutes(todayAvail!.end_time)   : null;

  // Sin jornada Y sin citas → nada que escalar: placeholder honesto.
  if (!hasWorkday && blocks.length === 0) {
    return (
      <div className="rounded-card border border-line bg-card px-4 py-3 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Tu día</p>
        <p className="mt-1 text-sm text-ink-2">Sin jornada — no trabajás este día.</p>
      </div>
    );
  }

  // Escala = jornada, EXTENDIDA para que entre cualquier cita fuera de horario
  // (incluida la posición PROYECTADA de un bloque corrido — no puede ser invisible).
  let scaleStart = baseStart ?? blocks[0]!.startMin;
  let scaleEnd   = baseEnd   ?? blocks[blocks.length - 1]!.endMin;
  for (const b of blocks) {
    if (b.startMin < scaleStart) scaleStart = b.startMin;
    if (b.endMin > scaleEnd)     scaleEnd   = b.endMin;
    if (b.dispEnd > scaleEnd)    scaleEnd   = b.dispEnd;
  }
  const span = Math.max(1, scaleEnd - scaleStart);
  const pct = (min: number) => ((min - scaleStart) / span) * 100;

  // ── Break (banda "no trabajo") ──────────────────────────────────────────────
  const hasBreak =
    hasWorkday && !!todayAvail!.break_start && !!todayAvail!.break_end;
  const breakStart = hasBreak ? timeToMinutes(todayAvail!.break_start!) : null;
  const breakEnd   = hasBreak ? timeToMinutes(todayAvail!.break_end!)   : null;

  // ── Resumen ─────────────────────────────────────────────────────────────────
  const hechas = blocks.filter((b) => b.status === 'completed' || b.status === 'no_show').length;
  const porDelante = blocks.filter((b) => ACTIVE_STATUSES.has(b.status)).length;

  // Libres = tiempo agendable DENTRO de la jornada = span_jornada − break − citas∩jornada.
  // El break NO cuenta como libre. Los tramos fuera de jornada (extensión) no cuentan.
  let libresMin: number | null = null;
  if (hasWorkday) {
    const occupied = mergeIntervals([
      ...blocks.map((b) => [b.startMin, b.endMin] as [number, number]),
      ...(hasBreak ? [[breakStart!, breakEnd!] as [number, number]] : []),
    ]);
    libresMin = Math.max(0, (baseEnd! - baseStart!) - occupiedWithin(occupied, baseStart!, baseEnd!));
  }

  const showNow = nowMin !== null && nowMin >= scaleStart && nowMin <= scaleEnd;

  function jumpTo(id: string) {
    const el = document.getElementById(`cita-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="rounded-card border border-line bg-card px-4 py-3 shadow-card">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Tu día</p>
        <p className="text-[11px] tabular-nums text-faint">
          {minutesToHHMM(scaleStart)}–{minutesToHHMM(scaleEnd)}
        </p>
      </div>

      {/* ── La barra ─────────────────────────────────────────────────────────── */}
      {/* Track base = off-shift (past-bg). La jornada agendable se pinta encima con
          bg-gap; así el hueco que se VE es exactamente el que cuenta como libre. */}
      <div className="relative mt-2 h-10 w-full overflow-hidden rounded-lg bg-past-bg">
        {/* Banda de jornada (hueco libre agendable) */}
        {hasWorkday && (
          <div
            className="absolute inset-y-0 bg-gap"
            style={{ left: `${pct(baseStart!)}%`, width: `${pct(baseEnd!) - pct(baseStart!)}%` }}
            aria-hidden="true"
          />
        )}

        {/* Break — banda rayada "no trabajo" (encima de la jornada, debajo de las citas) */}
        {hasBreak && (
          <div
            className="bar-break-hatch absolute inset-y-0"
            style={{ left: `${pct(breakStart!)}%`, width: `${pct(breakEnd!) - pct(breakStart!)}%` }}
            title={`Descanso ${minutesToHHMM(breakStart!)}–${minutesToHHMM(breakEnd!)}`}
            aria-hidden="true"
          />
        )}

        {/* Fantasmas punteados — el hueco programado que el corrimiento dejó vacío
            (Paso 6). Debajo de los bloques, no interactivos: son memoria, no cita. */}
        {blocks.filter((b) => b.shifted).map((b) => {
          const left = pct(b.startMin);
          const width = pct(b.endMin) - left;
          return (
            <div
              key={`ghost-${b.id}`}
              className="absolute inset-y-1 rounded-md border border-dashed border-past-line"
              style={{ left: `${left}%`, width: `max(0.9%, ${width}%)` }}
              aria-hidden="true"
            />
          );
        })}

        {/* Bloques de cita — en su hora REAL (proyectada si el día se corrió) */}
        {blocks.map((b) => {
          const isLive = nowMin !== null && nowMin >= b.dispStart && nowMin < b.dispEnd && ACTIVE_STATUSES.has(b.status);
          const left = pct(b.dispStart);
          const width = pct(b.dispEnd) - left;
          const label = `${b.appt.customer?.name ?? 'Cita'} · ${minutesToHHMM(b.dispStart)}`;
          return (
            <button
              key={b.id}
              onClick={() => jumpTo(b.id)}
              title={label}
              aria-label={`Ir a la cita: ${label}`}
              className={`absolute inset-y-1 rounded-md ${blockClass(b.status, isLive)}`}
              style={{ left: `${left}%`, width: `max(0.9%, ${width}%)` }}
            />
          );
        })}

        {/* Marca del ahora — oculta si cae fuera de la escala */}
        {showNow && (
          <div className="absolute inset-y-0 z-10" style={{ left: `${pct(nowMin!)}%` }}>
            <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-ink" />
          </div>
        )}
      </div>

      {/* Chip del ahora — debajo, alineado a la marca */}
      {showNow && (
        <div className="relative mt-1 h-4">
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap rounded-pill bg-red-ink px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-card"
            style={{ left: `${pct(nowMin!)}%` }}
          >
            {minutesToHHMM(nowMin!)}
          </span>
        </div>
      )}

      {/* ── Resumen: hechas · por delante · libres ───────────────────────────── */}
      <p className="mt-3 text-sm tabular-nums text-ink-2">
        <span className="font-semibold text-ink">{hechas}</span> hechas
        <span className="mx-1.5 text-faint">·</span>
        <span className="font-semibold text-ink">{porDelante}</span> por delante
        {libresMin !== null && (
          <>
            <span className="mx-1.5 text-faint">·</span>
            <span className="font-semibold text-ink">{formatDuration(libresMin)}</span> libres
          </>
        )}
      </p>

      {/* Día libre pero con citas (walk-in retroactivo, etc.) — se muestran igual */}
      {!hasWorkday && (
        <p className="mt-1 text-[11px] text-faint">Fuera de jornada — sin horario este día.</p>
      )}
    </div>
  );
}
