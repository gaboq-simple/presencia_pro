'use client';

// ─── PatientHistoryDrawer ──────────────────────────────────────────────────────
// Slide-in drawer that shows the full history of a patient.
// Opens from AppointmentCard via DayView's onPatientClick prop.
// Exclusive to the `medical` profile — rendered only after isMedical() check
// in the consuming Server Component.
//
// Layout:
//   Mobile  — position: fixed, width: min(90vw, 400px), right slide
//   Desktop — position: fixed, width: 380px, right panel
//
// Data flow:
//   onPatientClick(patientId) → drawer opens → fetches /api/patients/[id]/history
//   Each appointment row has a "Ver intake" toggle that expands IntakeViewer inline.

import { useState, useEffect, useCallback } from 'react';
import { IntakeViewer } from '@presenciapro/engine/dashboard';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { PhotoGallery } from './PhotoGallery';
import type { IntakeData } from '@presenciapro/engine/dashboard';

// ─── Wire types ────────────────────────────────────────────────────────────────
// The API serializes Dates as ISO strings — we work with strings here.

type ApiAppointment = {
  id: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;        // ISO string
  status: string;
  hasIntake: boolean;
  intakeId: string | null;
  intakeData: ApiIntakeData | null;
};

type ApiIntakeData = {
  id: string;
  fields: { key: string; label: string; value: string }[];
  signedAt: string | null;
};

type ApiHistory = {
  patient: {
    id: string;
    name: string;
    phone: string;
    firstVisit: string | null;
    lastVisit: string | null;
    totalVisits: number;
  };
  appointments: ApiAppointment[];
};

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  /** null = drawer closed */
  readonly patientId: string | null;
  readonly timezone: string;
  readonly onClose: () => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending:              'pendiente',
  pending_confirmation: 'por confirmar',
  confirmed:            'confirmada',
  completed:            'completada',
  no_show:              'no asistió',
  cancelled:            'cancelada',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:              { bg: '#FEF3C7', text: '#92400E' },
  pending_confirmation: { bg: '#FEF3C7', text: '#92400E' },
  confirmed:            { bg: '#DBEAFE', text: '#1E40AF' },
  completed:            { bg: '#D1FAE5', text: '#065F46' },
  no_show:              { bg: '#F3F4F6', text: '#4B5563' },
  cancelled:            { bg: '#F3F4F6', text: '#9CA3AF' },
};

function formatDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  });
}

function formatShortDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
}

// ─── AppointmentRow ────────────────────────────────────────────────────────────

function AppointmentRow({
  appt,
  timezone,
  isLast,
}: {
  appt: ApiAppointment;
  timezone: string;
  isLast: boolean;
}) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const statusColor = STATUS_COLORS[appt.status] ?? { bg: '#F3F4F6', text: '#6B7280' };

  // Adapt ApiIntakeData → IntakeData (same shape, just typed)
  const intakeData: IntakeData | null = appt.intakeData
    ? {
        id:       appt.intakeData.id,
        fields:   appt.intakeData.fields,
        signedAt: appt.intakeData.signedAt ? new Date(appt.intakeData.signedAt) : null,
      }
    : null;

  return (
    <div style={{ display: 'flex', gap: '0.75rem' }}>
      {/* ── Timeline dot + line ───────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: '0.625rem',
            height: '0.625rem',
            borderRadius: '50%',
            backgroundColor: appt.status === 'completed' ? '#059669' : 'var(--color-border)',
            marginTop: '0.3125rem',
            flexShrink: 0,
          }}
        />
        {!isLast && (
          <div style={{ width: '1px', flex: 1, backgroundColor: 'var(--color-border)', minHeight: '1.25rem', marginTop: '0.25rem' }} />
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.125rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-ink)' }}>
            {appt.serviceName}
          </p>
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '0.125rem 0.375rem',
              borderRadius: '9999px',
              backgroundColor: statusColor.bg,
              color: statusColor.text,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {STATUS_LABELS[appt.status] ?? appt.status}
          </span>
        </div>

        <p style={{ margin: '0 0 0.375rem', fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>
          {formatDate(appt.startsAt, timezone)}
        </p>

        {appt.hasIntake && intakeData && (
          <>
            <button
              onClick={() => setIntakeOpen((o) => !o)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: '0.75rem',
                color: 'var(--color-accent)',
                fontWeight: 500,
              }}
            >
              {intakeOpen ? '▲' : '▼'} Ver intake
            </button>
            {intakeOpen && (
              <div style={{ marginTop: '0.5rem' }}>
                <IntakeViewer intake={intakeData} />
              </div>
            )}
          </>
        )}

        {appt.hasIntake && !intakeData && (
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-ink-muted)' }}>
            Intake completado
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (w: string, h = '0.875rem') => (
    <div style={{ width: w, height: h, backgroundColor: 'var(--color-surface)', borderRadius: '0.25rem' }} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {bar('60%', '1.25rem')}
        {bar('40%')}
        {bar('50%')}
      </div>
      {/* Timeline items */}
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', backgroundColor: 'var(--color-surface)', marginTop: '0.3125rem', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {bar('55%')}
            {bar('35%', '0.75rem')}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PatientHistoryDrawer ──────────────────────────────────────────────────────

export function PatientHistoryDrawer({ patientId, timezone, onClose }: Props) {
  const isOpen = patientId !== null;

  const [history, setHistory]   = useState<ApiHistory | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Fetch on open ──────────────────────────────────────────────────────────

  const fetchHistory = useCallback(async (id: string) => {
    setLoading(true);
    setHistory(null);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      const auth = session ? `Bearer ${session.access_token}` : '';

      const res = await fetch(`/api/patients/${id}/history`, {
        headers: { Authorization: auth },
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as ApiHistory;
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientId) void fetchHistory(patientId);
  }, [patientId, fetchHistory]);

  // ── Keyboard close ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.35)',
          zIndex: 40,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
        aria-hidden="true"
      />

      {/* ── Drawer panel ──────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Expediente del paciente"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100dvh',
          width: 'min(90vw, 380px)',
          backgroundColor: 'var(--color-canvas)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY: 'auto',
        }}
      >
        {/* ── Drawer header ─────────────────────────────────────────── */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-ink)' }}>
            Expediente
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar expediente"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.25rem',
              color: 'var(--color-ink-muted)',
              lineHeight: 1,
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Content ───────────────────────────────────────────────── */}
        {loading && <Skeleton />}

        {error && (
          <div style={{ padding: '1.25rem' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#991B1B' }}>⚠ {error}</p>
          </div>
        )}

        {!loading && !error && history && (
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Patient summary ─────────────────────────────────── */}
            <div>
              <h2 style={{ margin: '0 0 0.25rem', fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-ink)' }}>
                {history.patient.name}
              </h2>
              <p style={{ margin: '0 0 0.125rem', fontSize: '0.875rem', color: 'var(--color-ink-muted)' }}>
                📱 {history.patient.phone}
              </p>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-ink-muted)' }}>
                {history.patient.totalVisits === 0
                  ? 'Sin visitas completadas'
                  : `${history.patient.totalVisits} ${history.patient.totalVisits === 1 ? 'visita completada' : 'visitas completadas'}`}
                {history.patient.firstVisit && (
                  <> · desde {formatShortDate(history.patient.firstVisit, timezone)}</>
                )}
              </p>
            </div>

            {/* ── Appointment timeline ────────────────────────────── */}
            {history.appointments.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-ink-muted)', textAlign: 'center', padding: '1rem 0' }}>
                Sin citas registradas
              </p>
            ) : (
              <div>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-ink-muted)' }}>
                  Historial de citas
                </p>
                <div>
                  {history.appointments.map((appt, idx) => (
                    <AppointmentRow
                      key={appt.id}
                      appt={appt}
                      timezone={timezone}
                      isLast={idx === history.appointments.length - 1}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Photo gallery ───────────────────────────────────── */}
            {history.appointments.length > 0 && (
              <PhotoGallery
                patientId={history.patient.id}
                timezone={timezone}
                appointments={history.appointments.map((a) => ({
                  id:          a.id,
                  serviceName: a.serviceName,
                  startsAt:    a.startsAt,
                }))}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
