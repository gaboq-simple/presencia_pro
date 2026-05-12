// ─── Supabase Browser Client ───────────────────────────────────────────────────
// Singleton browser client for Client Components.
// Uses @supabase/ssr createBrowserClient so session cookies are shared
// with the server client automatically.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  );
}
