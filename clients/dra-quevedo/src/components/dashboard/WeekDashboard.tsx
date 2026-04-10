'use client';

// ─── WeekDashboard ────────────────────────────────────────────────────────────
// Orchestrates the weekly agenda view for the doctor's dashboard.
// Manages state: weekStart, appointments, loading.
// Fetches appointments from /api/appointments/week when weekStart changes.
// Wires renderExtraActions with the existing AppointmentActions component.

import { useState, useEffect, useCallback } from 'react';
import { WeekView, WeekNav } from '@presenciapro/engine/dashboard';
import type { AppointmentWithPatient } from '@presenciapro/engine/dashboard';
import type { AppointmentStatus } from '@presenciapro/engine/dashboard';
import { AppointmentActions } from './AppointmentActions';
import { clientConfig } from '@/config/client.config';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Returns Monday of the current week as UTC midnight Date. */
function getCurrentMonday(): Date {
  const today = new Date();
  // Use local date so the doctor sees "this week" from their perspective.
  const dow  = today.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  // Normalize to UTC midnight for consistent API params.
  return new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()),
  );
}

/** Formats a UTC-midnight Date as YYYY-MM-DD for the API query param. */
function toApiDateParam(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Serialized shape returned by the week API route (Dates are ISO strings). */
type WeekAppointmentJson = Omit<AppointmentWithPatient, 'startsAt' | 'endsAt' | 'intakeData'> & {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
};

/** Parses the JSON response into AppointmentWithPatient view models. */
function parseAppointments(rows: WeekAppointmentJson[]): AppointmentWithPatient[] {
  return rows.map((row) => ({
    id:          row.id,
    startsAt:    new Date(row.startsAt),
    endsAt:      new Date(row.endsAt),
    status:      row.status,
    serviceId:   row.serviceId,
    serviceName: row.serviceName,
    serviceMode: row.serviceMode,
    specialistId: row.specialistId,
    patientId:   row.patientId,
    patientName: row.patientName,
    intakeData:  null,   // WeekView does not display intake data
  }));
}

// ─── WeekDashboard ─────────────────────────────────────────────────────────────

export function WeekDashboard() {
  const timezone = clientConfig.client.timezone;
  const clientId = clientConfig.client.id;

  const [weekStart, setWeekStart] = useState<Date>(getCurrentMonday);
  const [appointments, setAppointments] = useState<AppointmentWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch appointments for the current week ──────────────────────────────
  const fetchWeek = useCallback(async (monday: Date) => {
    setLoading(true);
    setError(null);

    // to = next Monday (exclusive upper bound)
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

    const from = toApiDateParam(monday);
    const to   = toApiDateParam(nextMonday);

    try {
      const res = await fetch(
        `/api/appointments/week?from=${from}&to=${to}&clientId=${encodeURIComponent(clientId)}`,
      );

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Error al cargar las citas de la semana.');
        return;
      }

      const rows = (await res.json()) as WeekAppointmentJson[];
      setAppointments(parseAppointments(rows));
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void fetchWeek(weekStart);
  }, [weekStart, fetchWeek]);

  // ── Navigation handlers ──────────────────────────────────────────────────
  function handlePrev() {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    });
  }

  function handleNext() {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    });
  }

  function handleToday() {
    setWeekStart(getCurrentMonday());
  }

  // ── Called by AppointmentActions after a successful modify/cancel ─────────
  const handleAppointmentUpdate = useCallback(() => {
    void fetchWeek(weekStart);
  }, [fetchWeek, weekStart]);

  return (
    <div>
      {/* ── Week navigation ─────────────────────────────────────────── */}
      <WeekNav
        weekStart={weekStart}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      {/* ── Loading / error states ───────────────────────────────────── */}
      {loading && (
        <p style={{ textAlign: 'center', color: 'var(--color-ink-muted)', fontSize: '0.9375rem' }}>
          Cargando…
        </p>
      )}

      {!loading && error && (
        <p
          style={{
            fontSize: '0.875rem',
            color: '#B91C1C',
            backgroundColor: '#FEF2F2',
            padding: '0.625rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #FECACA',
          }}
        >
          {error}
        </p>
      )}

      {/* ── Weekly grid ─────────────────────────────────────────────── */}
      {!loading && !error && (
        <WeekView
          weekStart={weekStart}
          timezone={timezone}
          appointments={appointments}
          onAppointmentUpdate={handleAppointmentUpdate}
          renderExtraActions={(apt) => (
            <AppointmentActions appointment={apt} onUpdate={handleAppointmentUpdate} />
          )}
        />
      )}
    </div>
  );
}
