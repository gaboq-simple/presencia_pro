'use client';

// ─── DashboardShell ────────────────────────────────────────────────────────────
// Client Component wrapper for the dashboard page.
// Manages interactive state (drawer open/close) that cannot live in a Server
// Component. Receives all pre-fetched data from dashboard/page.tsx.
//
// Renders (medical profile only):
//   DayView              — today's appointments
//   BlockedDaysManager   — monthly day-blocking calendar
//   PatientHistoryDrawer — slide-in patient expedition drawer

import { useState } from 'react';
import { DayView } from '@presenciapro/engine/dashboard';
import type { AppointmentWithPatient, EmergencySlot } from '@presenciapro/engine/dashboard';
import { BlockedDaysManager } from './BlockedDaysManager';
import { PatientHistoryDrawer } from './PatientHistoryDrawer';

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
  const [activePatientId, setActivePatientId] = useState<string | null>(null);

  return (
    <>
      {/* ── Today's appointments ──────────────────────────────────────── */}
      <DayView
        appointments={appointments}
        emergencySlot={emergencySlot}
        date={date}
        timezone={timezone}
        onComplete={onComplete}
        onNoShow={onNoShow}
        onReleaseEmergency={onReleaseEmergency}
        onPatientClick={setActivePatientId}
      />

      {/* ── Day-blocking calendar ──────────────────────────────────────── */}
      <BlockedDaysManager
        specialistId={specialistId}
        timezone={timezone}
        appointmentDates={appointmentDates}
      />

      {/* ── Patient history drawer ─────────────────────────────────────── */}
      <PatientHistoryDrawer
        patientId={activePatientId}
        timezone={timezone}
        onClose={() => setActivePatientId(null)}
      />
    </>
  );
}
