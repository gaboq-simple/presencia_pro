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

import { useMemo, useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import {
  type Interval,
  partsInTz,
  minutesOfDay,
  hhmmToMin,
  fmtMin,
  suggestedStarts,
  fineStarts,
  availableIntervals,
  overlapAt,
} from './panoramaEngine';

// ─── Config del motor de ventana ──────────────────────────────────────────────

const WIN = 180;        // minutos visibles (3h) = 0 → 100% de la pista
const NAV_STEP = 60;    // navegar de a 1h
const LANE_MIN_H = 62;  // px — carril compacto de altura fija (densidad 8 sin colapsar)
const HEAD_W = 132;     // px — ancho de la columna de nombre del barbero
const MIN_GAP = 15;     // min — no dibujar huecos más cortos que esto
const DRAG_THRESH = 5;  // px — mover más que esto con el botón abajo = drag (no tap)
const EDGE_ZONE = 34;   // px — zona de borde que dispara auto-pan durante el drag

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
  // Reacomodo solicitado desde la cola (tarjeta de atrasado): levanta esa cita.
  rescheduleRequest?: RescheduleRequest | null;
  onRescheduleConsumed?: () => void; // se colocó o canceló → el desk limpia
  // Conexión viva: cita a resaltar (hover en una tarjeta de la cola). Sin gesto.
  highlightApptId?: string | null;
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

// El sujeto en modo-colocar: reacomodo de una cita existente, o un walk-in nuevo.
export type MoveState =
  | { kind: 'reschedule'; apptId: string; fromLaneId: string; dur: number; name: string; service: string }
  | { kind: 'walkin'; serviceId: string; dur: number; name: string; service: string; phone?: string };

// Solicitud de walk-in desde el desk (dispara el modo-colocar de un walk-in nuevo).
export type WalkinRequest = { serviceId: string; dur: number; name: string; service: string; phone?: string };

// Solicitud de reacomodo desde la COLA de acción: levanta esta cita en el panorama
// (entra al MISMO gesto click-to-place; no hay segunda lógica de mover). Espejo de
// WalkinRequest — el desk la setea al tocar "Mover" en la tarjeta de un atrasado.
export type RescheduleRequest = { apptId: string; dur: number; name: string; service: string; fromLaneId: string };

// Payload del drop → el desk despacha por kind (reschedule vs create).
export type PlaceOpts = { force: boolean; overlapMin: number; overlapName: string };

// Un destino ofrecido: limpio (soft=false) o solape forzable (soft=true).
type DropChip = { min: number; soft: boolean; overlapMin: number; overlapName: string };

// Helpers de tiempo + aritmética de huecos: fuente ÚNICA en ./panoramaEngine
// (compartida con la cola de acción). Ver imports arriba.

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
  rescheduleRequest,
  onRescheduleConsumed,
  highlightApptId,
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

  // ── Drag: el arrastre es OTRO input al MISMO gesto (no una lógica paralela).
  // Un mousedown sobre una cita movible "arma"; si el cursor cruza el umbral →
  // levanta la cita (mismo `move`) y el bloque sigue al cursor como ghost. Al
  // soltar, cae en el chip válido más cercano del carril bajo el cursor → doDrop
  // (limpio → onPlace · solape → confirmación consciente). Un click sin cruzar el
  // umbral queda como tap-tap (el onClick del bloque lo maneja). Mouse-first.
  const [drag, setDrag] = useState<{ x: number; y: number; laneId: string | null; chip: DropChip | null; name: string } | null>(null);
  const armRef = useRef<{ startX: number; startY: number; block: LaneBlock; laneId: string } | null>(null);
  const draggingRef = useRef(false); // ya cruzó el umbral → es drag, no tap
  const draggedRef = useRef(false);  // un drag acaba de terminar → traga el click siguiente
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const winRef = useRef(0);
  // Metadata reducida por carril + piso "ahora", en refs para el resolvedor del
  // drag (corre en handlers de pointer, fuera del render). El arrastre ya NO usa los
  // chips sugeridos: calcula la hora del cursor y la snapea a 15 min reales (ver
  // resolveDragTarget) → suelta donde apuntás, no en el chip ralo más cercano.
  const laneMetaRef = useRef<
    Map<string, { availFrom: number; availTo: number; unavail: Interval[]; appts: { id: string; start: number; dur: number; name: string }[] }>
  >(new Map());
  const floorRef = useRef<number>(-Infinity);
  const moveRef = useRef<MoveState | null>(null);
  useEffect(() => { moveRef.current = move; }, [move]);

  // Salir del modo mover limpia también la confirmación pendiente y el ghost.
  useEffect(() => {
    if (!move) {
      setPendingOverlap(null);
      setDrag(null);
      draggingRef.current = false;
      if (panRef.current) { clearInterval(panRef.current); panRef.current = null; }
    }
  }, [move]);

  // Localizar el ancestro scrollable (para el auto-scroll vertical durante el drag).
  useEffect(() => {
    let n: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (n) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') { scrollParentRef.current = n; break; }
      n = n.parentElement;
    }
    return () => { if (panRef.current) { clearInterval(panRef.current); panRef.current = null; } };
  }, []);

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

  // Reacomodo desde la COLA (tarjeta de atrasado) → levanta la cita en el panorama:
  // entra al MISMO gesto click-to-place, no hay segunda lógica de mover. One-shot: se
  // consume apenas entra en modo-mover (el MoveState ya lleva apptId/dur/nombre).
  useEffect(() => {
    if (rescheduleRequest && !move) {
      setMove({
        kind: 'reschedule',
        apptId: rescheduleRequest.apptId,
        fromLaneId: rescheduleRequest.fromLaneId,
        dur: rescheduleRequest.dur,
        name: rescheduleRequest.name,
        service: rescheduleRequest.service,
      });
      onRescheduleConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescheduleRequest]);

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
  useEffect(() => { winRef.current = win; }, [win]);

  const nowPct = nowMin !== null ? pctOf(nowMin) : -1;
  const nowInWin = isToday && nowPct >= 0 && nowPct <= 100;

  const ticks: number[] = [];
  for (let m = Math.ceil(win / 30) * 30; m <= win + WIN + 0.1; m += 30) ticks.push(m);

  const atStart = win <= dayStart;
  const atEnd = win >= maxWinStart;
  const offNow = isToday && win !== defaultStart;

  // Durante un arrastre activo, el carril muestra chips FINOS de 15 min (decisión B)
  // para que lo que ves coincida con dónde cae el drop (que snapea a 15). El tap-tap
  // fuera del arrastre respeta el toggle Sugeridas/Cada-15 sin cambios.
  const dragging = drag !== null;

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
    const available = availableIntervals(lane.unavail, domainStart, domainEnd);

    // Citas para clasificar solape. En reacomodo se excluye la cita levantada;
    // en walk-in no hay cita propia que excluir.
    const excludeId = move.kind === 'reschedule' ? move.apptId : null;
    const appts = lane.blocks.filter((b) => b.id !== excludeId);

    const chips: DropChip[] = [];
    for (const av of available) {
      const last = av.end - dur; // último inicio donde el servicio cabe en el tiempo disponible
      if (last < av.start - 0.5) continue;
      const starts = fineMode || dragging ? fineStarts(av.start, av.end, dur) : suggestedStarts(av.start, av.end, dur);
      for (const s of starts) {
        if (s > last + 0.5) continue;
        const p = pctOf(s);
        if (p < 0 || p > 100) continue;
        // ¿solaparía alguna cita? (toma el solape mayor para el aviso)
        const { min: overlapMin, name: overlapName } = overlapAt(s, dur, appts);
        chips.push({ min: s, soft: overlapMin > 0, overlapMin, overlapName });
      }
    }
    return chips;
  }

  // Mapa laneId → chips: fuente de los botones de destino (tap-tap). Con fineMode o
  // durante un arrastre → chips de 15 min. Solo se calcula durante un gesto.
  const dropsByLane = useMemo(() => {
    const m = new Map<string, DropChip[]>();
    if (move) for (const lane of lanes) m.set(lane.staff.id, laneDrops(lane));
    return m;
    // laneDrops depende de move/fineMode/dragging/win/lanes/nowMin/isToday.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move, fineMode, dragging, win, lanes, nowMin, isToday]);

  // Metadata por carril para el resolvedor del drag (misma aritmética que laneDrops:
  // turno − descanso − bloqueos + citas para el solape). Se refresca con los carriles.
  useEffect(() => {
    const m = new Map<string, { availFrom: number; availTo: number; unavail: Interval[]; appts: { id: string; start: number; dur: number; name: string }[] }>();
    for (const lane of lanes) {
      m.set(lane.staff.id, {
        availFrom: lane.availFrom,
        availTo: lane.availTo,
        unavail: lane.unavail,
        appts: lane.blocks.map((b) => ({ id: b.id, start: b.start, dur: b.dur, name: b.name })),
      });
    }
    laneMetaRef.current = m;
    floorRef.current = isToday && nowMin !== null ? nowMin : -Infinity;
  }, [lanes, isToday, nowMin]);

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

  // ── Drag: resuelve el destino DONDE APUNTA EL CURSOR (no el chip ralo cercano) ──
  // Carril bajo el cursor (por Y). Hora = posición X del cursor, snapeada a 15 min
  // reales (:00/:15/:30/:45). Se valida contra el tiempo físicamente disponible del
  // carril (turno − descanso − bloqueos): si el cursor cae en tiempo DURO (fuera de
  // turno / descanso / bloqueo) → sin destino (cancela). Dentro de un hueco, se
  // clampea al último inicio de 15 min donde cabe la duración (soltar "al final" sin
  // rebote). El solape con otra cita NO es duro → chip ámbar (mismo ⚠ "Encajar igual").
  function resolveDragTarget(x: number, y: number): { laneId: string; chip: DropChip | null } | null {
    const m = moveRef.current;
    if (!m) return null;
    const dur = m.dur;
    for (const [laneId, el] of trackRefs.current) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const meta = laneMetaRef.current.get(laneId);
      if (!meta) return { laneId, chip: null };

      const domainStart = Math.max(meta.availFrom, floorRef.current);
      const available = availableIntervals(meta.unavail, domainStart, meta.availTo);

      // Hora bajo el cursor (X) dentro de la ventana visible.
      const clampedX = Math.max(r.left, Math.min(r.right, x));
      const cursorMin = winRef.current + ((clampedX - r.left) / r.width) * WIN;

      // Hueco disponible que contiene la hora del cursor. Si ninguno → tiempo DURO.
      const iv = available.find((a) => cursorMin >= a.start - 0.5 && cursorMin <= a.end + 0.5);
      if (!iv) return { laneId, chip: null };

      const lastStart = iv.end - dur; // último inicio donde cabe la duración
      if (lastStart < iv.start - 0.5) return { laneId, chip: null }; // hueco más chico que el servicio

      // Snap a 15 min reales, clampeado al rango [primer 15-grid ≥ inicio, último que cabe].
      const lo = Math.ceil((iv.start - 0.5) / 15) * 15;
      const hi = Math.floor((lastStart + 0.5) / 15) * 15;
      let targetMin: number;
      if (lo > hi) {
        // El hueco es tan chico que no hay marca de 15 min que quepa → usa el inicio real.
        targetMin = iv.start;
      } else {
        const snapped = Math.round(cursorMin / 15) * 15;
        targetMin = Math.min(Math.max(snapped, lo), hi);
      }

      // Solape (blando) contra las otras citas del carril (excluye la levantada).
      const excludeId = m.kind === 'reschedule' ? m.apptId : null;
      const appts = meta.appts.filter((b) => b.id !== excludeId);
      const { min: overlapMin, name: overlapName } = overlapAt(targetMin, dur, appts);
      return { laneId, chip: { min: targetMin, soft: overlapMin > 0, overlapMin, overlapName } };
    }
    return null;
  }

  function panBy(delta: number) {
    setWinStart((prev) => {
      const base = prev ?? defaultStart;
      return Math.max(dayStart, Math.min(maxWinStart, base + delta));
    });
  }

  // Cada tick lee la última posición del cursor: cerca del borde izq/der → navega
  // la ventana 3h; cerca del borde sup/inf del scroll → desplaza los carriles.
  function panTick() {
    const p = lastPointerRef.current;
    if (!p) return;
    const anyTrack = trackRefs.current.values().next().value as HTMLDivElement | undefined;
    if (anyTrack) {
      const r = anyTrack.getBoundingClientRect();
      if (p.x < r.left + EDGE_ZONE) panBy(-NAV_STEP);
      else if (p.x > r.right - EDGE_ZONE) panBy(NAV_STEP);
    }
    const sc = scrollParentRef.current;
    if (sc && sc.scrollHeight > sc.clientHeight) {
      const r = sc.getBoundingClientRect();
      if (p.y < r.top + EDGE_ZONE) sc.scrollBy({ top: -64 });
      else if (p.y > r.bottom - EDGE_ZONE) sc.scrollBy({ top: 64 });
    }
  }

  function onDragMove(ev: PointerEvent) {
    const arm = armRef.current;
    if (!arm) return;
    lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
    if (!draggingRef.current) {
      const dx = ev.clientX - arm.startX;
      const dy = ev.clientY - arm.startY;
      if (dx * dx + dy * dy < DRAG_THRESH * DRAG_THRESH) return; // aún es un click potencial
      // Cruzó el umbral → levanta la cita (mismo `move` del gesto) y arranca el pan.
      draggingRef.current = true;
      draggedRef.current = true;
      setMove({
        kind: 'reschedule',
        apptId: arm.block.id,
        fromLaneId: arm.laneId,
        dur: arm.block.dur,
        name: arm.block.name,
        service: arm.block.service,
      });
      if (!panRef.current) panRef.current = setInterval(panTick, 450);
    }
    const target = resolveDragTarget(ev.clientX, ev.clientY);
    setDrag({ x: ev.clientX, y: ev.clientY, laneId: target?.laneId ?? null, chip: target?.chip ?? null, name: arm.block.name });
  }

  function onDragUp(ev: PointerEvent) {
    const wasDragging = draggingRef.current;
    armRef.current = null;
    draggingRef.current = false;
    if (panRef.current) { clearInterval(panRef.current); panRef.current = null; }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    if (!wasDragging) return; // fue un tap → el onClick del bloque lo maneja
    const target = resolveDragTarget(ev.clientX, ev.clientY);
    setDrag(null);
    // `move`/`onPlace` en vivo vía refs: el closure de doDrop cerró sobre el `move`
    // del render que armó el drag (null) → replicamos su lógica con el estado actual.
    const m = moveRef.current;
    if (target?.chip && m && onPlace) {
      if (target.chip.soft) {
        setPendingOverlap({ laneId: target.laneId, chip: target.chip }); // solape → confirmación consciente
      } else {
        onPlace(m, target.laneId, target.chip.min);
        setMove(null);
      }
    } else {
      setMove(null); // soltó en un lugar sin destino válido → cancela
    }
  }

  // mousedown sobre una cita movible: arma el gesto (aún no pasa nada) y engancha
  // los listeners de ventana. draggedRef se limpia acá → cada interacción parte fresca.
  function armDrag(ev: ReactPointerEvent, block: LaneBlock, laneId: string) {
    if (ev.button !== 0) return; // solo botón primario
    draggedRef.current = false;
    draggingRef.current = false;
    armRef.current = { startX: ev.clientX, startY: ev.clientY, block, laneId };
    lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }

  return (
    <div ref={rootRef} className="min-w-0 select-none">
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
            const drops = dropsByLane.get(s.id) ?? [];
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
                  ref={(el) => {
                    if (el) trackRefs.current.set(s.id, el);
                    else trackRefs.current.delete(s.id);
                  }}
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
                    // Conexión viva: resalte al hacer hover en su tarjeta de la cola
                    // (solo fuera del gesto, para no encimar dos señales visuales).
                    const highlighted = !move && highlightApptId === b.id;
                    // Movible solo fuera de un walk-in en curso (no se levanta una cita
                    // mientras se coloca un walk-in).
                    const interactive = canMove && b.movable && (!move || lifted);
                    return (
                      <div
                        key={b.id}
                        onPointerDown={interactive ? (e) => armDrag(e, b, s.id) : undefined}
                        onClick={
                          interactive
                            ? () => {
                                // Un drag acaba de terminar → traga este click sintético.
                                if (draggedRef.current) { draggedRef.current = false; return; }
                                if (lifted) setMove(null);
                                else
                                  setMove({
                                    kind: 'reschedule',
                                    apptId: b.id,
                                    fromLaneId: s.id,
                                    dur: b.dur,
                                    name: b.name,
                                    service: b.service,
                                  });
                              }
                            : undefined
                        }
                        role={interactive ? 'button' : undefined}
                        aria-label={interactive ? `Mover cita de ${b.name}` : undefined}
                        className={`absolute inset-y-0 overflow-hidden border border-line ${st.bg} shadow-card transition-all ${
                          b.state === 'late' && !move ? 'animate-data-beat motion-reduce:animate-none' : ''
                        } ${interactive ? 'cursor-pointer' : ''} ${
                          lifted ? 'z-20 -translate-y-1 shadow-hero ring-2 ring-ink' : ''
                        } ${highlighted ? 'z-20 ring-2 ring-teal-border shadow-hero' : ''} ${
                          b.approvedOverlap && !lifted ? 'ring-2 ring-amber-border' : ''
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
                          // El gesto de arrastre es dueño del touch en tablet (sin
                          // pelear con scroll/selección nativos); las no-movibles no.
                          touchAction: interactive ? 'none' : undefined,
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

                  {/* Chips de destino (gesto): teal = limpio · ámbar = solaparía (forzable).
                      Durante el drag, el chip bajo el cursor se resalta ("va a caer acá"). */}
                  {move &&
                    drops.map((chip) => {
                      const isTarget = drag?.laneId === s.id && drag?.chip?.min === chip.min;
                      return (
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
                          } ${isTarget ? 'z-40 scale-110 shadow-hero ring-2 ring-ink' : ''}`}
                          style={{ left: `${pctOf(chip.min)}%` }}
                        >
                          {chip.soft && <span aria-hidden>⚠ </span>}
                          {fmtMin(chip.min).replace(' AM', '').replace(' PM', '')}
                        </button>
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

      {/* Ghost del drag: sigue al cursor con la hora/barbero destino y el aviso de solape. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded-[8px] border border-ink bg-card px-2.5 py-1.5 text-[11px] font-semibold shadow-hero"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          <span className="text-ink">{drag.name}</span>
          {drag.chip ? (
            <span className={drag.chip.soft ? 'text-amber' : 'text-teal-ink'}>
              {' → '}
              <span className="tabular-nums">
                {fmtMin(drag.chip.min).replace(' AM', '').replace(' PM', '')}
              </span>
              {drag.chip.soft && ` · ⚠ se encima ${drag.chip.overlapMin}m`}
            </span>
          ) : (
            <span className="text-faint"> · suelta en un carril</span>
          )}
        </div>
      )}
    </div>
  );
}
