// ─── PanoramaTimeline ─────────────────────────────────────────────────────────
// Client Component — el panorama de carriles de la mesa de control (S6-UI-02).
//
// Carriles horizontales barbero×tiempo sobre una VENTANA de ~3h navegable anclada
// en "ahora" (1h antes → 2h después). Cada cita es un bloque cuyo ancho = duración
// real; los huecos libres se dibujan tenues. Estados por border-left (en-curso/
// confirmada/completada/atrasado + rojo semántico no-show, violeta walk-in).
//
// Motor portado del §6 del HANDOFF (maqueta congelada), pero idiomático React: las
// posiciones se DERIVAN de winStart en cada render (no layout() imperativo).
//
// PR-3 — GESTO click-to-place: tocás una cita movible → se levanta → el panorama
// ilumina SOLO los huecos donde CABE el servicio (validación por duración) → tocás
// un chip de hora → `onMove` la reagenda (el desk llama a rescheduleAppointment).
// NO drag. Cancelar: Esc, botón Cancelar, o tocar la cita levantada de nuevo.

'use client';

import { useMemo, useState, useEffect } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';

// ─── Config del motor de ventana ──────────────────────────────────────────────

const WIN = 180;        // minutos visibles (3h) = 0 → 100% de la pista
const NAV_STEP = 60;    // navegar de a 1h
const LANE_MIN_H = 62;  // px — carril compacto de altura fija (densidad 8 sin colapsar)
const HEAD_W = 132;     // px — ancho de la columna de nombre del barbero
const MIN_GAP = 15;     // min — no dibujar huecos más cortos que esto

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PanoramaStaff = {
  id: string;
  name: string;
  availabilityToday: { start_time: string; end_time: string } | null;
};

type PanoramaTimelineProps = {
  date: string;            // 'YYYY-MM-DD' del día mostrado
  timezone: string;        // IANA timezone del negocio
  appointments: DashboardAppointment[];
  staff: PanoramaStaff[];  // barberos (carriles), en orden
  // Reagendar (drop del gesto). El desk lo conecta a rescheduleAppointment.
  onMove?: (apptId: string, newStaffId: string, newStartMin: number) => void;
};

// Estado visual derivado de una cita.
type BlockState = 'curso' | 'conf' | 'done' | 'late' | 'noshow' | 'walk';

type LaneBlock = {
  id: string;
  start: number;   // min desde medianoche (tz del negocio)
  dur: number;     // minutos
  state: BlockState;
  name: string;
  service: string;
  movable: boolean; // pending/confirmed y futura → se puede reagendar
};

type Interval = { start: number; end: number };

type MoveState = { apptId: string; fromLaneId: string; dur: number; name: string; service: string };

// ─── Helpers de tiempo (todo en minutos-desde-medianoche, tz del negocio) ──────

function partsInTz(iso: string, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '0';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    min: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

function minutesOfDay(iso: string, timeZone: string): number {
  return partsInTz(iso, timeZone).min;
}

// 'HH:MM:SS' → minutos desde medianoche.
function hhmmToMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m ?? 0);
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = ((min % 60) + 60) % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 || h >= 24 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Horas SUGERIDAS de un hueco: lo antes posible + :00/:30 reales, ≥30 min entre sí.
function suggestedStarts(a: number, b: number, dur: number): number[] {
  const last = b - dur; // último inicio donde el servicio cabe
  const out = [a];
  for (let g = Math.ceil((a + 1) / 30) * 30; g <= last + 0.5; g += 30) {
    if (g - out[out.length - 1]! >= 30) out.push(g);
  }
  return out;
}

// Ajuste fino: cada 15 min dentro del hueco donde cabe.
function fineStarts(a: number, b: number, dur: number): number[] {
  const last = b - dur;
  const out: number[] = [];
  for (let m = Math.ceil(a / 15) * 15; m <= last + 0.5; m += 15) out.push(m);
  if ((out.length === 0 || out[0]! > a) && a <= last) out.unshift(a);
  return out;
}

// Estilo (barra izquierda + fondo + tinta) por estado — solo tokens Zentriq.
const STATE_STYLE: Record<BlockState, { bar: string; bg: string; ink: string }> = {
  curso:  { bar: 'var(--color-teal-border)', bg: 'bg-tint-1',  ink: 'text-teal-ink' },
  conf:   { bar: 'var(--color-ink-2)',       bg: 'bg-card',    ink: 'text-ink' },
  done:   { bar: 'var(--color-past-line)',   bg: 'bg-past-bg', ink: 'text-past-ink' },
  late:   { bar: 'var(--color-red-border)',  bg: 'bg-red-tint', ink: 'text-red-ink' },
  noshow: { bar: 'var(--color-red-border)',  bg: 'bg-red-tint', ink: 'text-red-ink' },
  walk:   { bar: 'var(--color-walk-border)', bg: 'bg-walk-tint', ink: 'text-walk' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PanoramaTimeline({
  date,
  timezone,
  appointments,
  staff,
  onMove,
}: PanoramaTimelineProps) {
  // "Ahora" en vivo (min-desde-medianoche, tz) + el día de hoy en la tz del negocio.
  const [now, setNow] = useState<{ min: number; ymd: string } | null>(null);
  useEffect(() => {
    function tick() {
      const p = partsInTz(new Date().toISOString(), timezone);
      setNow({ min: p.min, ymd: p.ymd });
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  const isToday = now?.ymd === date;
  const nowMin = now?.min ?? null;

  // ── Gesto: cita levantada + modo ajuste-fino ──────────────────────────────
  const [move, setMove] = useState<MoveState | null>(null);
  const [fineMode, setFineMode] = useState(false);
  const canMove = typeof onMove === 'function';

  // Esc cancela el modo mover.
  useEffect(() => {
    if (!move) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMove(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  // ── Derivar bloques por carril + límites del día ──────────────────────────
  const { lanes, dayStart, dayEnd } = useMemo(() => {
    const byStaff = new Map<string, LaneBlock[]>();
    for (const s of staff) byStaff.set(s.id, []);

    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const a of appointments) {
      if (a.status === 'cancelled') continue;
      const list = byStaff.get(a.staff.id);
      if (!list) continue; // cita de un barbero que no está en los carriles mostrados
      const start = minutesOfDay(a.starts_at, timezone);
      let end = minutesOfDay(a.ends_at, timezone);
      if (end <= start) end = start + 30; // guard: fin ≤ inicio (dato raro) → 30 min
      const dur = end - start;

      const isWalk = a.status === 'walkin' || a.source === 'walkin';
      let state: BlockState;
      if (a.status === 'completed') state = 'done';
      else if (a.status === 'no_show') state = 'noshow';
      else if (isWalk) state = 'walk';
      else if (isToday && nowMin !== null && start <= nowMin && nowMin < end) state = 'curso';
      else if (isToday && nowMin !== null && nowMin >= end) state = 'late'; // ventana pasó, sin cerrar
      else state = 'conf';

      // Movible: pending/confirmada y futura (no en-curso, no pasada/cerrada).
      const movable =
        (a.status === 'pending' || a.status === 'confirmed') &&
        (!isToday || nowMin === null || start > nowMin);

      list.push({
        id: a.id,
        start,
        dur,
        state,
        name: a.customer?.name ?? 'Sin nombre',
        service: a.service?.name ?? '',
        movable,
      });
      minStart = Math.min(minStart, start);
      maxEnd = Math.max(maxEnd, end);
    }

    // Límites del día: disponibilidad de los barberos + citas (+ ahora, si es hoy).
    for (const s of staff) {
      if (s.availabilityToday) {
        minStart = Math.min(minStart, hhmmToMin(s.availabilityToday.start_time));
        maxEnd = Math.max(maxEnd, hhmmToMin(s.availabilityToday.end_time));
      }
    }
    if (isToday && nowMin !== null) {
      minStart = Math.min(minStart, nowMin);
      maxEnd = Math.max(maxEnd, nowMin);
    }
    if (!Number.isFinite(minStart)) { minStart = 9 * 60; maxEnd = 21 * 60; }

    // Redondear a la hora y garantizar al menos una ventana de ancho.
    const ds = Math.floor(minStart / 60) * 60;
    let de = Math.ceil(maxEnd / 60) * 60;
    if (de - ds < WIN) de = ds + WIN;

    for (const s of staff) byStaff.get(s.id)!.sort((a, b) => a.start - b.start);

    const lanesOut = staff.map((s) => {
      const blocks = byStaff.get(s.id)!;
      const av = s.availabilityToday;
      const from = av ? hhmmToMin(av.start_time) : ds;
      const to = av ? hhmmToMin(av.end_time) : de;
      const gaps: Interval[] = [];
      let cursor = from;
      for (const b of blocks) {
        if (b.start - cursor >= MIN_GAP) gaps.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.start + b.dur);
      }
      if (to - cursor >= MIN_GAP) gaps.push({ start: cursor, end: to });
      return { staff: s, blocks, gaps, hasAvail: av !== null, availFrom: from, availTo: to };
    });

    return { lanes: lanesOut, dayStart: ds, dayEnd: de };
  }, [appointments, staff, timezone, isToday, nowMin]);

  // ── Ventana navegable ─────────────────────────────────────────────────────
  const maxWinStart = Math.max(dayStart, dayEnd - WIN);
  const defaultStart =
    isToday && nowMin !== null
      ? Math.min(Math.max(nowMin - 60, dayStart), maxWinStart)
      : dayStart;

  const [winStart, setWinStart] = useState<number | null>(null);
  useEffect(() => {
    setWinStart(defaultStart);
  }, [defaultStart]);

  const win = winStart ?? defaultStart;
  const pctOf = (min: number) => ((min - win) / WIN) * 100;
  const setWin = (v: number) => setWinStart(Math.max(dayStart, Math.min(maxWinStart, v)));

  const nowPct = nowMin !== null ? pctOf(nowMin) : -1;
  const nowInWin = isToday && nowPct >= 0 && nowPct <= 100;

  const ticks: number[] = [];
  for (let m = Math.ceil(win / 30) * 30; m <= win + WIN + 0.1; m += 30) ticks.push(m);

  const atStart = win <= dayStart;
  const atEnd = win >= maxWinStart;
  const offNow = isToday && win !== defaultStart;

  // ── Destinos válidos del carril durante el gesto (validación por duración) ──
  function laneDrops(lane: (typeof lanes)[number]): { chips: number[]; nofit: Interval[] } {
    if (!move) return { chips: [], nofit: [] };
    const dur = move.dur;
    const floor = isToday && nowMin !== null ? nowMin : -Infinity;
    const domainStart = Math.max(lane.availFrom, floor);
    // Ocupado (excluye la cita levantada).
    const occ = lane.blocks
      .filter((b) => b.id !== move.apptId)
      .map((b) => [b.start, b.start + b.dur] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    // Complemento libre en [domainStart, availTo].
    const free: Interval[] = [];
    let cur = domainStart;
    for (const [s, e] of occ) {
      if (e <= cur) continue;
      if (s > cur) free.push({ start: cur, end: Math.min(s, lane.availTo) });
      cur = Math.max(cur, e);
      if (cur >= lane.availTo) break;
    }
    if (cur < lane.availTo) free.push({ start: cur, end: lane.availTo });

    const chips: number[] = [];
    const nofit: Interval[] = [];
    for (const g of free) {
      if (g.end - g.start >= dur) {
        const starts = fineMode ? fineStarts(g.start, g.end, dur) : suggestedStarts(g.start, g.end, dur);
        for (const s of starts) {
          const p = pctOf(s);
          if (p >= 0 && p <= 100) chips.push(s);
        }
      } else if (g.end - g.start >= MIN_GAP) {
        nofit.push(g);
      }
    }
    return { chips, nofit };
  }

  function doDrop(laneId: string, startMin: number) {
    if (!move || !onMove) return;
    onMove(move.apptId, laneId, startMin);
    setMove(null);
  }

  return (
    <div className="min-w-0">
      {/* ── Cabecera sticky: barra de modo-mover (si aplica) + nav + eje ── */}
      <div className="sticky top-0 z-20 border-b border-line bg-canvas">
        {/* Barra de modo mover */}
        {move && (
          <div className="flex flex-wrap items-center gap-2 bg-ink px-4 py-2 text-card">
            <span className="text-xs font-semibold">
              Moviendo <span className="rounded-[6px] bg-white/15 px-2 py-0.5">{move.name}</span>
            </span>
            <span className="rounded-[6px] border border-tint-2/30 bg-tint-2/10 px-2 py-0.5 text-[10.5px] font-semibold text-tint-2">
              {move.service || 'Cita'} · {move.dur} min
            </span>
            {/* Toggle sugeridas ↔ cada 15 min */}
            <div className="flex overflow-hidden rounded-pill border border-white/25 text-[11px]">
              <button
                onClick={() => setFineMode(false)}
                className={`px-2.5 py-1 font-semibold transition ${!fineMode ? 'bg-white text-ink' : 'text-card/80'}`}
              >
                Horas sugeridas
              </button>
              <button
                onClick={() => setFineMode(true)}
                className={`px-2.5 py-1 font-semibold transition ${fineMode ? 'bg-white text-ink' : 'text-card/80'}`}
              >
                Cada 15 min
              </button>
            </div>
            <span className="text-[11px] text-card/70">
              Toca una hora · <b className="rounded bg-white/15 px-1">Esc</b> cancela
            </span>
            <button
              onClick={() => setMove(null)}
              className="ml-auto rounded-pill border border-white/30 px-3 py-1 text-xs font-semibold transition hover:border-white"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Nav de ventana */}
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            onClick={() => setWin(win - NAV_STEP)}
            disabled={atStart}
            aria-label="Ver antes"
            className="grid h-7 w-7 place-items-center rounded-pill border border-line text-sm text-ink-2 transition enabled:hover:bg-card disabled:opacity-40"
          >
            ‹
          </button>
          <span className="tabular-nums text-xs font-semibold text-ink-2">
            {fmtMin(win)} – {fmtMin(win + WIN)}
          </span>
          <button
            onClick={() => setWin(win + NAV_STEP)}
            disabled={atEnd}
            aria-label="Ver después"
            className="grid h-7 w-7 place-items-center rounded-pill border border-line text-sm text-ink-2 transition enabled:hover:bg-card disabled:opacity-40"
          >
            ›
          </button>
          <button
            onClick={() => setWin(defaultStart)}
            className={`ml-1 flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-semibold transition ${
              offNow ? 'border-teal-border bg-tint-1 text-teal-ink' : 'border-line text-ink-2 hover:bg-card'
            }`}
          >
            {offNow && <span className="inline-block h-1.5 w-1.5 rounded-pill bg-red-ink" aria-hidden />}
            Ahora
          </button>
          <span className="ml-auto text-xs text-faint">
            {appointments.filter((a) => a.status !== 'cancelled').length} citas · {staff.length} barberos
          </span>
        </div>

        {/* Eje de tiempo — marcas cada 30 min + pastilla roja "ahora" */}
        <div className="relative h-5" style={{ marginLeft: HEAD_W, marginRight: 24 }} aria-hidden>
          {ticks.map((m) => (
            <span
              key={m}
              className="absolute -translate-x-1/2 tabular-nums text-[10px] font-medium text-faint"
              style={{ left: `${pctOf(m)}%`, top: 2 }}
            >
              {fmtMin(m)}
            </span>
          ))}
          {nowInWin && (
            <span
              className="absolute -translate-x-1/2 rounded-[5px] bg-red-ink px-1.5 py-px tabular-nums text-[10px] font-bold text-card"
              style={{ left: `${nowPct}%`, top: 0 }}
            >
              {fmtMin(nowMin!).replace(' AM', '').replace(' PM', '')}
            </span>
          )}
        </div>
      </div>

      {/* ── Carriles ── */}
      {lanes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
          <b className="text-sm">Ningún barbero con turno hoy</b>
          <p className="max-w-[36ch] text-xs text-ink-2">
            No hay horarios asignados para este día. Revisa los turnos del equipo o elige otra fecha.
          </p>
        </div>
      ) : (
        <ul>
          {lanes.map((lane) => {
            const { staff: s, blocks, gaps, hasAvail } = lane;
            const drops = laneDrops(lane);
            return (
              <li
                key={s.id}
                className="flex items-stretch border-b border-line-2 last:border-b-0"
                style={{ minHeight: LANE_MIN_H }}
              >
                {/* Cabecera del carril (nombre del barbero) */}
                <div
                  className="flex shrink-0 items-center gap-2 border-r border-line bg-canvas px-3"
                  style={{ flexBasis: HEAD_W }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-avatar bg-ink text-[11px] font-semibold text-card">
                    {initials(s.name)}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <b className="block truncate text-[12.5px] font-semibold">{s.name}</b>
                    <span className="text-[10px] text-faint">
                      {hasAvail ? `${blocks.length} ${blocks.length === 1 ? 'cita' : 'citas'}` : 'Sin turno'}
                    </span>
                  </div>
                </div>

                {/* Pista de tiempo (sub-rejilla 15 min de fondo) */}
                <div
                  className="relative min-w-0 flex-1"
                  style={{
                    margin: '8px 12px',
                    backgroundImage: 'linear-gradient(90deg, var(--grid-15) 1px, transparent 1px)',
                    backgroundSize: `${(15 / WIN) * 100}% 100%`,
                  }}
                >
                  {/* Huecos libres (ocultos durante el gesto: los reemplazan los chips) */}
                  {!move &&
                    gaps.map((g, i) => {
                      const l = pctOf(g.start);
                      const r = pctOf(g.end);
                      if (r <= 0.2 || l >= 99.8) return null;
                      const cl = Math.max(l, 0);
                      const cr = Math.min(r, 100);
                      return (
                        <div
                          key={`gap-${i}`}
                          className="absolute inset-y-0 grid place-items-center rounded-[8px] border border-dashed border-line text-[10px] font-medium text-faint"
                          style={{ left: `${cl}%`, width: `${cr - cl}%` }}
                        >
                          libre
                        </div>
                      );
                    })}

                  {/* Bloques de cita */}
                  {blocks.map((b) => {
                    const l = pctOf(b.start);
                    const r = pctOf(b.start + b.dur);
                    if (r <= 0.2 || l >= 99.8) return null; // fuera de la ventana
                    const cl = Math.max(l, 0);
                    const cr = Math.min(r, 100);
                    const clipL = l < -0.2;
                    const clipR = r > 100.2;
                    const st = STATE_STYLE[b.state];
                    const lifted = move?.apptId === b.id;
                    const dimmed = move !== null && !lifted;
                    const interactive = canMove && b.movable && (!move || lifted);
                    return (
                      <div
                        key={b.id}
                        onClick={
                          interactive
                            ? () =>
                                lifted
                                  ? setMove(null)
                                  : setMove({
                                      apptId: b.id,
                                      fromLaneId: s.id,
                                      dur: b.dur,
                                      name: b.name,
                                      service: b.service,
                                    })
                            : undefined
                        }
                        role={interactive ? 'button' : undefined}
                        aria-label={interactive ? `Mover cita de ${b.name}` : undefined}
                        className={`absolute inset-y-0 overflow-hidden border border-line ${st.bg} shadow-card transition-all ${
                          b.state === 'late' && !move ? 'animate-data-beat motion-reduce:animate-none' : ''
                        } ${interactive ? 'cursor-pointer' : ''} ${
                          lifted ? 'z-20 -translate-y-1 shadow-hero ring-2 ring-ink' : ''
                        } ${dimmed ? 'opacity-40' : ''}`}
                        style={{
                          left: `${cl}%`,
                          width: `${cr - cl}%`,
                          borderLeft: `3px solid ${st.bar}`,
                          borderTopLeftRadius: clipL ? 0 : 8,
                          borderBottomLeftRadius: clipL ? 0 : 8,
                          borderTopRightRadius: clipR ? 0 : 8,
                          borderBottomRightRadius: clipR ? 0 : 8,
                          padding: '6px 9px',
                          pointerEvents: dimmed ? 'none' : undefined,
                        }}
                        title={`${fmtMin(b.start)} · ${b.name}${b.service ? ` · ${b.service}` : ''}`}
                      >
                        <div
                          className={`flex items-center gap-1 overflow-hidden whitespace-nowrap tabular-nums text-[9.5px] font-semibold ${st.ink}`}
                        >
                          {fmtMin(b.start).replace(' AM', '').replace(' PM', '')}
                          {b.state === 'curso' && <span>· En curso</span>}
                          {b.state === 'late' && <span>· Atrasado</span>}
                          {b.state === 'noshow' && <span>· No llegó</span>}
                          {interactive && !lifted && <span className="ml-auto opacity-50">⠿</span>}
                        </div>
                        <div className="mt-px truncate text-[12px] font-semibold">{b.name}</div>
                        {b.service && b.dur >= 45 && (
                          <div className="truncate text-[9.5px] text-faint">{b.service}</div>
                        )}
                      </div>
                    );
                  })}

                  {/* Chips de destino (gesto) — solo donde CABE el servicio */}
                  {move &&
                    drops.chips.map((startMin) => {
                      const p = pctOf(startMin);
                      return (
                        <button
                          key={`chip-${startMin}`}
                          onClick={() => doDrop(s.id, startMin)}
                          className="absolute top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[9px] border-[1.5px] border-teal-border bg-card px-2 py-1 tabular-nums text-[11px] font-bold text-teal-ink shadow-card transition hover:bg-tint-1 hover:shadow-hero"
                          style={{ left: `${p}%` }}
                        >
                          {fmtMin(startMin).replace(' AM', '').replace(' PM', '')}
                        </button>
                      );
                    })}

                  {/* Marcas "no cabe" (huecos demasiado cortos para el servicio) */}
                  {move &&
                    drops.nofit.map((g, i) => {
                      const p = pctOf((g.start + g.end) / 2);
                      if (p < 0 || p > 100) return null;
                      return (
                        <span
                          key={`nofit-${i}`}
                          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-dashed border-line px-1.5 py-0.5 text-[9px] font-semibold text-faint"
                          style={{ left: `${p}%` }}
                        >
                          no cabe
                        </span>
                      );
                    })}

                  {/* Línea "ahora" (roja) */}
                  {nowInWin && (
                    <div
                      className="absolute inset-y-0 z-10 w-0.5 bg-red-ink"
                      style={{ left: `${nowPct}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
