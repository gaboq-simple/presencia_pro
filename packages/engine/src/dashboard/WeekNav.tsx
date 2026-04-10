'use client';

// ─── WeekNav ──────────────────────────────────────────────────────────────────
// Navigation bar for the weekly agenda view.
// Shows the week's date range in Spanish and buttons to move between weeks.
//
// Label format:
//   Same month : "14 – 20 de abril, 2025"
//   Cross-month: "28 abr – 4 may, 2025"

import React from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type WeekNavProps = {
  readonly weekStart: Date;   // always Monday (UTC midnight)
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6); // Sunday

  const startDay = weekStart.getUTCDate();
  const endDay   = weekEnd.getUTCDate();
  const year     = weekEnd.getUTCFullYear();

  const startMonthIdx = weekStart.getUTCMonth();
  const endMonthIdx   = weekEnd.getUTCMonth();

  if (startMonthIdx === endMonthIdx) {
    // "14 – 20 de abril, 2025"
    const monthName = weekStart.toLocaleDateString('es-MX', {
      month: 'long',
      timeZone: 'UTC',
    });
    return `${startDay} – ${endDay} de ${monthName}, ${year}`;
  }

  // "28 abr – 4 may, 2025"
  const startMonthAbbr = weekStart
    .toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' })
    .replace('.', '');
  const endMonthAbbr = weekEnd
    .toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' })
    .replace('.', '');

  return `${startDay} ${startMonthAbbr} – ${endDay} ${endMonthAbbr}, ${year}`;
}

// ─── WeekNav ───────────────────────────────────────────────────────────────────

export function WeekNav({ weekStart, onPrev, onNext, onToday }: WeekNavProps) {
  const label = formatWeekLabel(weekStart);

  const buttonBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.375rem 0.625rem',
    backgroundColor: 'transparent',
    color: 'var(--color-ink)',
    border: '1px solid var(--color-border)',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    lineHeight: 1,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '1rem',
      }}
    >
      {/* ── Prev ─────────────────────────────────────────────────── */}
      <button onClick={onPrev} title="Semana anterior" style={buttonBase} aria-label="Semana anterior">
        ←
      </button>

      {/* ── Label ────────────────────────────────────────────────── */}
      <p
        style={{
          flex: 1,
          margin: 0,
          textAlign: 'center',
          fontSize: '0.9375rem',
          fontWeight: 500,
          color: 'var(--color-ink)',
          fontFamily: 'var(--font-display)',
        }}
      >
        {label}
      </p>

      {/* ── Today ────────────────────────────────────────────────── */}
      <button onClick={onToday} style={buttonBase}>
        Hoy
      </button>

      {/* ── Next ─────────────────────────────────────────────────── */}
      <button onClick={onNext} title="Semana siguiente" style={buttonBase} aria-label="Semana siguiente">
        →
      </button>
    </div>
  );
}
