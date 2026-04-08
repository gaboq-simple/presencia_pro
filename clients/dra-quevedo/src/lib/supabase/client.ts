// ─── Supabase Browser Client ───────────────────────────────────────────────────
// Cookie-aware browser client for Client Components.
// Uses @supabase/ssr so session cookies are read/written consistently with
// the server-side client — both share the same cookie keys.
//
// Singleton: createBrowserClient returns the same instance on re-renders.
// Only used for auth operations in Client Components (login, logout).

import { createBrowserClient } from '@supabase/ssr';

/**
 * Returns a Supabase client for use in browser (Client) Components.
 * Safe to call on every render — createBrowserClient is memoized internally.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  );
}
