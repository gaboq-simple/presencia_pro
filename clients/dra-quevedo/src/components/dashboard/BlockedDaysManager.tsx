'use client';

// ─── BlockedDaysManager ────────────────────────────────────────────────────────
// Monthly calendar that lets the doctor block or unblock full days.
// Exclusive to the `medical` profile — rendered only after isMedical() check
// in the consuming Server Component.
//
// Visual states per day:
//   blocked      — red background, tooltip with reason if set
//   has_appts    — green background, not interactive
//   available    — white background, clickable → block
//   past         — 40% opacity, not interactive
//   empty        — padding cell (start/end of month)
//
// Confirmation: clicking a day sets pendingDay; an inline bar appears.
// The action fires only after the doctor taps "Confirmar".
//
// Data flow:
//   mount / month change → GET /api/schedule/blocked-days
//   block tap → POST /api/schedule/block-day
//   unblock tap → POST /api/schedule/unblock-day

import { useState, useEffect, useCallback, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BlockedDay = {
  date: string;   // 'YYYY-MM-DD'
  reason: string | null;
};

type PendingAction =
  | { type: 'block';   dateStr: string }
  | { type: 'unblock'; dateStr: string; reason: string | null };

type Props = {
  readonly specialistId: string;
  readonly timezone: string;
  /** Pre-fetched appointment dates for today's month (YYYY-MM-DD). Used to
   *  seed the initial green highlights without waiting for a round-trip. */
  readonly appointmentDates: readonly string[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DAY_HEADERS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'] as const;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Returns Monday-based column index (0=Mon … 6=Sun) for the 1st of the month. */
function firstDayOffset(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function todayStr(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function formatMonthLabel(year: number, month: number, locale = 'es-MX'): string {
  return new Date(year, month, 1).toLocaleDateString(locale, {
    month: 'long', year: 'numeric',
  });
}

function formatDayLabel(dateStr: string, locale = 'es-MX'): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function BlockedDaysManager({ specialistId, timezone, appointmentDates }: Props) {
  const today = todayStr(timezone);
  const [year, setYear]   = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth()); // 0-indexed

  const [blockedDays, setBlockedDays] = useState<BlockedDay[]>([]);
  const [loading, setLoading]         = useState(true);
  const [open, setOpen]               = useState(true);
  const [pending, setPending]         = useState<PendingAction | null>(null);
  const [isPending, startTransition]  = useTransition();
  const [error, setError]             = useState<string | null>(null);

  // ── Auth helper ─────────────────────────────────────────────────────────────

  const getAuthHeader = useCallback(async (): Promise<string> => {
    const supabase = createSupabaseBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session ? `Bearer ${session.access_token}` : '';
  }, []);

  // ── Fetch blocked days for current month ────────────────────────────────────

  const fetchBlockedDays = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuthHeader();
      const params = new URLSearchParams({
        specialistId,
        year:  String(y),
        month: String(m + 1), // API expects 1-indexed
      });
      const res = await fetch(`/api/schedule/blocked-days?${params.toString()}`, {
        headers: { Authorization: auth },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { dates: BlockedDay[] };
      setBlockedDays(body.dates);
    } catch (err) {
      setError('No se pudo cargar los días bloqueados.');
    } finally {
      setLoading(false);
    }
  }, [specialistId, getAuthHeader]);

  useEffect(() => {
    void fetchBlockedDays(year, month);
  }, [year, month, fetchBlockedDays]);

  // ── Month navigation ─────────────────────────────────────────────────────────

  function prevMonth() {
    setPending(null);
    setMonth((m) => {
      if (m === 0) { setYear((y) => y - 1); return 11; }
      return m - 1;
    });
  }

  function nextMonth() {
    setPending(null);
    setMonth((m) => {
      if (m === 11) { setYear((y) => y + 1); return 0; }
      return m + 1;
    });
  }

  // ── Day click ───────────────────────────────────────────────────────────────

  const blockedSet   = new Set(blockedDays.map((b) => b.date));
  const appointSet   = new Set(appointmentDates);

  function handleDayClick(dateStr: string) {
    if (dateStr <= today && dateStr !== today) return; // past — not interactive
    if (appointSet.has(dateStr) && !blockedSet.has(dateStr)) return; // has appts, not blocked

    if (pending?.dateStr === dateStr) {
      setPending(null); // toggle off
      return;
    }

    if (blockedSet.has(dateStr)) {
      const entry = blockedDays.find((b) => b.date === dateStr) ?? null;
      setPending({ type: 'unblock', dateStr, reason: entry?.reason ?? null });
    } else {
      setPending({ type: 'block', dateStr });
    }
  }

  // ── Confirm action ──────────────────────────────────────────────────────────

  function confirmAction() {
    if (!pending) return;
    const action = pending;

    startTransition(async () => {
      setError(null);
      try {
        const auth = await getAuthHeader();
        const url  = action.type === 'block'
          ? '/api/schedule/block-day'
          : '/api/schedule/unblock-day';

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ date: action.dateStr, specialistId }),
        });

        if (!res.ok) {
          const body = await res.json() as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        // Optimistic update
        if (action.type === 'block') {
          setBlockedDays((prev) => [...prev, { date: action.dateStr, reason: null }]);
        } else {
          setBlockedDays((prev) => prev.filter((b) => b.date !== action.dateStr));
        }

        setPending(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      }
    });
  }

  // ── Calendar grid ───────────────────────────────────────────────────────────

  const totalDays = daysInMonth(year, month);
  const offset    = firstDayOffset(year, month);
  const cells     = offset + totalDays;
  const totalCells = Math.ceil(cells / 7) * 7;

  function dayState(dateStr: string): 'blocked' | 'has_appts' | 'available' | 'past' {
    if (dateStr < today) return 'past';
    if (blockedSet.has(dateStr)) return 'blocked';
    if (appointSet.has(dateStr)) return 'has_appts';
    return 'available';
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const cellBase: React.CSSProperties = {
    width: '100%',
    aspectRatio: '1',
    borderRadius: '0.375rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'background 0.1s',
    border: 'none',
    padding: 0,
  };

  function cellStyle(state: ReturnType<typeof dayState>, dateStr: string): React.CSSProperties {
    const isPendingDay = pending?.dateStr === dateStr;

    if (state === 'past')      return { ...cellBase, opacity: 0.35, cursor: 'default', backgroundColor: 'transparent', color: 'var(--color-ink-muted)' };
    if (state === 'blocked')   return { ...cellBase, backgroundColor: isPendingDay ? '#FECACA' : '#FEE2E2', color: '#991B1B', cursor: 'pointer', outline: isPendingDay ? '2px solid #F87171' : 'none' };
    if (state === 'has_appts') return { ...cellBase, backgroundColor: '#DCFCE7', color: '#166534', cursor: 'default' };
    // available
    return { ...cellBase, backgroundColor: isPendingDay ? '#FEF9C3' : 'transparent', color: 'var(--color-ink)', cursor: 'pointer' };
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: '0.625rem',
        overflow: 'hidden',
        marginTop: '1.25rem',
      }}
    >
      {/* ── Section header (collapsible toggle) ─────────────────────────── */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1rem',
          backgroundColor: 'var(--color-surface)',
          border: 'none',
          borderBottom: open ? '1px solid var(--color-border)' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-ink)' }}>
          🗓 Días bloqueados
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '1rem', backgroundColor: 'var(--color-canvas)' }}>

          {/* ── Month navigation ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <button
              onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-ink-muted)', padding: '0.25rem 0.5rem' }}
              aria-label="Mes anterior"
            >
              ‹
            </button>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-ink)', textTransform: 'capitalize' }}>
              {formatMonthLabel(year, month)}
            </span>
            <button
              onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-ink-muted)', padding: '0.25rem 0.5rem' }}
              aria-label="Mes siguiente"
            >
              ›
            </button>
          </div>

          {/* ── Legend ───────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.875rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { color: '#FEE2E2', text: 'Bloqueado' },
              { color: '#DCFCE7', text: 'Con citas' },
              { color: '#F9FAFB', text: 'Disponible', border: '1px solid #E5E7EB' },
            ].map(({ color, text, border }) => (
              <span key={text} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>
                <span style={{ width: '0.75rem', height: '0.75rem', borderRadius: '0.2rem', backgroundColor: color, border, display: 'inline-block' }} />
                {text}
              </span>
            ))}
          </div>

          {/* ── Pending confirmation bar ──────────────────────────────────── */}
          {pending && (
            <div
              style={{
                backgroundColor: pending.type === 'block' ? '#FEF3C7' : '#FEE2E2',
                border: `1px solid ${pending.type === 'block' ? '#FDE68A' : '#FECACA'}`,
                borderRadius: '0.5rem',
                padding: '0.625rem 0.875rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
              }}
            >
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-ink)', flex: 1 }}>
                {pending.type === 'block'
                  ? `¿Bloquear ${formatDayLabel(pending.dateStr)}?`
                  : `¿Desbloquear ${formatDayLabel(pending.dateStr)}${pending.reason ? ` (${pending.reason})` : ''}?`}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setPending(null)}
                  disabled={isPending}
                  style={{ padding: '0.3125rem 0.625rem', background: 'none', border: '1px solid var(--color-border)', borderRadius: '0.25rem', fontSize: '0.8125rem', cursor: 'pointer', color: 'var(--color-ink-muted)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmAction}
                  disabled={isPending}
                  style={{
                    padding: '0.3125rem 0.625rem',
                    backgroundColor: pending.type === 'block' ? '#B45309' : '#991B1B',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '0.25rem',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isPending ? '…' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}

          {/* ── Error message ─────────────────────────────────────────────── */}
          {error && (
            <p style={{ margin: '0 0 0.625rem', fontSize: '0.8125rem', color: '#991B1B' }}>
              ⚠ {error}
            </p>
          )}

          {/* ── Calendar grid ─────────────────────────────────────────────── */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
              {DAY_HEADERS.map((h) => (
                <div key={h} style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-ink-muted)', padding: '0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} style={{ height: '2rem', borderRadius: '0.375rem', backgroundColor: 'var(--color-surface)', animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
              {/* Day-of-week headers */}
              {DAY_HEADERS.map((h) => (
                <div
                  key={h}
                  style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-ink-muted)', padding: '0.25rem 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  {h}
                </div>
              ))}

              {/* Calendar cells */}
              {Array.from({ length: totalCells }).map((_, i) => {
                const dayNum = i - offset + 1;
                const isInMonth = dayNum >= 1 && dayNum <= totalDays;

                if (!isInMonth) {
                  return <div key={i} />;
                }

                const dateStr = toDateStr(year, month, dayNum);
                const state   = dayState(dateStr);
                const isToday = dateStr === today;
                const blocked = blockedDays.find((b) => b.date === dateStr);

                return (
                  <button
                    key={dateStr}
                    onClick={() => handleDayClick(dateStr)}
                    disabled={state === 'past' || state === 'has_appts'}
                    title={
                      state === 'blocked'   ? `Bloqueado${blocked?.reason ? `: ${blocked.reason}` : ''}` :
                      state === 'has_appts' ? 'Hay citas — no se puede bloquear' :
                      state === 'past'      ? 'Día pasado' : 'Toca para bloquear'
                    }
                    style={{
                      ...cellStyle(state, dateStr),
                      boxShadow: isToday ? 'inset 0 0 0 2px var(--color-accent)' : 'none',
                    }}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
