// ─── Intake Page — Server Component ───────────────────────────────────────────
// Public route: /intake?token=eyJ...
// No Supabase Auth required — the signed JWT is the only authentication.
// Token validation happens server-side before any form is rendered.
// The Client Component (IntakeForm) handles the interactive form + canvas signature.

import type { ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { verifyIntakeToken, getFieldsForClient } from '@presenciapro/engine/intake';
import { clientConfig } from '@/config/client.config';
import { IntakeForm } from './IntakeForm';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata = {
  title: 'Formulario de consulta',
  robots: { index: false, follow: false },
};

// ─── Token states ──────────────────────────────────────────────────────────────

type PageState = 'invalid' | 'already_used' | 'valid';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

async function resolvePageState(token: string): Promise<PageState> {
  // 1. Verify JWT signature and expiration
  const decoded = verifyIntakeToken(token);
  if (!decoded) return 'invalid';

  // 2. Guard: token must be for this client
  if (decoded.clientId !== clientConfig.client.id) return 'invalid';

  // 3. Check if an intake was already submitted for this appointment
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from('intakes')
    .select('id')
    .eq('appointment_id', decoded.appointmentId)
    .eq('client_id', decoded.clientId)
    .maybeSingle();

  if (data) return 'already_used';
  return 'valid';
}

// ─── Static UI components ─────────────────────────────────────────────────────

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
        {/* Header */}
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
            Formulario pre-consulta
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
          Este link ya no es válido o ha expirado. Por favor contacta a la{' '}
          {clientConfig.client.name} para recibir un nuevo formulario.
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

function AlreadyUsedMessage() {
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
        <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🌸</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            color: 'var(--color-ink)',
            marginBottom: '0.5rem',
          }}
        >
          ¡Tu formulario ya está completo!
        </h2>
        <p
          style={{
            color: 'var(--color-ink-muted)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
          }}
        >
          Nos vemos en tu cita 🌸
        </p>
      </div>
    </PageShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenParam = params['token'];
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  // Guard: no token in URL
  if (!token) return <InvalidTokenMessage />;

  const state = await resolvePageState(token);

  if (state === 'invalid') return <InvalidTokenMessage />;
  if (state === 'already_used') return <AlreadyUsedMessage />;

  // Valid token — render the form
  const intakeFields = getFieldsForClient(clientConfig.intake.fields);

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
        <p
          style={{
            fontSize: '0.9375rem',
            color: 'var(--color-ink-muted)',
            lineHeight: 1.6,
            marginBottom: '1.5rem',
          }}
        >
          Por favor completa este breve formulario antes de tu consulta.
          Tus datos están protegidos y solo serán vistos por la doctora.
        </p>

        <IntakeForm
          token={token}
          fields={intakeFields}
          requiresSignature={clientConfig.intake.requiresSignature}
          signatureLabel={clientConfig.intake.signatureLabel}
          privacyUrl={clientConfig.intake.privacyUrl}
          primaryColor={primaryColor}
        />
      </div>
    </PageShell>
  );
}
