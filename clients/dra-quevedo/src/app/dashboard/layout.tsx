// ─── Dashboard Layout ─────────────────────────────────────────────────────────
// Protected layout for /dashboard/*. Verifies the user's session server-side
// before rendering any child route. Middleware already redirects unauthenticated
// requests — this is a second layer that guards against edge cases.
//
// Provides the top bar with the doctor's name and a logout button.

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { clientConfig } from '@/config/client.config';
import LogoutButton from './LogoutButton';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Verify session ────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: 'var(--color-canvas)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: '0.75rem',
              color: 'var(--color-ink-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-body)',
            }}
          >
            Panel
          </p>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: '1.0625rem',
              fontWeight: 600,
              color: 'var(--color-ink)',
              lineHeight: 1.2,
            }}
          >
            {clientConfig.client.name}
          </h1>
        </div>

        <LogoutButton />
      </header>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '1.25rem', maxWidth: '48rem', width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
