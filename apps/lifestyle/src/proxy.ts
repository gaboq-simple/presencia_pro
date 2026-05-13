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
  | { kind: 'business'; id: string; role: 'owner' | 'assistant' }
  | { kind: 'organization'; organization_id: string; business_ids: string[] }
  | null;

async function findTokenResult(
  token: string,
  roleHint: string | null,
): Promise<TokenResult> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;

  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const isAssistantHint = roleHint === 'assistant';

  // TODO (A-1 — tokens sin expiración): access_token y assistant_token son
  // strings estáticos sin fecha de expiración en la DB. Si se filtran (logs,
  // historial del navegador, pantalla compartida) el acceso es permanente hasta
  // rotación manual. Solución: agregar `token_expires_at TIMESTAMPTZ` en
  // businesses, validarlo aquí, y rotar automáticamente cada 90 días.

  // 1. businesses.access_token → sucursal directa (dueño o asistente)
  const ownerRes = await fetch(
    `${url}/rest/v1/businesses?select=id&access_token=eq.${encodeURIComponent(token)}&active=eq.true&limit=1`,
    { headers },
  );
  if (ownerRes.ok) {
    const rows = (await ownerRes.json()) as { id: string }[];
    if (rows.length > 0 && rows[0]) {
      return { kind: 'business', id: rows[0].id, role: isAssistantHint ? 'assistant' : 'owner' };
    }
  }

  // 2. businesses.assistant_token → sucursal directa (asistente)
  const assistantRes = await fetch(
    `${url}/rest/v1/businesses?select=id&assistant_token=eq.${encodeURIComponent(token)}&active=eq.true&limit=1`,
    { headers },
  );
  if (assistantRes.ok) {
    const rows = (await assistantRes.json()) as { id: string }[];
    if (rows.length > 0 && rows[0]) {
      return { kind: 'business', id: rows[0].id, role: 'assistant' };
    }
  }

  // 3. organizations.access_token → grupo de sucursales (dueño multi-sucursal)
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

  // ── 1. ?token= in URL (access link flow) — checked FIRST so a fresh token
  //    always overrides any existing cookie (e.g. a stale barber session).
  if (pathname.startsWith('/dashboard')) {
    const token = request.nextUrl.searchParams.get('token');
    if (token) {
      const roleParam = request.nextUrl.searchParams.get('role');
      const result = await findTokenResult(token, roleParam);
      if (result) {
        const partialPayload =
          result.kind === 'organization'
            ? ({ type: 'organization', organization_id: result.organization_id, business_ids: result.business_ids, role: 'owner' } as const)
            : ({ type: 'business', business_id: result.id, role: result.role } as const);
        const payload = makeSessionPayload(partialPayload);
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
      if (pathname === '/login') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
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

  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

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
