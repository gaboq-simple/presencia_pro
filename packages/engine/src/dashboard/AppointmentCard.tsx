'use client';

// ─── AppointmentCard ──────────────────────────────────────────────────────────
// Renders a single appointment card. Used by DayView (compact=false) and
// WeekView (compact=true).
//
// compact=false — full card: time range, Complete/No-show actions, intake toggle.
// compact=true  — condensed card: start time only, no Complete/No-show, no intake.
//
// Extra actions (Modificar/Cancelar) are injected via renderExtraActions in both
// modes — called only when status is actionable (pending | pending_confirmation |
// confirmed).

import React, { useState, useTransition } from 'react';
import { IntakeViewer } from './IntakeViewer';
import type { AppointmentWithPatient } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AppointmentCardProps = {
  readonly appointment: AppointmentWithPatient;
  readonly timezone: string;
  readonly compact?: boolean;
  readonly onComplete?: (id: string) => Promise<void>;
  readonly onNoShow?: (id: string) => Promise<void>;
  readonly onPatientClick?: (patientId: string) => void;
  readonly renderExtraActions?: (appointment: AppointmentWithPatient) => React.ReactNode;
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

// ─── Status labels & colors ────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending:              'pendiente',
  pending_confirmation: 'por confirmar',
  confirmed:            'confirmada',
  completed:            'completada',
  no_show:              'no asistió',
  emergency_blocked:    'emergencia',
  cancelled:            'cancelada',
};

// Full-view colors — keep in sync with DayView's original STATUS_COLORS.
const FULL_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:              { bg: '#FEF3C7', text: '#92400E' },
  pending_confirmation: { bg: '#FEF3C7', text: '#92400E' },
  confirmed:            { bg: '#DBEAFE', text: '#1E40AF' },
  completed:            { bg: '#D1FAE5', text: '#065F46' },
  no_show:              { bg: '#F3F4F6', text: '#4B5563' },
  emergency_blocked:    { bg: '#FEE2E2', text: '#991B1B' },
  cancelled:            { bg: '#F3F4F6', text: '#9CA3AF' },
};

// Compact-view colors — premium palette for the weekly grid.
const COMPACT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:              { bg: '#FEF8E8', text: '#7A4A08' },
  pending_confirmation: { bg: '#FEF8E8', text: '#7A4A08' },
  confirmed:            { bg: '#EEF5E8', text: '#2E5A1A' },
  completed:            { bg: '#F2EEE8', text: '#9B8E80' },
  no_show:              { bg: '#FCF0EE', text: '#6A1E16' },
  emergency_blocked:    { bg: '#FEE2E2', text: '#991B1B' },
  cancelled:            { bg: '#F2EEE8', text: '#9B8E80' },
};

const MODE_LABELS: Record<string, string> = {
  domicilio:   'a domicilio',
  consultorio: 'en consultorio',
};

// ─── AppointmentCard ─────────────────────────────────────────────────────────

export function AppointmentCard({
  appointment,
  timezone,
  compact = false,
  onComplete,
  onNoShow,
  onPatientClick,
  renderExtraActions,
}: AppointmentCardProps) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [isPendingComplete, startComplete] = useTransition();
  const [isPendingNoShow, startNoShow] = useTransition();

  const { status } = appointment;
  const isTerminal = status === 'completed' || status === 'no_show' || status === 'cancelled';
  const canAct = status === 'confirmed' || status === 'pending' || status === 'pending_confirmation';

  const statusColors = compact ? COMPACT_STATUS_COLORS : FULL_STATUS_COLORS;
  const statusColor = statusColors[status] ?? { bg: '#F3F4F6', text: '#6B7280' };

  // ── Compact layout ─────────────────────────────────────────────────────────
  if (compact) {
    return (
      <article
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          padding: '8px 10px',
          opacity: isTerminal ? 0.6 : 1,
        }}
      >
        {/* ── Time + status ─────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '3px',
            gap: '4px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-ink-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatTime(appointment.startsAt, timezone)}
          </span>

          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: '9999px',
              backgroundColor: statusColor.bg,
              color: statusColor.text,
              textDecoration: status === 'cancelled' ? 'line-through' : 'none',
              flexShrink: 0,
            }}
          >
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>

        {/* ── Patient name ───────────────────────────────────────────── */}
        <p
          style={{
            margin: '0 0 2px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--color-ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {appointment.patientName ?? 'Paciente sin nombre'}
        </p>

        {/* ── Service + mode ─────────────────────────────────────────── */}
        <p
          style={{
            margin: '0 0 6px',
            fontSize: '11px',
            color: 'var(--color-ink-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {appointment.serviceName}
          {' · '}
          <span
            style={{
              fontSize: '10px',
              fontWeight: 500,
              padding: '1px 5px',
              borderRadius: '9999px',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-ink-muted)',
            }}
          >
            {appointment.serviceMode === 'domicilio' ? 'domicilio' : 'consultorio'}
          </span>
        </p>

        {/* ── Extra actions ──────────────────────────────────────────── */}
        {canAct && renderExtraActions?.(appointment)}
      </article>
    );
  }

  // ── Full layout (DayView) ──────────────────────────────────────────────────
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
      {canAct && onComplete && onNoShow && (
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

      {/* ── Extra actions (Modificar / Cancelar) — injected by client ── */}
      {canAct && renderExtraActions?.(appointment)}

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
