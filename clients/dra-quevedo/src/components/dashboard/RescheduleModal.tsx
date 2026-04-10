'use client';

// ─── RescheduleModal ──────────────────────────────────────────────────────────
// Modal para modificar fecha y hora de una cita desde el dashboard del médico.
//
// Flujo:
//   1. Muestra datos actuales de la cita
//   2. Selector de fecha (input[type=date], min=hoy)
//   3. Al seleccionar fecha → fetch GET /api/calendar/slots para slots libres
//   4. Lista de slots disponibles → el médico selecciona uno
//   5. "Confirmar cambio" → POST /api/appointments/reschedule
//   6. onSuccess() → DashboardShell refresca la página

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { AppointmentWithPatient } from '@presenciapro/engine/dashboard';
import { clientConfig } from '@/config/client.config';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SlotOption = {
  readonly startsAt: string; // ISO string
  readonly endsAt: string;   // ISO string
};

type Props = {
  readonly appointment: AppointmentWithPatient;
  readonly onSuccess: () => void;
  readonly onClose: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date, timezone: string): string {
  return date.toLocaleDateString('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(isoString: string, timezone: string): string {
  return new Date(isoString).toLocaleTimeString('es-MX', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Returns today's date as YYYY-MM-DD in the client timezone */
function todayLocalDate(timezone: string): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: timezone });
}

// ─── Modal content ─────────────────────────────────────────────────────────────

function ModalContent({ appointment, onSuccess, onClose }: Props) {
  const timezone   = clientConfig.client.timezone;
  const clientId   = clientConfig.client.id;
  const specialist = clientConfig.specialists.find((s) => s.id === appointment.specialistId)
    ?? clientConfig.specialists[0]!;

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [slots, setSlots]               = useState<SlotOption[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError]     = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate) return;

    setLoadingSlots(true);
    setSlotsError(null);
    setSelectedSlot(null);
    setSlots([]);

    const params = new URLSearchParams({
      date:         selectedDate,
      specialistId: specialist.id,
      serviceId:    appointment.serviceId,
    });

    fetch(`/api/calendar/slots?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Error al cargar horarios');
        }
        return res.json() as Promise<{ slots: SlotOption[] }>;
      })
      .then(({ slots: fetched }) => {
        setSlots(fetched);
        if (fetched.length === 0) {
          setSlotsError('No hay horarios disponibles para este día.');
        }
      })
      .catch((err: unknown) => {
        setSlotsError(err instanceof Error ? err.message : 'Error al cargar horarios');
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, specialist.id, appointment.serviceId]);

  async function handleConfirm() {
    if (!selectedSlot) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/appointments/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: appointment.id,
          newStartsAt:   selectedSlot.startsAt,
          newEndsAt:     selectedSlot.endsAt,
          clientId,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setSubmitError(data.error ?? 'Error al reagendar la cita. Intenta de nuevo.');
        return;
      }

      onSuccess();
    } catch {
      setSubmitError('Error de conexión. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  const minDate = todayLocalDate(timezone);

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
        aria-labelledby="reschedule-modal-title"
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
            maxHeight: '90dvh',
            overflowY: 'auto',
            backgroundColor: 'var(--color-surface)',
            borderRadius: '0.625rem',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
            pointerEvents: 'all',
          }}
        >
          {/* ── Header ─────────────────────────────────────────────── */}
          <h2
            id="reschedule-modal-title"
            style={{
              margin: '0 0 0.25rem',
              fontFamily: 'var(--font-display)',
              fontSize: '1.125rem',
              fontWeight: 600,
              color: 'var(--color-ink)',
            }}
          >
            Modificar cita
          </h2>

          {/* ── Current appointment info ────────────────────────────── */}
          <p
            style={{
              margin: '0 0 1.25rem',
              fontSize: '0.875rem',
              color: 'var(--color-ink-muted)',
            }}
          >
            {appointment.patientName ?? 'Paciente'} ·{' '}
            {appointment.serviceName} ·{' '}
            {formatDate(appointment.startsAt, timezone)}
          </p>

          {/* ── Date picker ────────────────────────────────────────── */}
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="reschedule-date"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--color-ink)',
                marginBottom: '0.375rem',
              }}
            >
              Nueva fecha
            </label>
            <input
              id="reschedule-date"
              type="date"
              min={minDate}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5625rem 0.75rem',
                fontSize: '0.9375rem',
                color: 'var(--color-ink)',
                backgroundColor: 'var(--color-canvas)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* ── Slot list ──────────────────────────────────────────── */}
          {selectedDate && (
            <div style={{ marginBottom: '1.25rem' }}>
              <p
                style={{
                  margin: '0 0 0.5rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                }}
              >
                Horario disponible
              </p>

              {loadingSlots && (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-ink-muted)' }}>
                  Cargando horarios…
                </p>
              )}

              {slotsError && !loadingSlots && (
                <p style={{ fontSize: '0.875rem', color: '#B91C1C' }}>{slotsError}</p>
              )}

              {!loadingSlots && !slotsError && slots.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  {slots.map((slot) => {
                    const isSelected = selectedSlot?.startsAt === slot.startsAt;
                    return (
                      <button
                        key={slot.startsAt}
                        onClick={() => setSelectedSlot(slot)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          border: isSelected
                            ? '1.5px solid var(--color-accent)'
                            : '1px solid var(--color-border)',
                          backgroundColor: isSelected
                            ? 'var(--color-accent)'
                            : 'var(--color-canvas)',
                          color: isSelected
                            ? 'var(--color-accent-fg)'
                            : 'var(--color-ink)',
                        }}
                      >
                        {formatTime(slot.startsAt, timezone)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Submit error ────────────────────────────────────────── */}
          {submitError && (
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
              {submitError}
            </p>
          )}

          {/* ── Action buttons ──────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                flex: 1,
                padding: '0.625rem',
                backgroundColor: 'transparent',
                color: 'var(--color-ink)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancelar
            </button>

            <button
              onClick={handleConfirm}
              disabled={!selectedSlot || submitting}
              style={{
                flex: 1,
                padding: '0.625rem',
                backgroundColor:
                  !selectedSlot || submitting
                    ? 'var(--color-accent-lg)'
                    : 'var(--color-accent)',
                color: 'var(--color-accent-fg)',
                border: 'none',
                borderRadius: '0.375rem',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: !selectedSlot || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Guardando…' : 'Confirmar cambio'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── RescheduleModal ──────────────────────────────────────────────────────────

export function RescheduleModal({ appointment, onSuccess, onClose }: Props) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ModalContent appointment={appointment} onSuccess={onSuccess} onClose={onClose} />,
    document.body,
  );
}
