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
 * Sesión activa del usuario — independiente del mecanismo de auth.
 *
 * · 'business'     → acceso a una sola sucursal (token de businesses o Supabase Auth).
 * · 'organization' → acceso al grupo de sucursales (token de organizations).
 *                    El dashboard muestra selector y filtra por business_id seleccionado.
 */
export type CurrentSession =
  | {
      type: 'business';
      business_id: string;
      role: AuthRole;
      staff_id: string | null;
      name: string | null;
      auth_type: 'token' | 'supabase';
    }
  | {
      type: 'organization';
      organization_id: string;
      business_ids: string[];
      role: 'owner';
      staff_id: null;
      name: string | null;
      auth_type: 'token';
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
      if (payload.type === 'organization') {
        return {
          type: 'organization',
          organization_id: payload.organization_id,
          business_ids: payload.business_ids,
          role: 'owner',
          staff_id: null,
          name: null,
          auth_type: 'token',
        };
      }
      // 'business' | 'staff'
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

/**
 * Carga id + name de todas las sucursales de una organización.
 * Usado por el dashboard para renderizar el BranchSelector.
 */
export async function getOrganizationBranches(
  businessIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (businessIds.length === 0) return [];
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('id, name')
    .in('id', businessIds)
    .eq('active', true)
    .order('name');

  return (data ?? []) as Array<{ id: string; name: string }>;
}
