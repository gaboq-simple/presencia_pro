'use client';

// ─── PatientPortalView — Client Component ─────────────────────────────────────
// Recibe los datos ya validados del Server Component.
// Renderiza los tres bloques del portal: próxima cita, historial e intakes.
// El botón "Cancelar cita" llama al endpoint existente cancel-by-patient.

import { useState } from 'react';
import type { AppointmentStatus } from '@presenciapro/engine/scheduling';

// ─── Types (exportados para ser usados en page.tsx) ───────────────────────────

export type NextAppointmentData = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly status: AppointmentStatus;
  readonly cancelToken: string | null;
};

export type PastAppointmentData = {
  readonly id: string;
  readonly startsAt: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly status: 'completed' | 'cancelled' | 'no_show';
};

export type IntakeData = {
  readonly id: string;
  readonly appointmentId: string;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly fields: Record<string, unknown>;
  readonly createdAt: string;
};

type Props = {
  readonly clientName: string;
  readonly timezone: string;
  readonly primaryColor: string;
  readonly whatsappUrl: string;
  readonly nextAppointment: NextAppointmentData | null;
  readonly pastAppointments: readonly PastAppointmentData[];
  readonly intakes: readonly IntakeData[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));
}

function formatDateShort(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(isoString));
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function statusLabel(status: 'completed' | 'cancelled' | 'no_show'): string {
  switch (status) {
    case 'completed':  return 'Completada';
    case 'cancelled':  return 'Cancelada';
    case 'no_show':    return 'No asistió';
  }
}

function statusColor(status: 'completed' | 'cancelled' | 'no_show'): string {
  switch (status) {
    case 'completed':  return '#16a34a';
    case 'cancelled':  return '#6b7280';
    case 'no_show':    return '#dc2626';
  }
}

function serviceModeLabel(mode: 'domicilio' | 'consultorio'): string {
  return mode === 'domicilio' ? 'A domicilio' : 'En consultorio';
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: string }) {
  return (
    <p
      style={{
        fontSize: '0.75rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-ink-muted)',
        marginBottom: '0.75rem',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
      }}
    >
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: '0.5rem',
        border: '1px solid var(--color-border)',
        padding: '1.25rem',
      }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td
        style={{
          padding: '0.3rem 0',
          color: 'var(--color-ink-muted)',
          fontSize: '0.875rem',
          width: '7rem',
          verticalAlign: 'top',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '0.3rem 0',
          color: 'var(--color-ink)',
          fontSize: '0.9375rem',
          fontWeight: 500,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

// ─── CancelButton ─────────────────────────────────────────────────────────────

type CancelState = 'idle' | 'loading' | 'cancelled' | 'error';

function CancelButton({
  cancelToken,
  primaryColor,
}: {
  readonly cancelToken: string;
  readonly primaryColor: string;
}) {
  const [state, setState] = useState<CancelState>('idle');

  async function handleCancel() {
    setState('loading');
    try {
      const res = await fetch('/api/appointments/cancel-by-patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cancelToken }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setState('cancelled');
    } catch {
      setState('error');
    }
  }

  if (state === 'cancelled') {
    return (
      <div
        style={{
          marginTop: '1rem',
          padding: '0.875rem',
          backgroundColor: 'var(--color-canvas)',
          borderRadius: '0.375rem',
          border: '1px solid var(--color-border)',
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.875rem', margin: 0 }}>
          ✅ Tu cita ha sido cancelada. Escríbenos si deseas reagendar.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        style={{
          marginTop: '1rem',
          padding: '0.875rem',
          backgroundColor: 'var(--color-canvas)',
          borderRadius: '0.375rem',
          border: '1px solid var(--color-border)',
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.875rem', margin: 0 }}>
          ⚠️ No se pudo cancelar. Por favor escríbenos por WhatsApp.
        </p>
      </div>
    );
  }

  const isLoading = state === 'loading';

  return (
    <button
      onClick={handleCancel}
      disabled={isLoading}
      style={{
        marginTop: '1rem',
        width: '100%',
        padding: '0.75rem 1rem',
        backgroundColor: 'transparent',
        color: primaryColor,
        border: `1px solid ${primaryColor}`,
        borderRadius: '0.5rem',
        fontSize: '0.9375rem',
        fontWeight: 500,
        cursor: isLoading ? 'not-allowed' : 'pointer',
        opacity: isLoading ? 0.6 : 1,
        fontFamily: 'var(--font-body)',
      }}
    >
      {isLoading ? 'Cancelando…' : 'Cancelar cita'}
    </button>
  );
}

// ─── IntakeItem ───────────────────────────────────────────────────────────────

function IntakeItem({
  intake,
  timezone,
}: {
  readonly intake: IntakeData;
  readonly timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const fieldEntries = Object.entries(intake.fields).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  return (
    <div
      style={{
        borderBottom: '1px solid var(--color-border)',
        paddingBottom: '0.875rem',
        marginBottom: '0.875rem',
      }}
    >
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '0',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textAlign: 'left',
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: '0.9375rem',
              fontWeight: 500,
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-body)',
            }}
          >
            {intake.serviceName ?? 'Consulta'}
          </p>
          <p
            style={{
              margin: '0.125rem 0 0',
              fontSize: '0.8125rem',
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
            }}
          >
            {capitalize(formatDateShort(intake.createdAt, timezone))}
          </p>
        </div>
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-ink-muted)',
            marginLeft: '1rem',
            flexShrink: 0,
          }}
        >
          {expanded ? '▲ Ocultar' : '▼ Ver'}
        </span>
      </button>

      {expanded && fieldEntries.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {fieldEntries.map(([key, value]) => (
                <tr key={key}>
                  <td
                    style={{
                      padding: '0.25rem 0',
                      color: 'var(--color-ink-muted)',
                      fontSize: '0.8125rem',
                      width: '10rem',
                      verticalAlign: 'top',
                    }}
                  >
                    {key.replace(/_/g, ' ')}
                  </td>
                  <td
                    style={{
                      padding: '0.25rem 0',
                      color: 'var(--color-ink)',
                      fontSize: '0.875rem',
                    }}
                  >
                    {String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && fieldEntries.length === 0 && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--color-ink-muted)',
          }}
        >
          Sin campos registrados.
        </p>
      )}
    </div>
  );
}

// ─── PatientPortalView ────────────────────────────────────────────────────────

export function PatientPortalView({
  timezone,
  primaryColor,
  whatsappUrl,
  nextAppointment,
  pastAppointments,
  intakes,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Bloque 1: Próxima cita ─────────────────────────────────────────── */}
      <section>
        <SectionTitle>Próxima cita</SectionTitle>
        <Card>
          {nextAppointment === null ? (
            <p
              style={{
                color: 'var(--color-ink-muted)',
                fontSize: '0.9375rem',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              No tienes citas próximas agendadas.
            </p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <InfoRow
                    label="Fecha"
                    value={capitalize(formatDateTime(nextAppointment.startsAt, timezone))}
                  />
                  <InfoRow label="Servicio" value={nextAppointment.serviceName} />
                  <InfoRow label="Modalidad" value={serviceModeLabel(nextAppointment.serviceMode)} />
                </tbody>
              </table>

              {nextAppointment.cancelToken !== null && (
                <CancelButton
                  cancelToken={nextAppointment.cancelToken}
                  primaryColor={primaryColor}
                />
              )}
            </>
          )}
        </Card>
      </section>

      {/* ── Bloque 2: Historial de citas ───────────────────────────────────── */}
      <section>
        <SectionTitle>Historial de citas</SectionTitle>
        <Card>
          {pastAppointments.length === 0 ? (
            <p
              style={{
                color: 'var(--color-ink-muted)',
                fontSize: '0.9375rem',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Aún no tienes citas anteriores registradas.
            </p>
          ) : (
            <div>
              {pastAppointments.map((appt, index) => (
                <div
                  key={appt.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    paddingTop: index === 0 ? 0 : '0.75rem',
                    paddingBottom:
                      index === pastAppointments.length - 1 ? 0 : '0.75rem',
                    borderBottom:
                      index === pastAppointments.length - 1
                        ? 'none'
                        : '1px solid var(--color-border)',
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '0.9375rem',
                        fontWeight: 500,
                        color: 'var(--color-ink)',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {appt.serviceName}
                    </p>
                    <p
                      style={{
                        margin: '0.125rem 0 0',
                        fontSize: '0.8125rem',
                        color: 'var(--color-ink-muted)',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {capitalize(formatDateShort(appt.startsAt, timezone))}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: statusColor(appt.status),
                      marginLeft: '1rem',
                      flexShrink: 0,
                      marginTop: '0.125rem',
                    }}
                  >
                    {statusLabel(appt.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ── Bloque 3: Mis formularios ──────────────────────────────────────── */}
      <section>
        <SectionTitle>Mis formularios</SectionTitle>
        <Card>
          {intakes.length === 0 ? (
            <p
              style={{
                color: 'var(--color-ink-muted)',
                fontSize: '0.9375rem',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              No tienes formularios completados aún.
            </p>
          ) : (
            <div>
              {intakes.map((intake, index) => (
                <div
                  key={intake.id}
                  style={{
                    paddingBottom: index === intakes.length - 1 ? 0 : undefined,
                  }}
                >
                  <IntakeItem intake={intake} timezone={timezone} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ── Footer: enlace a WhatsApp ──────────────────────────────────────── */}
      <div style={{ textAlign: 'center', paddingTop: '0.5rem' }}>
        <a
          href={whatsappUrl}
          style={{
            fontSize: '0.875rem',
            color: 'var(--color-ink-muted)',
            textDecoration: 'underline',
            fontFamily: 'var(--font-body)',
          }}
        >
          ¿Necesitas ayuda? Escríbenos por WhatsApp
        </a>
      </div>

    </div>
  );
}
