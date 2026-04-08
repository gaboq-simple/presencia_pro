'use client';

// ─── CancelActions — Client Component ────────────────────────────────────────
// Muestra dos botones: cancelar cita y mantener cita.
// El botón de cancelar hace POST a /api/appointments/cancel-by-patient.

import { useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type State = 'idle' | 'loading' | 'cancelled' | 'kept' | 'error';

// ─── CancelActions ─────────────────────────────────────────────────────────────

export function CancelActions({
  token,
  primaryColor,
  clientName,
}: {
  readonly token: string;
  readonly primaryColor: string;
  readonly clientName: string;
}) {
  const [state, setState] = useState<State>('idle');

  async function handleCancel() {
    setState('loading');
    try {
      const res = await fetch('/api/appointments/cancel-by-patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
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

  function handleKeep() {
    setState('kept');
  }

  if (state === 'cancelled') {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
        <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✅</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            color: 'var(--color-ink)',
            marginBottom: '0.5rem',
          }}
        >
          Tu cita ha sido cancelada
        </h2>
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
          Si deseas agendar en otro momento, escríbenos por WhatsApp y con gusto te ayudamos.
        </p>
      </div>
    );
  }

  if (state === 'kept') {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
        <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🌸</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            color: 'var(--color-ink)',
            marginBottom: '0.5rem',
          }}
        >
          ¡Te esperamos!
        </h2>
        <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.9375rem', lineHeight: 1.6 }}>
          Tu cita sigue confirmada. Nos vemos pronto.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
        <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</p>
        <p
          style={{
            color: 'var(--color-ink-muted)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            marginBottom: '1rem',
          }}
        >
          Ocurrió un error al cancelar. Por favor escríbenos directamente y te ayudamos.
        </p>
      </div>
    );
  }

  const isLoading = state === 'loading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Mantener cita — acción positiva primero */}
      <button
        onClick={handleKeep}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '0.875rem 1rem',
          backgroundColor: primaryColor,
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
          fontFamily: 'var(--font-body)',
        }}
      >
        Mantener mi cita
      </button>

      {/* Cancelar cita */}
      <button
        onClick={handleCancel}
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '0.875rem 1rem',
          backgroundColor: 'transparent',
          color: 'var(--color-ink-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          fontWeight: 500,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
          fontFamily: 'var(--font-body)',
        }}
      >
        {isLoading ? 'Cancelando…' : 'Cancelar mi cita'}
      </button>
    </div>
  );
}
