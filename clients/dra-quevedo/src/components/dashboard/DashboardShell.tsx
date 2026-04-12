'use client';

// ─── DashboardShell ────────────────────────────────────────────────────────────
// Client Component wrapper for the dashboard page.
// Manages interactive state (drawer open/close, modals, view toggle) that cannot
// live in a Server Component. Receives all pre-fetched data from dashboard/page.tsx.
//
// Renders (medical profile only):
//   DayView              — today's appointments (+ Modificar/Cancelar via renderExtraActions)
//   WeekDashboard        — weekly grid with WeekNav + WeekView
//   BlockedDaysManager   — monthly day-blocking calendar
//   PatientHistoryDrawer — slide-in patient expedition drawer
//
// View toggle persists in localStorage under key: presenciapro-dashboard-view
// Initialized with useEffect to avoid SSR hydration mismatch.

import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { CalendarDays, List } from 'lucide-react';
import { DayView, PatientSearch, PatientDrawer } from '@presenciapro/engine/dashboard';
import type { AppointmentWithPatient, EmergencySlot } from '@presenciapro/engine/dashboard';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clientConfig } from '@/config/client.config';
import { BlockedDaysManager } from './BlockedDaysManager';
import { PatientHistoryDrawer } from './PatientHistoryDrawer';
import { AppointmentActions } from './AppointmentActions';
import { WeekDashboard } from './WeekDashboard';

// ─── Types ─────────────────────────────────────────────────────────────────────

type DashboardView = 'day' | 'week';

const STORAGE_KEY = 'presenciapro-dashboard-view';

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  // ── DayView data ──────────────────────────────────────────────────────────
  readonly appointments: readonly AppointmentWithPatient[];
  readonly emergencySlot: EmergencySlot | null;
  readonly date: Date;
  readonly timezone: string;
  readonly onComplete: (appointmentId: string) => Promise<void>;
  readonly onNoShow: (appointmentId: string) => Promise<void>;
  readonly onReleaseEmergency: (appointmentId: string) => Promise<void>;

  // ── Medical-only features ─────────────────────────────────────────────────
  /** specialistId from clientConfig.specialists[0] */
  readonly specialistId: string;
  /** Appointment dates for the current month (YYYY-MM-DD) — for green highlights */
  readonly appointmentDates: readonly string[];
};

// ─── DashboardShell ────────────────────────────────────────────────────────────

export function DashboardShell({
  appointments,
  emergencySlot,
  date,
  timezone,
  onComplete,
  onNoShow,
  onReleaseEmergency,
  specialistId,
  appointmentDates,
}: Props) {
  const router = useRouter();
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  // patientId selected from search — opens PatientDrawer
  const [searchPatientId, setSearchPatientId] = useState<string | null>(null);
  // Supabase session token — for Authorization header on API calls from engine components
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);

  // Load auth token once on mount
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) setAuthToken(session.access_token);
    });
  }, []);

  // ── View toggle — initialized after mount to avoid SSR hydration mismatch ─
  const [view, setView] = useState<DashboardView>('day');
  const [viewReady, setViewReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'week' || stored === 'day') {
      setView(stored);
    }
    setViewReady(true);
  }, []);

  function handleSetView(nextView: DashboardView) {
    setView(nextView);
    localStorage.setItem(STORAGE_KEY, nextView);
  }

  // Called by AppointmentActions after a successful reschedule or cancel.
  // router.refresh() re-fetches Server Component data without full navigation.
  const handleAppointmentUpdate = useCallback(() => {
    router.refresh();
  }, [router]);

  // ── Toggle button style helper ────────────────────────────────────────────
  function toggleBtnStyle(isActive: boolean): CSSProperties {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0.375rem 0.625rem',
      backgroundColor: isActive ? 'var(--color-accent)' : 'transparent',
      color: isActive ? 'var(--color-accent-fg)' : 'var(--color-ink-muted)',
      border: isActive ? '1px solid transparent' : '1px solid var(--color-border)',
      borderRadius: '0.375rem',
      cursor: 'pointer',
    };
  }

  // Service list for PatientDrawer — built from clientConfig
  const drawerServices = clientConfig.services.map((s) => ({
    id:    s.id,
    name:  s.name,
    modes: 'modes' in s ? s.modes as readonly string[] : undefined,
  }));

  return (
    <>
      {/* ── View toggle + search bar ──────────────────────────────────── */}
      {viewReady && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          {/* Search bar */}
          <PatientSearch
            clientId={clientConfig.client.id}
            onSelect={(pid) => setSearchPatientId(pid)}
            authToken={authToken}
          />

          {/* View toggles */}
          <button
            onClick={() => handleSetView('week')}
            title="Vista semanal"
            aria-label="Vista semanal"
            aria-pressed={view === 'week'}
            style={toggleBtnStyle(view === 'week')}
          >
            <CalendarDays size={18} />
          </button>
          <button
            onClick={() => handleSetView('day')}
            title="Vista del día"
            aria-label="Vista del día"
            aria-pressed={view === 'day'}
            style={toggleBtnStyle(view === 'day')}
          >
            <List size={18} />
          </button>
        </div>
      )}

      {/* ── Week view ─────────────────────────────────────────────────── */}
      {viewReady && view === 'week' && <WeekDashboard />}

      {/* ── Day view — default + shown while localStorage loads ───────── */}
      {(!viewReady || view === 'day') && (
        <DayView
          appointments={appointments}
          emergencySlot={emergencySlot}
          date={date}
          timezone={timezone}
          onComplete={onComplete}
          onNoShow={onNoShow}
          onReleaseEmergency={onReleaseEmergency}
          onPatientClick={setActivePatientId}
          renderExtraActions={(apt) => (
            <AppointmentActions appointment={apt} onUpdate={handleAppointmentUpdate} />
          )}
          authToken={authToken}
          clientId={clientConfig.client.id}
        />
      )}

      {/* ── Day-blocking calendar ──────────────────────────────────────── */}
      <BlockedDaysManager
        specialistId={specialistId}
        timezone={timezone}
        appointmentDates={appointmentDates}
      />

      {/* ── Patient history drawer (from appointment card click) ─────── */}
      <PatientHistoryDrawer
        patientId={activePatientId}
        timezone={timezone}
        onClose={() => setActivePatientId(null)}
      />

      {/* ── Patient profile drawer (from search) ──────────────────────── */}
      <PatientDrawer
        patientId={searchPatientId}
        clientId={clientConfig.client.id}
        services={drawerServices}
        specialistId={specialistId}
        timezone={timezone}
        authToken={authToken}
        onClose={() => setSearchPatientId(null)}
      />
    </>
  );
}
