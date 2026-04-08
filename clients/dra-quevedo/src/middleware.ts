// ─── Middleware — Auth Guard ───────────────────────────────────────────────────
// Runs at the edge before every request to /dashboard/*.
// Refreshes the Supabase session cookie if it's close to expiry, then
// redirects unauthenticated requests to /login.
//
// Note: middleware runs in the Edge Runtime. Do NOT import from next/headers
// here — use request.cookies directly via the @supabase/ssr API.

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // ── Create a cookie-aware Supabase client for this request ─────────────────
  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Propagate refreshed cookies to both the incoming request and the response
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // ── Verify session ─────────────────────────────────────────────────────────
  // getUser() validates the JWT against Supabase — getSession() only reads the
  // local cookie and can be spoofed. Always use getUser() in middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
