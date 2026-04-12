'use client';

// ─── DayView ──────────────────────────────────────────────────────────────────
// Renders all appointments for a single day plus the emergency slot control.
// Optimizes for speed: the doctor sees the full day at a glance in <10 seconds,
// and can complete or mark no-show in 2 taps.
//
// Client Component — handles local UI state (expanded intake, loading buttons).
// Receives pre-fetched data from the Server Component (dashboard/page.tsx).
// Server Actions are injected as props so this component stays framework-agnostic.

import React, { useTransition } from 'react';
import { AppointmentCard } from './AppointmentCard';
import type { AppointmentWithPatient, EmergencySlot } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────────

type DayViewProps = {
  readonly appointments: readonly AppointmentWithPatient[];
  readonly emergencySlot: EmergencySlot | null;
  readonly date: Date;
  readonly timezone: string;
  readonly onComplete: (appointmentId: string) => Promise<void>;
  readonly onNoShow: (appointmentId: string) => Promise<void>;
  readonly onReleaseEmergency: (appointmentId: string) => Promise<void>;
  /** Optional — when provided, an "Ver expediente" link appears on each card.
   *  Used by PatientHistoryDrawer (medical profile only). */
  readonly onPatientClick?: (patientId: string) => void;
  /** Optional — render prop for extra per-appointment actions (e.g. Modificar/Cancelar).
   *  Only called for actionable appointments (pending, pending_confirmation, confirmed).
   *  The rendered node is injected below the built-in action buttons. */
  readonly renderExtraActions?: (appointment: AppointmentWithPatient) => React.ReactNode;
  /** Supabase session token — enables the patient notes icon on each card.
   *  Passed through to PatientNotesPopover for API auth. */
  readonly authToken?: string;
  /** Client slug — scopes all notes queries to this client instance. */
  readonly clientId?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  });
}

function formatDayHeader(date: Date, timezone: string): string {
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  });
}

// ─── EmergencySlotCard ────────────────────────────────────────────────────────

type EmergencyCardProps = {
  slot: EmergencySlot;
  timezone: string;
  onRelease: (id: string) => Promise<void>;
};

function EmergencySlotCard({ slot, timezone, onRelease }: EmergencyCardProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <div
      style={{
        backgroundColor: '#FFF7ED',
        border: '1px solid #FED7AA',
        borderRadius: '0.625rem',
        padding: '0.875rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        marginBottom: '1rem',
      }}
    >
      <div>
        <p
          style={{
            margin: '0 0 0.125rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#C2410C',
          }}
        >
          🚨 Slot de emergencia
        </p>
        <p style={{ margin: 0, fontSize: '0.9375rem', color: '#7C2D12', fontWeight: 500 }}>
          {formatTime(slot.startsAt, timezone)} – {formatTime(slot.endsAt, timezone)}
        </p>
      </div>

      <button
        onClick={() => startTransition(() => onRelease(slot.id))}
        disabled={isPending}
        style={{
          padding: '0.5rem 0.875rem',
          backgroundColor: '#EA580C',
          color: '#fff',
          border: 'none',
          borderRadius: '0.375rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          cursor: isPending ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isPending ? '…' : 'Liberar'}
      </button>
    </div>
  );
}

// ─── DayView ──────────────────────────────────────────────────────────────────

export function DayView({
  appointments,
  emergencySlot,
  date,
  timezone,
  onComplete,
  onNoShow,
  onReleaseEmergency,
  onPatientClick,
  renderExtraActions,
  authToken,
  clientId,
}: DayViewProps) {
  const activeAppointments = appointments.filter(
    (a) => a.status !== 'cancelled',
  );

  return (
    <div>
      {/* ── Day header ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1rem' }}>
        <h2
          style={{
            margin: '0 0 0.125rem',
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 600,
            color: 'var(--color-ink)',
            textTransform: 'capitalize',
          }}
        >
          {formatDayHeader(date, timezone)}
        </h2>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-ink-muted)' }}>
          {activeAppointments.length === 0
            ? 'Sin citas activas hoy'
            : `${activeAppointments.length} ${activeAppointments.length === 1 ? 'cita' : 'citas'} hoy`}
        </p>
      </div>

      {/* ── Emergency slot ─────────────────────────────────────────── */}
      {emergencySlot && (
        <EmergencySlotCard
          slot={emergencySlot}
          timezone={timezone}
          onRelease={onReleaseEmergency}
        />
      )}

      {/* ── Appointment list ───────────────────────────────────────── */}
      {activeAppointments.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-ink-muted)',
            fontSize: '0.9375rem',
            border: '1px dashed var(--color-border)',
            borderRadius: '0.625rem',
          }}
        >
          Agenda libre
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {activeAppointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              timezone={timezone}
              onComplete={onComplete}
              onNoShow={onNoShow}
              onPatientClick={onPatientClick}
              renderExtraActions={renderExtraActions}
              authToken={authToken}
              clientId={clientId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
