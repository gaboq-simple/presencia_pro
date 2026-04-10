'use client';

// ─── WeekView ─────────────────────────────────────────────────────────────────
// Renders a weekly grid of appointment cards — engine-level, client-agnostic.
// Base columns: Mon–Fri. Saturday and Sunday appear only when they have appointments.
//
// Each column renders AppointmentCard in compact mode.
// Extra actions (Modificar/Cancelar) are injected via renderExtraActions from
// the consuming client component.
//
// "Today" column is highlighted with a subtle accent background.

import React from 'react';
import { AppointmentCard } from './AppointmentCard';
import type { AppointmentWithPatient } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type WeekViewProps = {
  readonly weekStart: Date;   // always Monday (UTC midnight)
  readonly timezone: string;
  readonly appointments: readonly AppointmentWithPatient[];
  readonly renderExtraActions?: (appointment: AppointmentWithPatient) => React.ReactNode;
  /** Called after a successful action (used by the parent to trigger a refetch). */
  readonly onAppointmentUpdate: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Returns YYYY-MM-DD for a Date (UTC). Used as group keys. */
function toUtcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns YYYY-MM-DD for an appointment's startsAt in the given timezone. */
function toLocalDateKey(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

/** Abbreviated weekday in Spanish, capitalized. e.g. "Lun", "Mar", "Mié" */
function formatWeekdayAbbrev(date: Date): string {
  const raw = date.toLocaleDateString('es-MX', { weekday: 'short', timeZone: 'UTC' });
  const clean = raw.replace('.', '');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** "14 abr" — day + abbreviated month. */
function formatDayDate(date: Date): string {
  const day = date.getUTCDate();
  const month = date
    .toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' })
    .replace('.', '');
  return `${day} ${month}`;
}

/** Today's UTC date key using the client timezone. */
function todayDateKey(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

// ─── Column header and layout constants ────────────────────────────────────────

const TODAY_COLUMN_BG    = '#FDF5EF';
const TODAY_DATE_COLOR   = '#C4916A';
const TODAY_BORDER_TOP   = '2px solid #C4916A';
const DEFAULT_BORDER_TOP = '2px solid transparent';

// ─── WeekView ─────────────────────────────────────────────────────────────────

export function WeekView({
  weekStart,
  timezone,
  appointments,
  renderExtraActions,
}: WeekViewProps) {
  const todayKey = todayDateKey(timezone);

  // ── Build base Mon–Fri columns ───────────────────────────────────────────
  const weekDays: Date[] = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  // ── Check for Sat/Sun appointments and add those columns if needed ────────
  const sat = addDays(weekStart, 5);
  const sun = addDays(weekStart, 6);
  const satKey = toUtcDateKey(sat);
  const sunKey = toUtcDateKey(sun);

  const hasSat = appointments.some(
    (a) => toLocalDateKey(a.startsAt, timezone) === satKey,
  );
  const hasSun = appointments.some(
    (a) => toLocalDateKey(a.startsAt, timezone) === sunKey,
  );

  if (hasSat) weekDays.push(sat);
  if (hasSun) weekDays.push(sun);

  // ── Group appointments by local date key ─────────────────────────────────
  const byDay = new Map<string, AppointmentWithPatient[]>();
  for (const day of weekDays) {
    byDay.set(toUtcDateKey(day), []);
  }

  for (const appt of appointments) {
    const key = toLocalDateKey(appt.startsAt, timezone);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(appt);
    }
  }

  // Sort each day's appointments chronologically
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  const colCount = weekDays.length;

  return (
    <div
      style={{
        overflowX: 'auto',
        marginBottom: '1.5rem',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${colCount}, minmax(130px, 1fr))`,
          gap: '0.5rem',
          minWidth: `${colCount * 130}px`,
        }}
      >
        {weekDays.map((day) => {
          const dayKey   = toUtcDateKey(day);
          const isToday  = dayKey === todayKey;
          const dayAppts = byDay.get(dayKey) ?? [];

          return (
            <div
              key={dayKey}
              style={{
                borderTop: isToday ? TODAY_BORDER_TOP : DEFAULT_BORDER_TOP,
                backgroundColor: isToday ? TODAY_COLUMN_BG : 'transparent',
                borderRadius: '0.5rem',
                overflow: 'hidden',
              }}
            >
              {/* ── Column header ────────────────────────────────── */}
              <div
                style={{
                  padding: '8px 8px 6px',
                  textAlign: 'center',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <p
                  style={{
                    margin: '0 0 2px',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--color-ink-muted)',
                  }}
                >
                  {formatWeekdayAbbrev(day)}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: '13px',
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? TODAY_DATE_COLOR : 'var(--color-ink)',
                  }}
                >
                  {formatDayDate(day)}
                </p>
              </div>

              {/* ── Appointment cards ─────────────────────────────── */}
              <div
                style={{
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                {dayAppts.length === 0 ? (
                  <p
                    style={{
                      margin: '1rem 0',
                      fontSize: '11px',
                      color: 'var(--color-ink-muted)',
                      textAlign: 'center',
                    }}
                  >
                    Sin citas
                  </p>
                ) : (
                  dayAppts.map((appt) => (
                    <AppointmentCard
                      key={appt.id}
                      appointment={appt}
                      timezone={timezone}
                      compact
                      renderExtraActions={renderExtraActions}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
