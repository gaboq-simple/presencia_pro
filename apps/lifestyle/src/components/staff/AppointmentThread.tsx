// ─── AppointmentThread ───────────────────────────────────────────────────────
// El hilo cronológico de la pestaña Hoy (Paso 4). Reemplaza a AssistantDayTimeline
// en la vista del barbero y cierra la brecha visual con la mesa del asistente:
// mismo lenguaje (border-left por estado, atenuar por TONO nunca por opacity, glow
// al hover, banda del ahora que respira).
//
//   · Cada cita = card con riel + punto a la izquierda y border-left del estado.
//   · Pasado atenuado por tono (past-bg/past-ink/past-line), sin velo gris.
//   · Banda del ahora: chip con hora (tabular-nums) + línea teal tenue (respira).
//   · La cita del hero va como REFERENCIA (↑ Nombre · arriba), no card completa.
//   · Swipe (pointer events, mouse+touch): derecha = Terminó, izquierda = No vino,
//     con fondo revelado, umbral, snap y toast con Deshacer (delay-commit: el server
//     action se dispara al cerrarse la ventana de Deshacer; deshacer = no se dispara).
//   · Tap en la card → ficha (AppointmentSheet) con las acciones secundarias
//     (Reagendar / Cancelar / Notas) + contacto (tel:/wa.me). Fallback accesible al
//     swipe: la ficha también tiene Terminó / No vino.
//
// Reusa los server actions existentes — no crea nuevos.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import type { DriftProjection } from '@/lib/dayDrift';
import { isTodayInTz } from '@/lib/dayWindow';
import { completeAppointment, noShowAppointment } from '@/app/staff/assistant-actions';
import AppointmentSheet, { type StaffOption } from './AppointmentSheet';

// ─── Estado visual (paridad con AssistantVerticalCalendar / la mesa) ──────────

type BlockState = 'conf' | 'pending' | 'curso' | 'late' | 'done' | 'noshow' | 'walk' | 'cancelled';

const STATE_STYLE: Record<BlockState, { bar: string; bg: string; ink: string; glow: string }> = {
  conf:      { bar: 'var(--color-teal-border)', bg: 'bg-card',      ink: 'text-ink',      glow: 'appt-glow-teal' },
  pending:   { bar: 'var(--color-amber-border)', bg: 'bg-amber-tint', ink: 'text-amber',  glow: 'appt-glow-amber' },
  curso:     { bar: 'var(--color-teal-border)', bg: 'bg-tint-1',    ink: 'text-teal-ink', glow: 'appt-glow-teal' },
  late:      { bar: 'var(--color-red-border)',  bg: 'bg-red-tint',  ink: 'text-red-ink',  glow: 'appt-glow-red' },
  done:      { bar: 'var(--color-past-line)',   bg: 'bg-past-bg',   ink: 'text-past-ink', glow: 'appt-glow-done' },
  noshow:    { bar: 'var(--color-red-border)',  bg: 'bg-red-tint',  ink: 'text-red-ink',  glow: 'appt-glow-red' },
  walk:      { bar: 'var(--color-walk-border)', bg: 'bg-walk-tint', ink: 'text-walk',     glow: 'appt-glow-walk' },
  cancelled: { bar: 'var(--color-past-line)',   bg: 'bg-past-bg',   ink: 'text-past-faint', glow: 'appt-glow-done' },
};

const STATE_WORD: Partial<Record<BlockState, string>> = {
  curso: 'En curso', late: 'Sin cerrar', noshow: 'No vino', pending: 'Por confirmar',
  done: 'Hecha', walk: 'Walk-in', cancelled: 'Cancelada',
};

// Estado que admite swipe/acciones (activo, no resuelto).
const SWIPEABLE = new Set<BlockState>(['conf', 'pending', 'curso', 'late', 'walk']);

// ─── Helpers de tiempo (tz del negocio, como DayBar/HeroCard) ─────────────────

function isoToLocalMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return (h === 24 ? 0 : h) * 60 + m;
}
function nowLocalMinutes(tz: string): number { return isoToLocalMinutes(new Date().toISOString(), tz); }
function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function stateOf(a: DashboardAppointment, nowM: number | null, tz: string): BlockState {
  if (a.status === 'cancelled') return 'cancelled';
  if (a.status === 'completed') return 'done';
  if (a.status === 'no_show') return 'noshow';
  if (a.status === 'walkin' || a.source === 'walkin') return 'walk';
  const startM = isoToLocalMinutes(a.starts_at, tz);
  const endM = startM + Math.max(1, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000);
  if (nowM !== null && startM <= nowM && nowM < endM) return 'curso';
  if (nowM !== null && nowM >= endM) return 'late';
  if (a.status === 'pending') return 'pending';
  return 'conf';
}

// ─── Config swipe ──────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 96;   // px de arrastre para gatillar
const UNDO_MS = 5000;         // ventana de Deshacer antes de commitear

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
  date: string;
  timezone: string;
  staffOptions: StaffOption[];
  heroAppointmentId?: string | null;
  onMutated: () => void;
  /** El día se corrió (Paso 6): id → proyección. La card muestra la hora vieja
      tachada y la proyectada al lado. Ya filtradas por el umbral. */
  projections?: Map<string, DriftProjection>;
};

type PendingAction = { id: string; kind: 'completed' | 'no_show'; label: string; timer: ReturnType<typeof setTimeout> };

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppointmentThread({ appointments, date, timezone, staffOptions, heroAppointmentId, onMutated, projections }: Props) {
  const [nowMin, setNowMin] = useState<number | null>(() => (isTodayInTz(date, timezone) ? nowLocalMinutes(timezone) : null));
  const [prevKey, setPrevKey] = useState(`${date}|${timezone}`);
  const key = `${date}|${timezone}`;
  if (prevKey !== key) { setPrevKey(key); if (!isTodayInTz(date, timezone)) setNowMin(null); }
  useEffect(() => {
    if (!isTodayInTz(date, timezone)) return;
    const update = () => setNowMin(nowLocalMinutes(timezone));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [date, timezone]);

  // Ficha abierta (tap en una card)
  const [sheetAppt, setSheetAppt] = useState<DashboardAppointment | null>(null);

  // Delay-commit del swipe: optimista local + toast Deshacer; el server action se
  // dispara al expirar la ventana. Un solo pendiente por vez (el más reciente).
  const [pending, setPending] = useState<PendingAction | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const onMutatedRef = useRef(onMutated);
  useEffect(() => { onMutatedRef.current = onMutated; });

  const commit = useCallback((p: PendingAction) => {
    const action = p.kind === 'completed' ? completeAppointment : noShowAppointment;
    void action(p.id).then(() => onMutatedRef.current());
  }, []);
  function flushPending() {
    const p = pendingRef.current;
    if (p) { clearTimeout(p.timer); commit(p); setPending(null); }
  }
  // Al desmontar, no perder el pendiente: commitea.
  useEffect(() => () => { const p = pendingRef.current; if (p) { clearTimeout(p.timer); commit(p); } }, [commit]);

  function triggerSwipe(appt: DashboardAppointment, kind: 'completed' | 'no_show') {
    flushPending(); // si había otro pendiente, commitealo antes de encolar el nuevo
    const label = kind === 'completed' ? 'Terminó' : 'No vino';
    const timer = setTimeout(() => {
      const p = pendingRef.current;
      if (p) { commit(p); setPending(null); }
    }, UNDO_MS);
    setPending({ id: appt.id, kind, label, timer });
  }
  function undo() {
    const p = pendingRef.current;
    if (p) { clearTimeout(p.timer); setPending(null); }
  }

  // ── Orden + índice de la banda "Ahora" (entre última pasada y primera futura) ─
  const sorted = [...appointments].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  let nowSplitIndex: number | null = null;
  if (nowMin !== null) {
    let lastPast = -1;
    for (let i = 0; i < sorted.length; i++) {
      const endM = isoToLocalMinutes(sorted[i]!.ends_at, timezone);
      if (endM <= nowMin) lastPast = i;
    }
    if (lastPast >= 0 && lastPast < sorted.length - 1) nowSplitIndex = lastPast;
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-card px-4 py-8 text-center">
        <p className="text-sm text-ink-2">Sin citas para este día.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="px-1 pb-2 text-xs font-medium text-faint">
        Agenda del día · {sorted.length} {sorted.length === 1 ? 'cita' : 'citas'}
      </p>

      <div className="relative">
        {/* Riel vertical del hilo */}
        <div className="absolute bottom-2 left-[7px] top-2 w-px bg-line" aria-hidden="true" />

        <div className="space-y-2">
          {sorted.map((appt, idx) => {
            // Estado — con override optimista del pendiente (delay-commit).
            const isPendingHere = pending?.id === appt.id;
            const baseState = stateOf(appt, nowMin, timezone);
            const state: BlockState = isPendingHere ? (pending!.kind === 'completed' ? 'done' : 'noshow') : baseState;
            const style = STATE_STYLE[state];
            const isRef = appt.id === heroAppointmentId;

            return (
              <div key={appt.id} id={`cita-${appt.id}`} className="scroll-mt-64">
                {/* Banda del ahora — chip + línea teal tenue (respira), como la mesa */}
                {nowSplitIndex === idx && (
                  <div className="flex items-center gap-2 py-2 pl-6">
                    <span className="animate-data-beat rounded-pill bg-tint-1 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-teal-ink">
                      Ahora · {nowMin !== null ? `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}` : ''}
                    </span>
                    <span className="h-px flex-1 bg-teal-border/30" />
                  </div>
                )}

                <div className="relative flex items-stretch gap-3">
                  {/* Punto del riel (color del estado) */}
                  <span
                    className="relative z-[1] mt-4 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-card"
                    style={{ backgroundColor: style.bar }}
                    aria-hidden="true"
                  />

                  {isRef ? (
                    // Referencia: la cita del hero ya está arriba — no se duplica.
                    <button
                      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      className="flex flex-1 items-center gap-2 rounded-card border border-dashed border-line bg-tint-1 px-3 py-2.5 text-left text-xs font-medium text-teal-ink"
                    >
                      <span aria-hidden="true">↑</span>
                      <span className="truncate">{appt.customer?.name ?? 'Cliente'} · lo tenés arriba</span>
                    </button>
                  ) : (
                    <SwipeCard
                      appt={appt}
                      state={state}
                      style={style}
                      timezone={timezone}
                      swipeable={SWIPEABLE.has(state) && !isPendingHere}
                      projection={projections?.get(appt.id)}
                      onOpen={() => setSheetAppt(appt)}
                      onSwipeRight={() => triggerSwipe(appt, 'completed')}
                      onSwipeLeft={() => triggerSwipe(appt, 'no_show')}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Toast con Deshacer (delay-commit) */}
      {pending && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 px-4">
          <div className="flex flex-1 items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-card shadow-card">
            <span>{pending.label} — {sorted.find((a) => a.id === pending.id)?.customer?.name ?? 'cita'}</span>
            <button onClick={undo} className="shrink-0 font-semibold text-tint-2 underline">Deshacer</button>
          </div>
        </div>
      )}

      {/* Ficha (tap en una card) */}
      {sheetAppt && (
        <AppointmentSheet
          appt={sheetAppt}
          date={date}
          timezone={timezone}
          staffOptions={staffOptions}
          onClose={() => setSheetAppt(null)}
          onMutated={() => { setSheetAppt(null); onMutated(); }}
        />
      )}
    </div>
  );
}

// ─── SwipeCard ─────────────────────────────────────────────────────────────────

function SwipeCard({
  appt, state, style, timezone, swipeable, projection, onOpen, onSwipeRight, onSwipeLeft,
}: {
  appt: DashboardAppointment;
  state: BlockState;
  style: { bar: string; bg: string; ink: string; glow: string };
  timezone: string;
  swipeable: boolean;
  projection?: DriftProjection;
  onOpen: () => void;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const moved = useRef(false);
  const activeId = useRef<number | null>(null);
  const dxRef = useRef(0);  // fuente de verdad del arrastre (ref → no depende del flush del estado)

  function onPointerDown(e: React.PointerEvent) {
    if (!swipeable) return;
    activeId.current = e.pointerId;
    startX.current = e.clientX;
    moved.current = false;
    dxRef.current = 0;
    setDragging(true);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer sintético */ }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (activeId.current !== e.pointerId) return;   // gate por ref (síncrono), no por estado
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > 4) moved.current = true;
    dxRef.current = delta;
    setDx(delta);
  }
  function endDrag(e: React.PointerEvent) {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    setDragging(false);
    const delta = dxRef.current;
    dxRef.current = 0;
    setDx(0);
    if (delta >= SWIPE_THRESHOLD) onSwipeRight();
    else if (delta <= -SWIPE_THRESHOLD) onSwipeLeft();
  }

  const name = appt.customer?.name ?? 'Cliente';
  const word = STATE_WORD[state];
  // Distintivo "Ya está acá": arrived_at seteado y la cita aún activa (en las
  // resueltas — done/noshow/cancelled — ya no aporta).
  const arrived = !!appt.arrived_at && state !== 'done' && state !== 'noshow' && state !== 'cancelled';
  const revealRight = dx > 8;  // arrastre a la derecha → Terminó (fondo teal a la izquierda)
  const revealLeft = dx < -8;  // arrastre a la izquierda → No vino (fondo rojo a la derecha)

  return (
    <div className="relative flex-1 overflow-hidden rounded-card">
      {/* Fondos revelados al arrastrar */}
      {swipeable && (
        <>
          <div className={`absolute inset-y-0 left-0 flex items-center gap-1.5 rounded-card bg-teal-ink px-4 text-xs font-semibold text-card transition-opacity ${revealRight ? 'opacity-100' : 'opacity-0'}`}>
            ✓ Terminó
          </div>
          <div className={`absolute inset-y-0 right-0 flex items-center gap-1.5 rounded-card bg-red-ink px-4 text-xs font-semibold text-card transition-opacity ${revealLeft ? 'opacity-100' : 'opacity-0'}`}>
            No vino ✕
          </div>
        </>
      )}

      {/* La card */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => { if (!moved.current) onOpen(); }}
        style={{ borderLeftColor: style.bar, transform: `translateX(${dx}px)`, touchAction: 'pan-y' }}
        className={`appt-hover ${style.glow} relative flex w-full items-center gap-3 rounded-card border border-l-4 border-line ${style.bg} px-3 py-3 text-left ${dragging ? '' : 'transition-transform'}`}
      >
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${style.ink}`}>{name}</p>
          <p className={`truncate text-xs ${state === 'done' || state === 'cancelled' ? 'text-past-faint' : 'text-ink-2'}`}>
            {appt.service?.name ?? ''}
          </p>
          {/* "Ya está acá": arrived_at seteado (recepción o barbero) en una cita aún
              activa. Es un atributo (no un estado) → la card mantiene su tono. */}
          {arrived && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-pill bg-teal-ink px-2 py-0.5 text-[10px] font-semibold text-card">
              <span className="h-1.5 w-1.5 rounded-full bg-card" aria-hidden="true" />
              Ya está acá
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          {/* El día se corrió (Paso 6): hora vieja tachada + la proyectada. Tono
              neutro — la proyección es un dato, no una alarma. */}
          {projection ? (
            <p className={`text-sm tabular-nums ${style.ink}`}>
              <span className="mr-1.5 text-past-faint line-through">{hhmm(appt.starts_at, timezone)}</span>
              {hhmm(new Date(projection.projectedStartMs).toISOString(), timezone)}
            </p>
          ) : (
            <p className={`text-sm tabular-nums ${style.ink}`}>{hhmm(appt.starts_at, timezone)}</p>
          )}
          {word && <p className={`text-[10.5px] font-semibold ${style.ink}`}>{word}</p>}
        </div>
      </button>
    </div>
  );
}
