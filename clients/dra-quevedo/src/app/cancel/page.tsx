// ─── Cancel Page — Server Component ──────────────────────────────────────────
// Public route: /cancel?token=eyJ...
// No Supabase Auth required — the signed JWT is the only authentication.
// Token validation happens server-side before any UI is rendered.
// The Client Component (CancelActions) handles the interactive confirm/keep buttons.

import type { ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { verifyCancelToken } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';
import { CancelActions } from './CancelActions';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = {
  title: 'Cancelar cita',
  robots: { index: false, follow: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: clientConfig.client.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// ─── Static UI ────────────────────────────────────────────────────────────────

const { whatsapp, whatsappMessage } = clientConfig.contact;
const whatsappUrl = `https://wa.me/${whatsapp}?text=${encodeURIComponent(whatsappMessage)}`;
const primaryColor = clientConfig.design.colors.primary;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: 'var(--color-canvas)',
        padding: '2rem 1rem 3rem',
      }}
    >
      <div style={{ maxWidth: '28rem', margin: '0 auto' }}>
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
            Gestión de cita
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
          Este link ha expirado o no es válido. Por favor contáctanos directamente.
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

export default async function CancelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenParam = params['token'];
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  // Guard: no token in URL
  if (!token) return <InvalidTokenMessage />;

  // Guard: verify JWT signature, expiration, and type discriminator
  const decoded = verifyCancelToken(token);
  if (!decoded) return <InvalidTokenMessage />;

  // Guard: token must be for this client instance
  if (decoded.clientId !== clientConfig.client.id) return <InvalidTokenMessage />;

  // ── Load appointment details ──────────────────────────────────────────────
  const supabase = getServiceRoleClient();

  const { data: row } = await supabase
    .from('appointments')
    .select('starts_at, service_id, specialist_id, status')
    .eq('id', decoded.appointmentId)
    .eq('client_id', decoded.clientId)
    .single();

  if (!row) return <InvalidTokenMessage />;

  const appt = row as {
    starts_at: string;
    service_id: string;
    specialist_id: string;
    status: string;
  };

  // Already cancelled — show idempotent message
  if (appt.status === 'cancelled') {
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
          <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✅</p>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              color: 'var(--color-ink)',
              marginBottom: '0.5rem',
            }}
          >
            Tu cita ya fue cancelada
          </h2>
          <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            Si quieres agendar en otro momento, escríbenos y con gusto te ayudamos.
          </p>
        </div>
      </PageShell>
    );
  }

  // Resolve display names from config
  const service    = clientConfig.services.find((s) => s.id === appt.service_id);
  const specialist = clientConfig.specialists.find((s) => s.id === appt.specialist_id);
  const fecha      = formatDate(new Date(appt.starts_at));

  return (
    <PageShell>
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: '0.5rem',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        {/* Appointment summary */}
        <div style={{ marginBottom: '1.5rem' }}>
          <p
            style={{
              fontSize: '0.8125rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-ink-muted)',
              marginBottom: '0.5rem',
              fontFamily: 'var(--font-body)',
            }}
          >
            Tu cita
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Servicio',    service?.name    ?? appt.service_id],
                ['Con',         specialist?.name ?? appt.specialist_id],
                ['Fecha',       fecha],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td
                    style={{
                      padding: '0.375rem 0',
                      color: 'var(--color-ink-muted)',
                      fontSize: '0.875rem',
                      width: '6rem',
                      verticalAlign: 'top',
                    }}
                  >
                    {label}
                  </td>
                  <td
                    style={{
                      padding: '0.375rem 0',
                      color: 'var(--color-ink)',
                      fontSize: '0.9375rem',
                      fontWeight: 500,
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--color-border)',
            marginBottom: '1.25rem',
          }}
        />

        <p
          style={{
            color: 'var(--color-ink-muted)',
            fontSize: '0.875rem',
            lineHeight: 1.6,
            marginBottom: '1.25rem',
          }}
        >
          ¿Deseas cancelar esta cita o prefieres mantenerla?
        </p>

        <CancelActions
          token={token}
          primaryColor={primaryColor}
          clientName={clientConfig.client.name}
        />
      </div>
    </PageShell>
  );
}
