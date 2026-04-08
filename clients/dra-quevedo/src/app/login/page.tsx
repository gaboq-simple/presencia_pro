'use client';

// ─── Login Page ───────────────────────────────────────────────────────────────
// Email + password login for the Dra. Quevedo dashboard.
// No registration UI — the doctor's account is created through Supabase directly.
// On successful login, redirects to /dashboard.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('Correo o contraseña incorrectos.');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-canvas)',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '22rem',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.08em',
              color: 'var(--color-ink-muted)',
              textTransform: 'uppercase',
              marginBottom: '0.5rem',
              fontFamily: 'var(--font-body)',
            }}
          >
            Panel operacional
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
            Dra. Quevedo
          </h1>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label
              htmlFor="email"
              style={{
                fontSize: '0.875rem',
                color: 'var(--color-ink)',
                fontWeight: 500,
              }}
            >
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: '0.625rem 0.75rem',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                fontSize: '1rem',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-ink)',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <label
              htmlFor="password"
              style={{
                fontSize: '0.875rem',
                color: 'var(--color-ink)',
                fontWeight: 500,
              }}
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                padding: '0.625rem 0.75rem',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                fontSize: '1rem',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-ink)',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Error message */}
          {error && (
            <p
              style={{
                color: '#B91C1C',
                fontSize: '0.875rem',
                margin: 0,
                padding: '0.5rem 0.75rem',
                backgroundColor: '#FEF2F2',
                borderRadius: '0.375rem',
                border: '1px solid #FECACA',
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            style={{
              padding: '0.75rem',
              backgroundColor: isPending ? 'var(--color-accent-lg)' : 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: isPending ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
              marginTop: '0.25rem',
            }}
          >
            {isPending ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
