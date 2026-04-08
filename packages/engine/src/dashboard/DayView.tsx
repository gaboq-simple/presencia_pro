'use client';

// ─── DayView ──────────────────────────────────────────────────────────────────
// Renders all appointments for a single day plus the emergency slot control.
// Optimizes for speed: the doctor sees the full day at a glance in <10 seconds,
// and can complete or mark no-show in 2 taps.
//
// Client Component — handles local UI state (expanded intake, loading buttons).
// Receives pre-fetched data from the Server Component (dashboard/page.tsx).
// Server Actions are injected as props so this component stays framework-agnostic.

import { useState, useTransition } from 'react';
import { IntakeViewer } from './IntakeViewer.js';
import type { AppointmentWithPatient, EmergencySlot } from './types.js';

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

const STATUS_LABELS: Record<string, string> = {
  pending:              'pendiente',
  pending_confirmation: 'por confirmar',
  confirmed:            'confirmada',
  completed:            'completada',
  no_show:              'no asistió',
  emergency_blocked:    'emergencia',
  cancelled:            'cancelada',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:              { bg: '#FEF3C7', text: '#92400E' },
  pending_confirmation: { bg: '#FEF3C7', text: '#92400E' },
  confirmed:            { bg: '#DBEAFE', text: '#1E40AF' },
  completed:            { bg: '#D1FAE5', text: '#065F46' },
  no_show:              { bg: '#F3F4F6', text: '#4B5563' },
  emergency_blocked:    { bg: '#FEE2E2', text: '#991B1B' },
  cancelled:            { bg: '#F3F4F6', text: '#9CA3AF' },
};

const MODE_LABELS: Record<string, string> = {
  domicilio:   'a domicilio',
  consultorio: 'en consultorio',
};

// ─── AppointmentCard ────────────────────────────────────────────────────────

type CardProps = {
  appointment: AppointmentWithPatient;
  timezone: string;
  onComplete: (id: string) => Promise<void>;
  onNoShow: (id: string) => Promise<void>;
  onPatientClick?: (patientId: string) => void;
};

function AppointmentCard({ appointment, timezone, onComplete, onNoShow, onPatientClick }: CardProps) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [isPendingComplete, startComplete] = useTransition();
  const [isPendingNoShow, startNoShow] = useTransition();

  const { status } = appointment;
  const isTerminal = status === 'completed' || status === 'no_show' || status === 'cancelled';
  const canAct = status === 'confirmed' || status === 'pending' || status === 'pending_confirmation';

  const statusColor = STATUS_COLORS[status] ?? { bg: '#F3F4F6', text: '#6B7280' };

  return (
    <article
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.625rem',
        padding: '1rem',
        opacity: isTerminal ? 0.65 : 1,
      }}
    >
      {/* ── Time + status row ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.375rem',
        }}
      >
        <span
          style={{
            fontSize: '1.375rem',
            fontWeight: 700,
            color: 'var(--color-ink)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
          }}
        >
          {formatTime(appointment.startsAt, timezone)}
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 400,
              color: 'var(--color-ink-muted)',
              marginLeft: '0.25rem',
            }}
          >
            – {formatTime(appointment.endsAt, timezone)}
          </span>
        </span>

        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            padding: '0.1875rem 0.5rem',
            borderRadius: '9999px',
            backgroundColor: statusColor.bg,
            color: statusColor.text,
          }}
        >
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      {/* ── Patient + service ────────────────────────────────────────── */}
      <div style={{ marginBottom: '0.125rem', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '1.0625rem',
            fontWeight: 600,
            color: 'var(--color-ink)',
          }}
        >
          {appointment.patientName ?? 'Paciente sin nombre'}
        </p>
        {onPatientClick && appointment.patientId && (
          <button
            onClick={() => onPatientClick(appointment.patientId!)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: 'var(--color-accent)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            Ver expediente →
          </button>
        )}
      </div>
      <p
        style={{
          margin: '0 0 0.875rem',
          fontSize: '0.875rem',
          color: 'var(--color-ink-muted)',
        }}
      >
        {appointment.serviceName} · {MODE_LABELS[appointment.serviceMode] ?? appointment.serviceMode}
      </p>

      {/* ── Action buttons (only shown when actionable) ──────────────── */}
      {canAct && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.625rem' }}>
          <button
            onClick={() => startComplete(() => onComplete(appointment.id))}
            disabled={isPendingComplete || isPendingNoShow}
            style={{
              flex: 1,
              padding: '0.625rem',
              backgroundColor: isPendingComplete ? 'var(--color-accent-lg)' : 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.9375rem',
              fontWeight: 500,
              cursor: isPendingComplete ? 'not-allowed' : 'pointer',
            }}
          >
            {isPendingComplete ? '…' : '✓ Completar'}
          </button>

          <button
            onClick={() => startNoShow(() => onNoShow(appointment.id))}
            disabled={isPendingComplete || isPendingNoShow}
            style={{
              flex: 1,
              padding: '0.625rem',
              backgroundColor: 'transparent',
              color: isPendingNoShow ? 'var(--color-ink-muted)' : 'var(--color-ink)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.375rem',
              fontSize: '0.9375rem',
              fontWeight: 500,
              cursor: isPendingNoShow ? 'not-allowed' : 'pointer',
            }}
          >
            {isPendingNoShow ? '…' : 'No asistió'}
          </button>
        </div>
      )}

      {/* ── Intake toggle ────────────────────────────────────────────── */}
      {appointment.intakeData ? (
        <>
          <button
            onClick={() => setIntakeOpen((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.8125rem',
              color: 'var(--color-accent)',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            {intakeOpen ? '▲' : '▼'} Ver intake
          </button>
          {intakeOpen && <IntakeViewer intake={appointment.intakeData} />}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-ink-muted)' }}>
          Intake no completado
        </p>
      )}
    </article>
  );
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
