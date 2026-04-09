// ─── Portal del Paciente — Server Component ────────────────────────────────────
// Ruta pública: /paciente?token=eyJ...
// No requiere Supabase Auth — el JWT firmado es la única autenticación.
// La validación del token ocurre en el servidor antes de renderizar cualquier UI.
// El Client Component (PatientPortalView) maneja la UI interactiva.

import type { ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { verifyPatientPortalToken } from '@presenciapro/engine/portal';
import { generateCancelToken } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';
import { PatientPortalView } from './PatientPortalView';
import type {
  NextAppointmentData,
  PastAppointmentData,
  IntakeData,
} from './PatientPortalView';
import type { AppointmentStatus } from '@presenciapro/engine/scheduling';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = {
  title: 'Mi portal',
  robots: { index: false, follow: false },
};

// ─── DB row types ─────────────────────────────────────────────────────────────

type AppointmentRow = {
  id: string;
  patient_id: string;
  service_id: string;
  service_mode: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
};

type IntakeRow = {
  id: string;
  appointment_id: string;
  fields: Record<string, unknown>;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

function isCancellableNow(startsAt: Date, status: AppointmentStatus): boolean {
  if (status !== 'pending' && status !== 'confirmed') return false;
  const windowMs = clientConfig.scheduling.cancellationWindowHours * 60 * 60 * 1_000;
  return startsAt.getTime() - Date.now() > windowMs;
}

function resolveServiceName(serviceId: string): string {
  return clientConfig.services.find((s) => s.id === serviceId)?.name ?? serviceId;
}

// ─── Static UI ────────────────────────────────────────────────────────────────

const { whatsapp, whatsappMessage } = clientConfig.contact;
const whatsappUrl = `https://wa.me/${whatsapp}?text=${encodeURIComponent(whatsappMessage)}`;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: 'var(--color-canvas)',
        padding: '2rem 1rem 3rem',
      }}
    >
      <div style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div style={{ marginBottom: '1.75rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-ink-muted)',
              marginBottom: '0.375rem',
              fontFamily: 'var(--font-body)',
            }}
          >
            Portal del paciente
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.5rem',
              fontWeight: 600,
              color: 'var(--color-ink)',
              margin: 0,
            }}
          >
            {clientConfig.client.name}
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function InvalidTokenMessage() {
  return (
    <PageShell>
      <div
        style={{
          textAlign: 'center',
          padding: '1.5rem',
          backgroundColor: 'var(--color-surface)',
          borderRadius: '0.5rem',
          border: '1px solid var(--color-border)',
        }}
      >
        <p style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>🔒</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            color: 'var(--color-ink)',
            marginBottom: '0.75rem',
          }}
        >
          Link no válido
        </h2>
        <p
          style={{
            color: 'var(--color-ink-muted)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            marginBottom: '1.25rem',
          }}
        >
          Este link no es válido o ya expiró. Escríbenos por WhatsApp para obtener uno nuevo.
        </p>
        <a
          href={whatsappUrl}
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            backgroundColor: '#25D366',
            color: '#ffffff',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            fontSize: '0.9375rem',
            fontWeight: 600,
          }}
        >
          Escribir por WhatsApp
        </a>
      </div>
    </PageShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PacientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenParam = params['token'];
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  // Guard: no token en la URL
  if (!token) return <InvalidTokenMessage />;

  // Guard: verificar firma JWT, expiración y discriminador de tipo
  const decoded = verifyPatientPortalToken(token);
  if (!decoded) return <InvalidTokenMessage />;

  // Guard: el token debe ser para esta instancia de cliente
  if (decoded.clientId !== clientConfig.client.id) return <InvalidTokenMessage />;

  const { patientId, clientId } = decoded;
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();

  // ── Próxima cita ──────────────────────────────────────────────────────────
  const { data: nextRows } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, service_mode, starts_at, ends_at, status')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .not('status', 'in', '("cancelled","no_show","completed","emergency_blocked")')
    .gt('starts_at', now)
    .order('starts_at', { ascending: true })
    .limit(1)
    .returns<AppointmentRow[]>();

  const nextRow = (nextRows ?? [])[0] ?? null;

  let nextAppointment: NextAppointmentData | null = null;
  if (nextRow) {
    const startsAt = new Date(nextRow.starts_at);
    const cancellable = isCancellableNow(startsAt, nextRow.status);
    const cancelToken = cancellable
      ? generateCancelToken({ appointmentId: nextRow.id, patientId, clientId })
      : null;

    nextAppointment = {
      id: nextRow.id,
      startsAt: nextRow.starts_at,
      endsAt: nextRow.ends_at,
      serviceId: nextRow.service_id,
      serviceName: resolveServiceName(nextRow.service_id),
      serviceMode: nextRow.service_mode as 'domicilio' | 'consultorio',
      status: nextRow.status,
      cancelToken,
    };
  }

  // ── Historial (últimas 5 completadas/canceladas/no_show) ──────────────────
  const { data: pastRows } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, service_mode, starts_at, ends_at, status')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .in('status', ['completed', 'cancelled', 'no_show'])
    .order('starts_at', { ascending: false })
    .limit(5)
    .returns<AppointmentRow[]>();

  const pastAppointments: readonly PastAppointmentData[] = (pastRows ?? []).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    serviceId: row.service_id,
    serviceName: resolveServiceName(row.service_id),
    status: row.status as 'completed' | 'cancelled' | 'no_show',
  }));

  // ── Intakes completados ───────────────────────────────────────────────────
  // Los campos contienen datos médicos — nunca se loguean
  const { data: intakeRows } = await supabase
    .from('intakes')
    .select('id, appointment_id, fields, created_at')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .returns<IntakeRow[]>();

  // Resolver serviceId desde las citas asociadas
  const intakeAppointmentIds = (intakeRows ?? []).map((i) => i.appointment_id);
  let appointmentServiceMap: Record<string, string> = {};

  if (intakeAppointmentIds.length > 0) {
    const { data: apptRows } = await supabase
      .from('appointments')
      .select('id, service_id')
      .eq('client_id', clientId)
      .in('id', intakeAppointmentIds)
      .returns<{ id: string; service_id: string | null }[]>();

    appointmentServiceMap = Object.fromEntries(
      (apptRows ?? []).map((a) => [a.id, a.service_id ?? '']),
    );
  }

  const intakes: readonly IntakeData[] = (intakeRows ?? []).map((row) => {
    const serviceId = appointmentServiceMap[row.appointment_id] ?? null;
    return {
      id: row.id,
      appointmentId: row.appointment_id,
      serviceId,
      serviceName: serviceId ? resolveServiceName(serviceId) : null,
      fields: row.fields,
      createdAt: row.created_at,
    };
  });

  return (
    <PageShell>
      <PatientPortalView
        clientName={clientConfig.client.name}
        timezone={clientConfig.client.timezone}
        primaryColor={clientConfig.design.colors.primary}
        whatsappUrl={whatsappUrl}
        nextAppointment={nextAppointment}
        pastAppointments={pastAppointments}
        intakes={intakes}
      />
    </PageShell>
  );
}
