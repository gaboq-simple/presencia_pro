// ─── HeroCard ────────────────────────────────────────────────────────────────
// El hero de la pestaña Hoy: la tarjeta del cliente que el barbero tiene ENFRENTE,
// con sus acciones bajo el pulgar. Se condensa a una barra fina al scrollear.
//
// Estados (lógica determinista, ver selectHero abajo):
//   · serving  — hay una cita cuyo horario contiene el ahora → "En curso" +
//                "Empezó hace X · te quedan Y". Botones: Terminó / No vino.
//   · overdue  — no hay ninguna en curso, pero hay una cuyo horario YA PASÓ y sigue
//                sin cerrar (el barbero no marcó) → "¿Terminó?" + "Debía terminar
//                hace X". Botones: Terminó / No vino. NO se salta: perderla es
//                perder la cita sin registrar (decisión del Paso 3).
//   · upcoming — ni en curso ni sin cerrar, pero hay una próxima → "Sigue" +
//                "Llega en Z". Botones: Llegó / No vino.
//   · empty    — nada → invitación, NO una card muerta.
//
// El "ahora" sale de la TZ del NEGOCIO (nowLocalMinutes), no del navegador. Los
// relativos se calculan contra el horario PROGRAMADO (ends_at) — no hay completed_at
// todavía (llega en el Paso 6). Las acciones reusan los server actions existentes.

'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import { completeAppointment, noShowAppointment, markArrived } from '@/app/staff/assistant-actions';

// ─── Helpers de tiempo (mismo patrón que DayBar) ──────────────────────────────

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

function minutesToHHMM(min: number): string {
  const h = Math.floor((min / 60) % 24);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatRel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} h` : `${h} h ${mm} min`;
}

// ─── Selección determinista del cliente del hero ──────────────────────────────

type HeroMode = 'serving' | 'overdue' | 'upcoming' | 'empty';
type WithMin = { appt: DashboardAppointment; startMin: number; endMin: number };
type HeroSel = { mode: HeroMode; item?: WithMin };

const ACTIVE = new Set(['pending', 'confirmed', 'walkin']);

/**
 * Regla de prioridad: en-curso > sin-cerrar(pasada) > próxima > vacío.
 * Ante SOLAPAMIENTO (dos citas activas que contienen el ahora — no debería, pero un
 * walk-in mal encajado puede) se elige la de `starts_at` MÁS TEMPRANO (la que empezó
 * primero / lleva más esperando); desempate por id → determinista.
 */
export function selectHero(appointments: DashboardAppointment[], nowMin: number, timezone: string): HeroSel {
  const active: WithMin[] = appointments
    .filter((a) => ACTIVE.has(a.status))
    .map((a) => {
      const startMin = isoToLocalMinutes(a.starts_at, timezone);
      const durationMin = Math.max(
        1, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000,
      );
      return { appt: a, startMin, endMin: startMin + durationMin };
    });

  const byStartThenId = (x: WithMin, y: WithMin) =>
    x.startMin - y.startMin || x.appt.id.localeCompare(y.appt.id);

  const inProgress = active.filter((x) => x.startMin <= nowMin && nowMin < x.endMin).sort(byStartThenId);
  if (inProgress[0]) return { mode: 'serving', item: inProgress[0] };

  // Pasada sin cerrar: su horario ya terminó pero sigue activa (no la salta).
  const overdue = active.filter((x) => x.endMin <= nowMin).sort(byStartThenId);
  if (overdue[0]) return { mode: 'overdue', item: overdue[0] };

  const upcoming = active.filter((x) => x.startMin > nowMin).sort(byStartThenId);
  if (upcoming[0]) return { mode: 'upcoming', item: upcoming[0] };

  return { mode: 'empty' };
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: DashboardAppointment[];
  timezone: string;
  onMutated: () => void;                              // refresh tras acción
  onRegister: () => void;                             // abre "+ Nueva cita" (estado vacío)
  onHeroAppointmentChange?: (id: string | null) => void; // para la referencia en el hilo
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HeroCard({ appointments, timezone, onMutated, onRegister, onHeroAppointmentChange }: Props) {
  const [nowMin, setNowMin] = useState<number>(() => nowLocalMinutes(timezone));
  useEffect(() => {
    const update = () => setNowMin(nowLocalMinutes(timezone));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  // Condensado al scrollear (barra fina) — pinned cuando scrollY > 56px.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const onScroll = () => setPinned(window.scrollY > 56);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const sel = selectHero(appointments, nowMin, timezone);
  const heroId = sel.item?.appt.id ?? null;

  // Reporta al padre qué cita ocupa el hero (para que el hilo la muestre como
  // referencia y no duplicada). Solo cuando cambia.
  const lastReported = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastReported.current !== heroId) {
      lastReported.current = heroId;
      onHeroAppointmentChange?.(heroId);
    }
  }, [heroId, onHeroAppointmentChange]);

  function run(action: (id: string) => Promise<{ error?: string } | void>, id: string, failMsg: string) {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await action(id);
        if (res?.error) { setActionError(res.error); return; }
        onMutated();
      } catch {
        setActionError(failMsg);
      }
    });
  }

  // ── Estado vacío ────────────────────────────────────────────────────────────
  if (sel.mode === 'empty') {
    return (
      <div className="rounded-card border border-line border-l-4 border-l-teal-border bg-card px-4 py-4 shadow-card">
        <p className="text-sm font-semibold text-ink">Tu día está abierto</p>
        <p className="mt-1 text-xs text-ink-2">
          Cuando alguien agende por WhatsApp lo vas a ver acá.
        </p>
        <button
          onClick={onRegister}
          className="mt-3 min-h-[44px] w-full rounded-xl border border-line bg-card px-4 text-sm font-semibold text-teal-ink hover:bg-tint-1 active:bg-tint-2"
        >
          Registrar a alguien
        </button>
      </div>
    );
  }

  const { appt, startMin, endMin } = sel.item!;
  const name = appt.customer?.name ?? 'Cliente';
  const serviceName = appt.service?.name ?? '';

  // Pill + subtítulo relativo por estado (contra el horario PROGRAMADO).
  let pill: string;
  let pillClass: string;
  let relative: string;
  if (sel.mode === 'serving') {
    pill = 'En curso';
    pillClass = 'bg-tint-1 text-teal-ink';
    relative = `Empezó hace ${formatRel(nowMin - startMin)} · te quedan ${formatRel(endMin - nowMin)}`;
  } else if (sel.mode === 'overdue') {
    pill = '¿Terminó?';
    pillClass = 'bg-amber-tint text-amber';
    relative = `Debía terminar hace ${formatRel(nowMin - endMin)}`;
  } else {
    pill = 'Sigue';
    pillClass = 'bg-tint-1 text-teal-ink';
    relative = `Llega en ${formatRel(startMin - nowMin)}`;
  }

  // Botones por estado: serving/overdue = Terminó / No vino; upcoming = Llegó / No vino.
  const primary =
    sel.mode === 'upcoming'
      ? { label: 'Llegó', onClick: () => run(markArrived, appt.id, 'No se pudo marcar la llegada.') }
      : { label: 'Terminó', onClick: () => run(completeAppointment, appt.id, 'No se pudo completar la cita.') };
  const secondary = { label: 'No vino', onClick: () => run(noShowAppointment, appt.id, 'No se pudo marcar como no asistió.') };

  const btnH = pinned ? 'h-10' : 'h-[50px]';

  return (
    <div className="rounded-card border border-line border-l-4 border-l-teal-border bg-card px-4 py-3 shadow-card">
      <div className="flex items-center gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-[10.5px] font-semibold ${pillClass}`}>{pill}</span>
        {!pinned && (
          <span className="text-[11px] tabular-nums text-faint">
            {minutesToHHMM(startMin)}–{minutesToHHMM(endMin)}
          </span>
        )}
      </div>

      <p className={`mt-1 font-semibold leading-tight text-ink ${pinned ? 'text-base' : 'text-lg'}`}>{name}</p>

      {!pinned && (
        <>
          {serviceName && <p className="text-xs text-ink-2">{serviceName}</p>}
          <p className="mt-0.5 text-xs tabular-nums text-ink-2">{relative}</p>
        </>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={primary.onClick}
          disabled={isPending}
          className={`flex-1 ${btnH} rounded-xl bg-teal-ink text-sm font-semibold text-card transition hover:opacity-90 active:opacity-80 disabled:opacity-50`}
        >
          {primary.label}
        </button>
        <button
          onClick={secondary.onClick}
          disabled={isPending}
          className={`flex-1 ${btnH} rounded-xl border border-line bg-card text-sm font-semibold text-ink-2 transition hover:bg-past-bg active:bg-past-line disabled:opacity-50`}
        >
          {secondary.label}
        </button>
      </div>

      {actionError && (
        <p className="mt-2 rounded-lg bg-red-tint px-3 py-1.5 text-xs text-red-ink">{actionError}</p>
      )}
    </div>
  );
}
