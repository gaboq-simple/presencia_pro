// ─── Proxy — Auth Guard ────────────────────────────────────────────────────────
// Next.js 16 renamed the "middleware" convention to "proxy".
// Runs at the edge before every matched request.
// Supports two auth mechanisms:
//   1. ls_session cookie (PIN/token auth) — checked first.
//   2. Supabase Auth JWT — backward-compat for email/password users.
//   - /[slug] routes are public — never blocked.
//
// Note: proxy runs in the Edge Runtime. Do NOT import from next/headers —
// use request.cookies directly.

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';

// ─── Auth por token RETIRADO ──────────────────────────────────────────────────
// Ya NO hay ninguna sesión por token compartido en la URL. Las tres puertas de token
// murieron: businesses.access_token (dueño → ahora email), assistant_token (asistente
// → ahora PIN), y organizations.access_token (organización — retirada acá; era la
// última puerta compartida, acceso sin identidad → audit ciego). El acceso es siempre
// con identidad real: email (Supabase Auth) o PIN (ls_session 'staff'). Un ?token=
// viejo simplemente se ignora y cae al /login.

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── 1. ls_session cookie (PIN / email) ─────────────────────────────────────
  const lsCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (lsCookie) {
    const session = await verifySession(lsCookie);
    if (session) {
      // /login queda SIEMPRE accesible — NO auto-redirigimos a /dashboard. Sin esto,
      // una compu con una ls_session vieja (PIN/token) rebotaba al dueño a /dashboard
      // con la identidad equivocada y nunca veía el formulario para entrar por email.
      // LoginForm limpia la ls_session vieja al enviar (POST /api/auth/logout).
      return NextResponse.next({ request });
    }
  }

  // ── 3. Supabase Auth JWT (backward-compat) ─────────────────────────────────
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
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

  const { data: { user } } = await supabase.auth.getUser();

  // /login queda accesible aun con sesión de Supabase activa (permite re-loguearse
  // o cambiar de cuenta). No auto-redirigimos a /dashboard — es una conveniencia,
  // no seguridad, y chocaba con el re-login del dueño.

  // Guard: redirect unauthenticated users away from protected routes.
  // /[slug] is intentionally NOT in this list — it is public.
  // /staff is intentionally NOT guarded here — the page renders PinForm when there is no session.
  if (pathname.startsWith('/dashboard') && !user) {
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
     *
     * /[slug] routes are matched but the guard above does not block them.
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/).*)',
  ],
};
