// ─── Middleware → Proxy — Auth Guard ──────────────────────────────────────────
// Next.js 16 renamed the "middleware" convention to "proxy" (rename to
// proxy.ts when ready — the file works under both names during the transition).
// Runs at the edge before every matched request.
// Refreshes the Supabase session cookie when close to expiry, then:
//   - Authenticated users hitting /login are redirected to /dashboard
//     (pages themselves redirect operators to /admin via requireRole).
//   - Unauthenticated users hitting protected routes are redirected to /login.
//
// Role verification (is_operator) is the responsibility of each page via
// requireRole() — never done here to keep middleware lightweight.
//
// Note: middleware runs in the Edge Runtime. Do NOT import from next/headers —
// use request.cookies directly via the @supabase/ssr API.

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // ── Cookie-aware Supabase client for this edge request ─────────────────────
  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

  const { pathname } = request.nextUrl;

  // Guard: redirect authenticated users away from /login
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Guard: redirect unauthenticated users away from protected routes
  if ((pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimization)
     * - favicon.ico
     * - manifest.json
     * - icons/        (PWA icons)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/).*)',
  ],
};
