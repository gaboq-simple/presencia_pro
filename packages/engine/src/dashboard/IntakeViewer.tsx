'use client';

// ─── IntakeViewer ─────────────────────────────────────────────────────────────
// Renders the pre-consultation intake data for a single appointment.
// Shows field labels in Spanish and their values in a clean list.
// Designed to be embedded inside an AppointmentCard as a collapsible panel.

import type { IntakeData } from './types.js';

type IntakeViewerProps = {
  readonly intake: IntakeData;
};

const cellStyle: React.CSSProperties = {
  padding: '0.5rem 0',
  borderBottom: '1px solid var(--color-border)',
};

export function IntakeViewer({ intake }: IntakeViewerProps) {
  const { fields, signedAt } = intake;

  return (
    <div
      style={{
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <p
        style={{
          margin: '0 0 0.625rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-ink-muted)',
        }}
      >
        Intake pre-consulta
        {signedAt && (
          <span style={{ fontWeight: 400, marginLeft: '0.5rem' }}>
            · firmado{' '}
            {signedAt.toLocaleDateString('es-MX', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        )}
      </p>

      <dl style={{ margin: 0 }}>
        {fields.map((field) => (
          <div key={field.key} style={cellStyle}>
            <dt
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-ink-muted)',
                marginBottom: '0.125rem',
              }}
            >
              {field.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: '0.9375rem',
                color: 'var(--color-ink)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {field.value || <span style={{ color: 'var(--color-ink-muted)' }}>—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
