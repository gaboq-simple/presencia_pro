// ─── Auth helper — getCurrentSession ──────────────────────────────────────────
// Unifica dos mecanismos de autenticación:
//   1. ls_session cookie (token/PIN — nuevo, para demo)
//   2. Supabase Auth session (email+password — existente, para operadores)
//
// Llamar desde Server Components y Route Handlers.
// Nunca exponer al cliente.
//
// El orden de prioridad:
//   ls_session > Supabase Auth
//
// Si ambos están presentes, ls_session tiene precedencia.
// Esto permite que el operador use su sesión de Supabase Auth sin problemas,
// y que los usuarios de demo usen la cookie ls_session.

import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Rol unificado — combina SessionRole con los roles de Supabase Auth */
export type AuthRole = 'owner' | 'assistant' | 'barber' | 'admin';

/**
 * Sesión activa del usuario — independiente del mecanismo de auth. Siempre es de una
 * sola sucursal ('business'): dueño por email (Supabase Auth), asistente/barbero por
 * PIN. El variant 'organization' (token compartido, sin identidad) fue retirado.
 */
export type CurrentSession = {
  type: 'business';
  business_id: string;
  role: AuthRole;
  staff_id: string | null;
  name: string | null;
  auth_type: 'token' | 'supabase';
};

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Retorna la sesión activa del usuario, o null si no hay sesión válida.
 *
 * Orden:
 *   1. ls_session cookie — firmada con HMAC-SHA256
 *   2. Supabase Auth session — verificada con getUser()
 *
 * Siempre se llama desde el servidor (Server Component, Route Handler,
 * Server Action). El service_role_key nunca sale al cliente.
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  // ── 1. ls_session cookie ──────────────────────────────────────────────────
  const cookieStore = await cookies();
  const lsCookieValue = cookieStore.get(SESSION_COOKIE)?.value;

  if (lsCookieValue) {
    const payload = await verifySession(lsCookieValue);
    if (payload) {
      // 'business' | 'staff' (el variant 'organization' fue retirado)
      return {
        type: 'business',
        business_id: payload.business_id,
        role: payload.role === 'barber' ? 'barber'
            : payload.role === 'assistant' ? 'assistant'
            : 'owner',
        staff_id: payload.staff_id ?? null,
        name: null,
        auth_type: 'token',
      };
    }
  }

  // ── 2. Supabase Auth session (backward-compat) ────────────────────────────
  try {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return null;

    const supabase = getServiceClient();
    // eslint-disable-next-line no-restricted-syntax -- resolución de identidad del actor por auth_id (único global): el business_id SALE de acá (la sesión aún no lo conoce), no se puede scopear por él.
    const { data: rawStaff, error } = await supabase
      .from('staff')
      .select('id, business_id, role, name')
      .eq('auth_id', user.id)
      .eq('active', true)
      .maybeSingle();

    if (error || !rawStaff) return null;

    const staffRecord = rawStaff as {
      id: string;
      business_id: string;
      role: string;
      name: string;
    };

    return {
      type: 'business',
      business_id: staffRecord.business_id,
      role: staffRecord.role as AuthRole,
      staff_id: staffRecord.id,
      name: staffRecord.name,
      auth_type: 'supabase',
    };
  } catch {
    return null;
  }
}

/**
 * Resultado del guard `requireOwnerOrAdmin` para rutas API de administración.
 * Misma forma discriminada que los `requireAdmin` inline que reemplaza.
 */
export type OwnerAdminAuth =
  | { ok: true; businessId: string; role: 'owner' | 'admin'; staffId: string | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Guard para las rutas API de administración del negocio (dashboard del dueño).
 * Reemplaza el patrón viejo (auth.getUser() + staff.role==='admin'), que rechazaba
 * al dueño-por-token (sin usuario de Supabase Auth) con 401.
 *
 * Acepta owner y admin vía getCurrentSession (token o Supabase Auth). Rechaza
 * fail-loud y legible: sin sesión (401), sesión de organización (403 — requiere
 * una sucursal específica), y cualquier otro rol como barber/assistant (403).
 *
 * El business_id sale de la sesión (server-derivado, nunca del cliente); cada
 * ruta sigue filtrando sus queries por ese business_id (scope Ola 1 preservado).
 */
export async function requireOwnerOrAdmin(): Promise<OwnerAdminAuth> {
  const session = await getCurrentSession();
  if (!session) {
    return { ok: false, status: 401, error: 'No autorizado' };
  }
  if (session.role !== 'owner' && session.role !== 'admin') {
    return { ok: false, status: 403, error: 'Requiere permisos de administrador del negocio.' };
  }
  return {
    ok: true,
    businessId: session.business_id,
    role: session.role,
    staffId: session.staff_id,
  };
}

/**
 * Resultado del guard `requireBusinessSession`. El rol puede ser cualquiera de la
 * sesión de negocio (owner/admin/barber/assistant).
 */
export type BusinessSessionAuth =
  | { ok: true; businessId: string; role: AuthRole; staffId: string | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Guard de PERTENENCIA al negocio (no de autoridad administrativa): acepta a
 * cualquier miembro del negocio — owner, admin, barber o assistant — vía
 * getCurrentSession (token o Supabase Auth). Para acciones que cualquier staff del
 * negocio puede hacer (ej. editar la nota de un cliente), a diferencia de
 * `requireOwnerOrAdmin` que exige autoridad admin (config, reportes).
 *
 * Allowlist AFIRMATIVA de roles (un rol futuro no entra por default). Rechaza
 * fail-loud: sin sesión (401), sesión de organización (403), rol fuera de la lista
 * (403). El business_id sale de la sesión; el llamador sigue filtrando por él.
 */
export async function requireBusinessSession(): Promise<BusinessSessionAuth> {
  const session = await getCurrentSession();
  if (!session) {
    return { ok: false, status: 401, error: 'No autorizado' };
  }
  const ALLOWED: readonly AuthRole[] = ['owner', 'admin', 'barber', 'assistant'];
  if (!ALLOWED.includes(session.role)) {
    return { ok: false, status: 403, error: 'Requiere una sesión de negocio válida.' };
  }
  return {
    ok: true,
    businessId: session.business_id,
    role: session.role,
    staffId: session.staff_id,
  };
}

/**
 * Obtiene el nombre del negocio a partir del business_id.
 * Para sesiones de token donde el nombre no está en la cookie.
 */
export async function getBusinessName(businessId: string): Promise<string> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', businessId)
    .maybeSingle();

  return (data as { name: string } | null)?.name ?? '';
}

/**
 * Obtiene el timezone del negocio a partir del business_id.
 * Devuelve 'America/Mexico_City' como fallback si no está configurado.
 */
export async function getBusinessTimezone(businessId: string): Promise<string> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .maybeSingle();

  return (data as { timezone: string } | null)?.timezone ?? 'America/Mexico_City';
}

