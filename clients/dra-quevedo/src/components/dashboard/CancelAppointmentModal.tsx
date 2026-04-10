'use client';

// ─── CancelAppointmentModal ───────────────────────────────────────────────────
// Simple confirmation modal before cancelling an appointment from the dashboard.
// Distinct from cancel-by-patient: doctor-initiated, no cancellation window check.
//
// On confirm: POST /api/appointments/cancel-by-doctor
// On success: calls onSuccess() → DashboardShell refreshes the page.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppointmentWithPatient } from '@presenciapro/engine/dashboard';
import { clientConfig } from '@/config/client.config';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  readonly appointment: AppointmentWithPatient;
  readonly onSuccess: () => void;
  readonly onClose: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatAppointmentDate(date: Date, timezone: string): string {
  return date.toLocaleDateString('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatAppointmentTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('es-MX', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── Modal content ─────────────────────────────────────────────────────────────

function ModalContent({ appointment, onSuccess, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timezone = clientConfig.client.timezone;
  const clientId = clientConfig.client.id;
  const fecha = formatAppointmentDate(appointment.startsAt, timezone);
  const hora = formatAppointmentTime(appointment.startsAt, timezone);

  async function handleConfirm() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/appointments/cancel-by-doctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          clientId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Error al cancelar la cita. Intenta de nuevo.');
        return;
      }

      onSuccess();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ── Overlay ──────────────────────────────────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          zIndex: 50,
        }}
      />

      {/* ── Modal card ───────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 51,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            backgroundColor: 'var(--color-surface)',
            borderRadius: '0.625rem',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
            pointerEvents: 'all',
          }}
        >
          {/* ── Header ─────────────────────────────────────────────── */}
          <h2
            id="cancel-modal-title"
            style={{
              margin: '0 0 0.5rem',
              fontFamily: 'var(--font-display)',
              fontSize: '1.125rem',
              fontWeight: 600,
              color: 'var(--color-ink)',
            }}
          >
            Cancelar cita
          </h2>

          {/* ── Body ───────────────────────────────────────────────── */}
          <p
            style={{
              margin: '0 0 1.25rem',
              fontSize: '0.9375rem',
              color: 'var(--color-ink-muted)',
              lineHeight: 1.5,
            }}
          >
            ¿Confirmas que deseas cancelar la cita de{' '}
            <strong style={{ color: 'var(--color-ink)' }}>
              {appointment.patientName ?? 'este paciente'}
            </strong>{' '}
            del{' '}
            <strong style={{ color: 'var(--color-ink)' }}>
              {fecha} a las {hora}
            </strong>
            ?
          </p>

          <p
            style={{
              margin: '0 0 1.25rem',
              fontSize: '0.8125rem',
              color: 'var(--color-ink-muted)',
            }}
          >
            Se notificará al paciente por WhatsApp y el slot quedará libre.
          </p>

          {/* ── Error ──────────────────────────────────────────────── */}
          {error && (
            <p
              style={{
                margin: '0 0 1rem',
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

          {/* ── Buttons ────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.625rem',
                backgroundColor: 'transparent',
                color: 'var(--color-ink)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              No, mantener
            </button>

            <button
              onClick={handleConfirm}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.625rem',
                backgroundColor: '#B91C1C',
                color: '#fff',
                border: 'none',
                borderRadius: '0.375rem',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Cancelando…' : 'Sí, cancelar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── CancelAppointmentModal ────────────────────────────────────────────────────

export function CancelAppointmentModal({ appointment, onSuccess, onClose }: Props) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ModalContent appointment={appointment} onSuccess={onSuccess} onClose={onClose} />,
    document.body,
  );
}
