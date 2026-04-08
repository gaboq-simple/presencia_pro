'use client';

// ─── Logout Button ────────────────────────────────────────────────────────────
// Client Component — calls Supabase Auth signOut and redirects to /login.
// Isolated here so the dashboard layout can stay a Server Component.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isPending}
      style={{
        padding: '0.375rem 0.875rem',
        border: '1px solid var(--color-border)',
        borderRadius: '0.375rem',
        backgroundColor: 'transparent',
        color: 'var(--color-ink-muted)',
        fontSize: '0.875rem',
        cursor: isPending ? 'not-allowed' : 'pointer',
      }}
    >
      {isPending ? '…' : 'Salir'}
    </button>
  );
}
