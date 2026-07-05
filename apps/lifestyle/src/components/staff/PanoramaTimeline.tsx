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

import { useMemo, useState, useEffect, useRef } from 'react';
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
  availabilityToday: {
    start_time: string;
    end_time: string;
    break_start?: string | null;
    break_end?: string | null;
  } | null;
};

export type PanoramaBlock = { staffId: string; startsAt: string; endsAt: string };

type PanoramaTimelineProps = {
  date: string;            // 'YYYY-MM-DD' del día mostrado
  timezone: string;        // IANA timezone del negocio
  appointments: DashboardAppointment[];
  staff: PanoramaStaff[];  // barberos (carriles), en orden
  staffBlocks: PanoramaBlock[]; // bloqueos aprobados (vacaciones/emergencias) del día
  // Drop del gesto. El desk despacha por move.kind (reschedule vs create walk-in).
  // opts presente = solape FORZADO (recepción): fuerza + aviso.
  onPlace?: (move: MoveState, newStaffId: string, newStartMin: number, opts?: PlaceOpts) => void;
  // Walk-in solicitado desde el desk (+ Walk-in): entra en modo-colocar.
  walkinRequest?: WalkinRequest | null;
  onWalkinConsumed?: () => void; // el walk-in se colocó o canceló → el desk limpia
  // El panorama avisa cuando hay un gesto en curso → el desk pausa el polling.
  onInteractingChange?: (active: boolean) => void;
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
  movable: boolean;        // pending/confirmed y futura → se puede reagendar
  approvedOverlap: boolean; // solape intencional aprobado por la recepción (visible)
};

type Interval = { start: number; end: number };

// El sujeto en modo-colocar: reacomodo de una cita existente, o un walk-in nuevo.
export type MoveState =
  | { kind: 'reschedule'; apptId: string; fromLaneId: string; dur: number; name: string; service: string }
  | { kind: 'walkin'; serviceId: string; dur: number; name: string; service: string; phone?: string };

// Solicitud de walk-in desde el desk (dispara el modo-colocar de un walk-in nuevo).
export type WalkinRequest = { serviceId: string; dur: number; name: string; service: string; phone?: string };

// Payload del drop → el desk despacha por kind (reschedule vs create).
export type PlaceOpts = { force: boolean; overlapMin: number; overlapName: string };

// Un destino ofrecido: limpio (soft=false) o solape forzable (soft=true).
type DropChip = { min: number; soft: boolean; overlapMin: number; overlapName: string };

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
  staffBlocks,
  onPlace,
  walkinRequest,
  onWalkinConsumed,
  onInteractingChange,
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
  // Destino ámbar pendiente de confirmación consciente (no se mueve hasta el 2º tap).
  const [pendingOverlap, setPendingOverlap] = useState<{ laneId: string; chip: DropChip } | null>(null);
  const canMove = typeof onPlace === 'function';

  // Salir del modo mover limpia también la confirmación pendiente.
  useEffect(() => {
    if (!move) setPendingOverlap(null);
  }, [move]);

  // Avisar al desk cuando hay un gesto en curso (para pausar el polling).
  useEffect(() => {
    onInteractingChange?.(move !== null);
  }, [move, onInteractingChange]);

  // Walk-in solicitado desde el desk → entra en modo-colocar (si no hay otro gesto).
  useEffect(() => {
    if (walkinRequest && !move) {
      setMove({ kind: 'walkin', ...walkinRequest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkinRequest]);

  // Cuando un walk-in termina (colocado o cancelado) → avisar al desk para que limpie.
  const prevKind = useRef<MoveState['kind'] | null>(null);
  useEffect(() => {
    const prev = prevKind.current;
    prevKind.current = move?.kind ?? null;
    if (!move && prev === 'walkin') onWalkinConsumed?.();
  }, [move, onWalkinConsumed]);

  // Esc: si hay confirmación de solape pendiente → vuelve a los chips; si no → cancela.
  useEffect(() => {
    if (!move) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setPendingOverlap((p) => {
        if (p) return null; // cancela solo la confirmación
        setMove(null);
        return null;
      });
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
        approvedOverlap: a.allow_overlap === true,
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

      // No-disponible: descanso del día + bloqueos aprobados (vacaciones/emergencias).
      const unavail: Interval[] = [];
      if (av?.break_start && av?.break_end) {
        unavail.push({ start: hhmmToMin(av.break_start), end: hhmmToMin(av.break_end) });
      }
      for (const bl of staffBlocks) {
        if (bl.staffId !== s.id) continue;
        const bs = minutesOfDay(bl.startsAt, timezone);
        const be = minutesOfDay(bl.endsAt, timezone);
        if (be > bs) unavail.push({ start: bs, end: be });
      }
      unavail.sort((a, b) => a.start - b.start);

      // Huecos "libre" (visual): entre citas, dentro del turno.
      const gaps: Interval[] = [];
      let cursor = from;
      for (const b of blocks) {
        if (b.start - cursor >= MIN_GAP) gaps.push({ start: cursor, end: b.start });
        cursor = Math.max(cursor, b.start + b.dur);
      }
      if (to - cursor >= MIN_GAP) gaps.push({ start: cursor, end: to });
      return { staff: s, blocks, gaps, unavail, hasAvail: av !== null, availFrom: from, availTo: to };
    });

    return { lanes: lanesOut, dayStart: ds, dayEnd: de };
  }, [appointments, staff, staffBlocks, timezone, isToday, nowMin]);

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

  // ── Destinos del carril durante el gesto ───────────────────────────────────
  // DURO (no se ofrece): fuera del turno / descanso / bloqueo. Dentro de ese
  // tiempo físicamente disponible se ofrecen chips: LIMPIO (no pisa nada) o
  // SOLAPE (pisaría otra cita — forzable por la recepción, marcado en ámbar).
  function laneDrops(lane: (typeof lanes)[number]): DropChip[] {
    if (!move) return [];
    const dur = move.dur;
    const floor = isToday && nowMin !== null ? nowMin : -Infinity;
    const domainStart = Math.max(lane.availFrom, floor);
    const domainEnd = lane.availTo;

    // Tiempo físicamente disponible = turno − descanso − bloqueos (frontera DURA).
    const blocked = lane.unavail.map((u) => [u.start, u.end] as [number, number]).sort((a, b) => a[0] - b[0]);
    const available: Interval[] = [];
    let cur = domainStart;
    for (const [bs, be] of blocked) {
      if (be <= cur) continue;
      if (bs > cur) available.push({ start: cur, end: Math.min(bs, domainEnd) });
      cur = Math.max(cur, be);
      if (cur >= domainEnd) break;
    }
    if (cur < domainEnd) available.push({ start: cur, end: domainEnd });

    // Citas para clasificar solape. En reacomodo se excluye la cita levantada;
    // en walk-in no hay cita propia que excluir.
    const excludeId = move.kind === 'reschedule' ? move.apptId : null;
    const appts = lane.blocks.filter((b) => b.id !== excludeId);

    const chips: DropChip[] = [];
    for (const av of available) {
      const last = av.end - dur; // último inicio donde el servicio cabe en el tiempo disponible
      if (last < av.start - 0.5) continue;
      const starts = fineMode ? fineStarts(av.start, av.end, dur) : suggestedStarts(av.start, av.end, dur);
      for (const s of starts) {
        if (s > last + 0.5) continue;
        const p = pctOf(s);
        if (p < 0 || p > 100) continue;
        // ¿solaparía alguna cita? (toma el solape mayor para el aviso)
        let overlapMin = 0;
        let overlapName = '';
        for (const b of appts) {
          const ov = Math.min(s + dur, b.start + b.dur) - Math.max(s, b.start);
          if (ov > 0 && ov > overlapMin) { overlapMin = Math.round(ov); overlapName = b.name; }
        }
        chips.push({ min: s, soft: overlapMin > 0, overlapMin, overlapName });
      }
    }
    return chips;
  }

  function doDrop(laneId: string, chip: DropChip) {
    if (!move || !onPlace) return;
    if (chip.soft) {
      setPendingOverlap({ laneId, chip }); // confirmación consciente (2º tap)
      return;
    }
    onPlace(move, laneId, chip.min);
    setMove(null);
  }

  function confirmOverlap() {
    if (!move || !onPlace || !pendingOverlap) return;
    const { laneId, chip } = pendingOverlap;
    onPlace(move, laneId, chip.min, {
      force: true,
      overlapMin: chip.overlapMin,
      overlapName: chip.overlapName,
    });
    setMove(null);
  }

  return (
    <div className="min-w-0">
      {/* ── Cabecera sticky: barra de modo-mover (si aplica) + nav + eje ── */}
      <div className="sticky top-0 z-20 border-b border-line bg-canvas">
        {/* Barra de modo mover */}
        {move && pendingOverlap && (
          // Confirmación consciente del solape (no se movió nada todavía).
          <div className="flex flex-wrap items-center gap-2 bg-ink px-4 py-2 text-card">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--color-amber-border)]">
              <span aria-hidden>⚠</span> Se encima {pendingOverlap.chip.overlapMin} min con{' '}
              <span className="rounded-[6px] bg-white/15 px-2 py-0.5 text-card">{pendingOverlap.chip.overlapName}</span>
            </span>
            <span className="text-[11px] text-card/70">
              a las <b className="tabular-nums">{fmtMin(pendingOverlap.chip.min).replace(' AM', '').replace(' PM', '')}</b>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPendingOverlap(null)}
                className="rounded-pill border border-white/30 px-3 py-1 text-xs font-semibold transition hover:border-white"
              >
                Elegir otra hora
              </button>
              <button
                onClick={confirmOverlap}
                style={{ backgroundColor: 'var(--color-amber)' }}
                className="rounded-pill px-3 py-1 text-xs font-bold text-card shadow-card transition hover:opacity-90"
              >
                Encajar igual
              </button>
            </div>
          </div>
        )}

        {move && !pendingOverlap && (
          <div className="flex flex-wrap items-center gap-2 bg-ink px-4 py-2 text-card">
            <span className="text-xs font-semibold">
              {move.kind === 'walkin' ? 'Colocando walk-in' : 'Moviendo'}{' '}
              <span className="rounded-[6px] bg-white/15 px-2 py-0.5">{move.name}</span>
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
            const { staff: s, blocks, gaps, unavail, hasAvail } = lane;
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
                  {/* Bandas no-disponibles: descanso + bloqueos (siempre visibles) */}
                  {unavail.map((u, i) => {
                    const l = pctOf(u.start);
                    const r = pctOf(u.end);
                    if (r <= 0.2 || l >= 99.8) return null;
                    const cl = Math.max(l, 0);
                    const cr = Math.min(r, 100);
                    return (
                      <div
                        key={`unavail-${i}`}
                        className="absolute inset-y-0 z-[1] grid place-items-center overflow-hidden rounded-[8px] text-[9px] font-semibold text-faint"
                        style={{
                          left: `${cl}%`,
                          width: `${cr - cl}%`,
                          backgroundImage:
                            'repeating-linear-gradient(135deg, transparent 0 5px, var(--color-line-2) 5px 6px)',
                        }}
                        title="No disponible (descanso o bloqueo)"
                      >
                        no disp.
                      </div>
                    );
                  })}

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
                    const lifted = move?.kind === 'reschedule' && move.apptId === b.id;
                    const dimmed = move !== null && !lifted;
                    // Movible solo fuera de un walk-in en curso (no se levanta una cita
                    // mientras se coloca un walk-in).
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
                                      kind: 'reschedule',
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
                        } ${b.approvedOverlap && !lifted ? 'ring-2 ring-amber-border' : ''} ${dimmed ? 'opacity-40' : ''}`}
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
                        title={`${fmtMin(b.start)} · ${b.name}${b.service ? ` · ${b.service}` : ''}${b.approvedOverlap ? ' · solape aprobado' : ''}`}
                      >
                        <div
                          className={`flex items-center gap-1 overflow-hidden whitespace-nowrap tabular-nums text-[9.5px] font-semibold ${st.ink}`}
                        >
                          {b.approvedOverlap && <span className="text-amber" title="Solape aprobado" aria-hidden>⚠</span>}
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

                  {/* Chips de destino (gesto): teal = limpio · ámbar = solaparía (forzable) */}
                  {move &&
                    drops.map((chip) => (
                      <button
                        key={`chip-${chip.min}`}
                        onClick={() => doDrop(s.id, chip)}
                        title={
                          chip.soft
                            ? `Se solaparía ${chip.overlapMin} min con ${chip.overlapName} — la recepción puede forzarlo`
                            : undefined
                        }
                        className={`absolute top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[9px] border-[1.5px] px-2 py-1 tabular-nums text-[11px] font-bold shadow-card transition hover:shadow-hero ${
                          chip.soft
                            ? 'border-amber-border bg-amber-tint text-amber hover:bg-amber-tint'
                            : 'border-teal-border bg-card text-teal-ink hover:bg-tint-1'
                        }`}
                        style={{ left: `${pctOf(chip.min)}%` }}
                      >
                        {chip.soft && <span aria-hidden>⚠ </span>}
                        {fmtMin(chip.min).replace(' AM', '').replace(' PM', '')}
                      </button>
                    ))}

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
