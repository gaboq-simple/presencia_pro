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
import {
  verifySession,
  signSession,
  makeSessionPayload,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/session';

// ─── Supabase REST token lookup (Edge-compatible) ─────────────────────────────

type TokenResult =
  | { kind: 'organization'; organization_id: string; business_ids: string[] }
  | null;

async function findTokenResult(token: string): Promise<TokenResult> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;

  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };

  // TODO (A-1 — tokens sin expiración): organizations.access_token es un string
  // estático sin fecha de expiración en la DB. Si se filtra (logs, historial del
  // navegador, pantalla compartida) el acceso es permanente hasta rotación manual.
  // Solución: agregar `token_expires_at TIMESTAMPTZ` en organizations y rotar.

  // 1. (RETIRADO) businesses.access_token ya NO otorga sesión: el DUEÑO entra por
  //    email+contraseña (Supabase Auth — ver /login + auth.ts, staff_id real que
  //    firma el audit). Con esto muere también el hint ?role=assistant, que dejaba
  //    al token del dueño operar la mesa de control con staff_id=null (filas
  //    'unknown' en appointment_audit). La columna sigue en la DB (borrado aparte).
  // 2. (RETIRADO) businesses.assistant_token: el asistente entra por PIN.

  // 3. organizations.access_token → grupo de sucursales (dueño multi-sucursal).
  //    ÚNICO mecanismo de token que queda; independiente de businesses.
  const orgRes = await fetch(
    `${url}/rest/v1/organizations?select=id&access_token=eq.${encodeURIComponent(token)}&limit=1`,
    { headers },
  );
  if (orgRes.ok) {
    const orgRows = (await orgRes.json()) as { id: string }[];
    if (orgRows.length > 0 && orgRows[0]) {
      const organizationId = orgRows[0].id;
      // Cargar todas las sucursales activas de esta organización
      const bizRes = await fetch(
        `${url}/rest/v1/businesses?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&active=eq.true`,
        { headers },
      );
      if (bizRes.ok) {
        const bizRows = (await bizRes.json()) as { id: string }[];
        return {
          kind: 'organization',
          organization_id: organizationId,
          business_ids: bizRows.map((r) => r.id),
        };
      }
    }
  }

  return null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isProd = process.env['NODE_ENV'] === 'production';
  const { pathname } = request.nextUrl;

  // ── 1. ?token= in URL — SOLO organización (dueño multi-sucursal). El token de
  //    sucursal (businesses.access_token) fue retirado: el dueño entra por email.
  //    El hint ?role= murió con él (ya no se lee) → no hay forma de pedir una
  //    sesión de asistente por token. Un token de sucursal viejo ya no matchea y
  //    cae al /login de abajo.
  if (pathname.startsWith('/dashboard')) {
    const token = request.nextUrl.searchParams.get('token');
    if (token) {
      const result = await findTokenResult(token);
      if (result) {
        const payload = makeSessionPayload({
          type: 'organization',
          organization_id: result.organization_id,
          business_ids: result.business_ids,
          role: 'owner',
        } as const);
        const cookieValue = await signSession(payload);
        const redirectUrl = new URL('/dashboard', request.url);
        const response = NextResponse.redirect(redirectUrl);
        response.cookies.set(SESSION_COOKIE, cookieValue, sessionCookieOptions(isProd));
        return response;
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // ── 2. ls_session cookie (PIN/token auth) ──────────────────────────────────
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
