// ─── Supabase Server Client ────────────────────────────────────────────────────
// Cookie-aware server client for session reading in Server Components,
// Server Actions, and Route Handlers. Uses @supabase/ssr so session cookies
// are read/written correctly in the Next.js App Router.
//
// Rule: use this client ONLY to verify auth (anon key + user session).
//       For data operations, use createClient(url, serviceRoleKey) directly.
//       Never expose the service role key through this client.

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Creates a Supabase client that reads the user's session from cookies.
 * Must be called inside a Server Component, Server Action, or Route Handler.
 * Uses the anon key — only call supabase.auth.getUser() with this client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies — calls from Server Actions
            // and Route Handlers will set them correctly.
          }
        },
      },
    },
  );
}
