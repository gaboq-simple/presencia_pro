'use client';

// ─── PatientDrawer ─────────────────────────────────────────────────────────────
// Slide-in drawer from the right showing a patient's full profile.
// Opened when the doctor selects a patient from PatientSearch results.
//
// Three sections:
//   1. Patient data        — always visible, not collapsible
//   2. Appointment history — collapsible, closed by default
//   3. Book new appointment — collapsible, closed by default
//
// All sections are optional — the doctor reads what they want.
//
// Layout: width 380px on desktop, min(90vw, 380px) on mobile.

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, CalendarPlus } from 'lucide-react';
import type { PatientProfile, AppointmentSummary, AppointmentStatus } from './types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ServiceOption = {
  readonly id: string;
  readonly name: string;
  readonly modes?: readonly string[];
};

export type SlotOption = {
  readonly startsAt: string; // ISO 8601
  readonly endsAt: string;   // ISO 8601
};

export type PatientDrawerProps = {
  /** null = drawer closed */
  readonly patientId: string | null;
  readonly clientId: string;
  readonly services: readonly ServiceOption[];
  readonly specialistId: string;
  readonly timezone: string;
  readonly onClose: () => void;
  readonly authToken?: string;
};

// ─── Status badge config ───────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  active:   { label: 'Activo',    bg: '#EEF5E8', color: '#2E5A1A' },
  'at-risk': { label: 'En riesgo', bg: '#FEF8E8', color: '#7A4A08' },
  inactive: { label: 'Inactivo',  bg: '#F2EEE8', color: '#9B8E80' },
};

const APPT_STATUS_LABELS: Record<string, string> = {
  pending:              'pendiente',
  pending_confirmation: 'por confirmar',
  confirmed:            'confirmada',
  completed:            'completada',
  no_show:              'no asistió',
  cancelled:            'cancelada',
};

const APPT_STATUS_COLORS: Record<AppointmentStatus, { bg: string; text: string }> = {
  pending:              { bg: '#FEF3C7', text: '#92400E' },
  pending_confirmation: { bg: '#FEF3C7', text: '#92400E' },
  confirmed:            { bg: '#DBEAFE', text: '#1E40AF' },
  completed:            { bg: '#D1FAE5', text: '#065F46' },
  no_show:              { bg: '#F3F4F6', text: '#4B5563' },
  cancelled:            { bg: '#F3F4F6', text: '#9CA3AF' },
  emergency_blocked:    { bg: '#FEE2E2', text: '#991B1B' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDate(isoString: string, timezone: string): string {
  return new Date(isoString).toLocaleDateString('es-MX', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatLongDate(isoString: string, timezone: string): string {
  return new Date(isoString).toLocaleDateString('es-MX', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
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

/** Returns today as YYYY-MM-DD in client timezone */
function todayLocalDate(timezone: string): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: timezone });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (w: string, h = '0.875rem') => (
    <div
      style={{
        width: w,
        height: h,
        backgroundColor: 'var(--color-surface, #F2EEE8)',
        borderRadius: '0.25rem',
      }}
    />
  );

  return (
    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            backgroundColor: 'var(--color-surface, #F2EEE8)',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {bar('60%', '1.125rem')}
          {bar('45%')}
        </div>
      </div>
      {bar('70%')}
      {bar('50%')}
    </div>
  );
}

// ─── Section toggle button ─────────────────────────────────────────────────────

function SectionToggle({
  label,
  icon,
  count,
  open,
  onToggle,
}: {
  label: string;
  icon?: React.ReactNode;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '0.75rem 1.25rem',
        backgroundColor: 'var(--color-surface, #F2EEE8)',
        border: 'none',
        borderTop: '1px solid var(--color-border, #E5E2DE)',
        cursor: 'pointer',
        color: 'var(--color-ink, #1A1A1A)',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        {icon}
        {label}
        {count !== undefined && (
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 400,
              color: 'var(--color-ink-muted, #6B6560)',
            }}
          >
            ({count})
          </span>
        )}
      </span>
      {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  );
}

// ─── AppointmentHistory section ────────────────────────────────────────────────

function AppointmentHistorySection({
  appointments,
  timezone,
}: {
  appointments: readonly AppointmentSummary[];
  timezone: string;
}) {
  if (appointments.length === 0) {
    return (
      <div style={{ padding: '1rem 1.25rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: 'var(--color-ink-muted, #6B6560)',
            textAlign: 'center',
          }}
        >
          Sin citas registradas
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
      {appointments.map((appt, idx) => {
        const statusColor = APPT_STATUS_COLORS[appt.status] ?? { bg: '#F3F4F6', text: '#6B7280' };
        const isLast = idx === appointments.length - 1;
        return (
          <div
            key={appt.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
              paddingBottom: isLast ? 0 : '0.875rem',
            }}
          >
            {/* Timeline dot */}
            <div
              style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '50%',
                backgroundColor:
                  appt.status === 'completed' ? '#059669' : 'var(--color-border, #E5E2DE)',
                marginTop: '0.3125rem',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  marginBottom: '0.125rem',
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: 'var(--color-ink, #1A1A1A)',
                  }}
                >
                  {appt.serviceName}
                </p>
                <span
                  style={{
                    fontSize: '0.625rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '9999px',
                    backgroundColor: statusColor.bg,
                    color: statusColor.text,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {APPT_STATUS_LABELS[appt.status] ?? appt.status}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--color-ink-muted, #6B6560)',
                }}
              >
                {formatDate(appt.startsAt, timezone)} · {appt.mode}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── BookAppointmentSection ────────────────────────────────────────────────────

function BookAppointmentSection({
  patientId,
  services,
  specialistId,
  timezone,
  authToken,
  onBooked,
}: {
  patientId: string;
  services: readonly ServiceOption[];
  specialistId: string;
  timezone: string;
  authToken?: string;
  onBooked: () => void;
}) {
  const [serviceId, setServiceId]     = useState(services[0]?.id ?? '');
  const [mode, setMode]               = useState<string>('');
  const [selectedDate, setSelectedDate] = useState('');
  const [slots, setSlots]             = useState<SlotOption[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotOption | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError]   = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  const selectedService = services.find((s) => s.id === serviceId);
  const hasModes = selectedService?.modes && selectedService.modes.length > 1;

  // Reset mode when service changes
  useEffect(() => {
    const svc = services.find((s) => s.id === serviceId);
    setMode(svc?.modes?.[0] ?? '');
    setSelectedDate('');
    setSlots([]);
    setSelectedSlot(null);
  }, [serviceId, services]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate) return;

    setLoadingSlots(true);
    setSlotsError(null);
    setSelectedSlot(null);
    setSlots([]);

    const params = new URLSearchParams({
      date:         selectedDate,
      specialistId,
      serviceId,
    });

    fetch(`/api/calendar/slots?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json() as { error?: string };
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
  }, [selectedDate, specialistId, serviceId]);

  async function handleConfirm() {
    if (!selectedSlot || !serviceId) return;

    const effectiveMode = (hasModes ? mode : selectedService?.modes?.[0]) ?? 'consultorio';

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/patients/${patientId}/appointments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          serviceId,
          serviceMode:  effectiveMode,
          startsAt:     selectedSlot.startsAt,
          specialistId,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSubmitError(data.error ?? 'Error al agendar la cita. Intenta de nuevo.');
        return;
      }

      setSuccess(true);
      onBooked();
    } catch {
      setSubmitError('Error de conexión. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div style={{ padding: '1rem 1.25rem' }}>
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: '#065F46',
            backgroundColor: '#D1FAE5',
            padding: '0.625rem 0.75rem',
            borderRadius: '0.375rem',
          }}
        >
          ✓ Cita agendada correctamente
        </p>
      </div>
    );
  }

  const minDate = todayLocalDate(timezone);

  return (
    <div
      style={{
        padding: '0.875rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      {/* ── Service selector ──────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="drawer-service"
          style={{
            display: 'block',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--color-ink, #1A1A1A)',
            marginBottom: '0.375rem',
          }}
        >
          Servicio
        </label>
        <select
          id="drawer-service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontSize: '0.875rem',
            color: 'var(--color-ink, #1A1A1A)',
            backgroundColor: 'var(--color-canvas, #FAFAF8)',
            border: '1px solid var(--color-border, #E5E2DE)',
            borderRadius: '0.375rem',
          }}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Mode selector (only if service has multiple modes) ──────────── */}
      {hasModes && (
        <div>
          <label
            htmlFor="drawer-mode"
            style={{
              display: 'block',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--color-ink, #1A1A1A)',
              marginBottom: '0.375rem',
            }}
          >
            Modalidad
          </label>
          <select
            id="drawer-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              fontSize: '0.875rem',
              color: 'var(--color-ink, #1A1A1A)',
              backgroundColor: 'var(--color-canvas, #FAFAF8)',
              border: '1px solid var(--color-border, #E5E2DE)',
              borderRadius: '0.375rem',
            }}
          >
            {selectedService?.modes?.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Date picker ───────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="drawer-date"
          style={{
            display: 'block',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--color-ink, #1A1A1A)',
            marginBottom: '0.375rem',
          }}
        >
          Fecha
        </label>
        <input
          id="drawer-date"
          type="date"
          min={minDate}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontSize: '0.875rem',
            color: 'var(--color-ink, #1A1A1A)',
            backgroundColor: 'var(--color-canvas, #FAFAF8)',
            border: '1px solid var(--color-border, #E5E2DE)',
            borderRadius: '0.375rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── Slot selector ─────────────────────────────────────────────── */}
      {selectedDate && (
        <div>
          <p
            style={{
              margin: '0 0 0.5rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--color-ink, #1A1A1A)',
            }}
          >
            Horario disponible
          </p>

          {loadingSlots && (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-ink-muted, #6B6560)' }}>
              Cargando horarios…
            </p>
          )}

          {slotsError && !loadingSlots && (
            <p style={{ fontSize: '0.875rem', color: '#B91C1C' }}>{slotsError}</p>
          )}

          {!loadingSlots && !slotsError && slots.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                        ? '1.5px solid var(--color-accent, #8B6F5E)'
                        : '1px solid var(--color-border, #E5E2DE)',
                      backgroundColor: isSelected
                        ? 'var(--color-accent, #8B6F5E)'
                        : 'var(--color-canvas, #FAFAF8)',
                      color: isSelected
                        ? 'var(--color-accent-fg, #FAFAF8)'
                        : 'var(--color-ink, #1A1A1A)',
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

      {/* ── Submit error ──────────────────────────────────────────────── */}
      {submitError && (
        <p
          style={{
            margin: 0,
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

      {/* ── Confirm button ────────────────────────────────────────────── */}
      <button
        onClick={handleConfirm}
        disabled={!selectedSlot || submitting}
        style={{
          width: '100%',
          padding: '0.625rem',
          backgroundColor:
            !selectedSlot || submitting
              ? 'var(--color-accent-lg, #C4B0A0)'
              : 'var(--color-accent, #8B6F5E)',
          color: 'var(--color-accent-fg, #FAFAF8)',
          border: 'none',
          borderRadius: '0.375rem',
          fontSize: '0.9375rem',
          fontWeight: 500,
          cursor: !selectedSlot || submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Agendando…' : 'Confirmar cita'}
      </button>
    </div>
  );
}

// ─── PatientDrawer ─────────────────────────────────────────────────────────────

export function PatientDrawer({
  patientId,
  services,
  specialistId,
  timezone,
  onClose,
  authToken,
}: PatientDrawerProps) {
  const isOpen = patientId !== null;

  const [profile, setProfile]           = useState<PatientProfile | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [bookOpen, setBookOpen]         = useState(false);

  // ── Fetch profile when opened ──────────────────────────────────────────────

  const fetchProfile = useCallback(async (id: string) => {
    setLoading(true);
    setProfile(null);
    setError(null);
    setHistoryOpen(false);
    setBookOpen(false);

    try {
      const res = await fetch(
        `/api/patients/${id}`,
        authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {},
      );

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as PatientProfile;
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (patientId) void fetchProfile(patientId);
  }, [patientId, fetchProfile]);

  // ── Keyboard close ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const statusBadge = profile
    ? (STATUS_BADGE[profile.status] ?? STATUS_BADGE['inactive']!)
    : null;

  return (
    <>
      {/* ── Backdrop ────────────────────────────────────────────────────── */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(28,20,16,0.3)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
      />

      {/* ── Drawer panel ────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={profile ? `Perfil de ${profile.name}` : 'Perfil del paciente'}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100dvh',
          width: 'min(90vw, 380px)',
          backgroundColor: 'var(--color-canvas, #FAFAF8)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY: 'auto',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            backgroundColor: 'var(--color-surface, #F2EEE8)',
            borderBottom: '1px solid var(--color-border, #E5E2DE)',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 1,
          }}
        >
          <span
            style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: 'var(--color-ink, #1A1A1A)',
            }}
          >
            {profile?.name ?? 'Perfil del paciente'}
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar perfil"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-ink-muted, #6B6560)',
              display: 'flex',
              alignItems: 'center',
              padding: '0.25rem',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {loading && <Skeleton />}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && !loading && (
          <div style={{ padding: '1.25rem' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#991B1B' }}>⚠ {error}</p>
          </div>
        )}

        {/* ── Profile content ──────────────────────────────────────────── */}
        {!loading && !error && profile && (
          <>
            {/* ── Section 1: Patient data (always visible) ─────────────── */}
            <div style={{ padding: '1.25rem' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.875rem',
                  marginBottom: '1rem',
                }}
              >
                {/* Initials circle 48px */}
                <div
                  style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: '50%',
                    backgroundColor: '#C4916A',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    flexShrink: 0,
                    letterSpacing: '0.04em',
                  }}
                >
                  {getInitials(profile.name)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <h2
                      style={{
                        margin: 0,
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        color: 'var(--color-ink, #1A1A1A)',
                      }}
                    >
                      {profile.name}
                    </h2>
                    {statusBadge && (
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '9999px',
                          backgroundColor: statusBadge.bg,
                          color: statusBadge.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {statusBadge.label}
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.8125rem',
                      color: 'var(--color-ink-muted, #6B6560)',
                    }}
                  >
                    {profile.phone ?? profile.whatsappId}
                  </p>
                </div>
              </div>

              {/* Stats row */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.375rem',
                }}
              >
                {profile.firstVisit && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.8125rem',
                      color: 'var(--color-ink-muted, #6B6560)',
                    }}
                  >
                    Primera cita:{' '}
                    <span style={{ color: 'var(--color-ink, #1A1A1A)', fontWeight: 500 }}>
                      {formatLongDate(profile.firstVisit, timezone)}
                    </span>
                  </p>
                )}
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    color: 'var(--color-ink-muted, #6B6560)',
                  }}
                >
                  Total de citas:{' '}
                  <span style={{ color: 'var(--color-ink, #1A1A1A)', fontWeight: 500 }}>
                    {profile.totalAppointments}{' '}
                    {profile.totalAppointments === 1 ? 'completada' : 'completadas'}
                  </span>
                </p>
              </div>
            </div>

            {/* ── Section 2: Appointment history (collapsible) ─────────── */}
            <SectionToggle
              label="Citas anteriores"
              count={profile.appointments.length}
              open={historyOpen}
              onToggle={() => setHistoryOpen((o) => !o)}
            />
            {historyOpen && (
              <AppointmentHistorySection
                appointments={profile.appointments}
                timezone={timezone}
              />
            )}

            {/* ── Section 3: Book new appointment (collapsible) ────────── */}
            <SectionToggle
              label="Agendar nueva cita"
              icon={<CalendarPlus size={15} />}
              open={bookOpen}
              onToggle={() => setBookOpen((o) => !o)}
            />
            {bookOpen && patientId && (
              <BookAppointmentSection
                patientId={patientId}
                services={services}
                specialistId={specialistId}
                timezone={timezone}
                authToken={authToken}
                onBooked={() => {
                  // Refresh profile after booking to update status badge
                  void fetchProfile(patientId);
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
