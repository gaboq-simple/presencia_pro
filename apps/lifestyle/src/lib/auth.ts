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

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { verifySession, SESSION_COOKIE } from '@/lib/session';
import { resolverSesionPin, type StaffVigente } from '@/lib/sessionGuard';

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

// ─── Vigencia de la persona (S9-SEC-01) ───────────────────────────────────────

/**
 * La fila de `staff` como está HOY, sin filtrar por `active`.
 *
 * El `active` NO va en el WHERE a propósito: filtrarlo acá colapsaría "está
 * desactivada" contra "no existe", y son incidentes distintos. Quien decide es
 * `resolverSesionPin` (puro y con tests); esta función solo trae el hecho.
 */
async function getStaffVigente(staffId: string): Promise<StaffVigente | null> {
  const supabase = getServiceClient();
  // eslint-disable-next-line no-restricted-syntax -- revalidación del propio actor por su id (que viene de la cookie firmada, no del cliente). El business_id de la fila es justamente lo que se va a COMPARAR contra el de la cookie: scopear por él acá haría la comparación tautológica y el cruce de negocios pasaría inadvertido.
  const { data, error } = await supabase
    .from('staff')
    .select('id, business_id, role, name, active')
    .eq('id', staffId)
    .maybeSingle();

  // Un fallo de lectura NO es "esta persona ya no puede": es "no sé". Se propaga
  // para que el llamador no confunda un hipo de red con una revocación y deje a
  // media barbería afuera. La regla dura del repo, del lado de la lectura.
  if (error) throw new Error(`getStaffVigente failed: ${error.message}`);

  return (data as StaffVigente | null) ?? null;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Retorna la sesión activa del usuario, o null si no hay sesión válida.
 *
 * Orden:
 *   1. ls_session cookie — firmada con HMAC-SHA256, REVALIDADA contra `staff`
 *   2. Supabase Auth session — verificada con getUser()
 *
 * 🔴 La cookie ya no basta (S9-SEC-01). Prueba quién dijo ser al entrar; quien
 *    decide si todavía puede es la fila de `staff` de este instante. Sin eso,
 *    desactivar a un barbero no lo sacaba: su cookie valía 7 días más.
 *
 * 🔴 Un rechazo CAE al camino 2 en vez de cortar. Es lo que hace que una compu
 *    con una `ls_session` muerta y una sesión de dueño viva entre como dueño, en
 *    vez de quedarse trabada con la identidad equivocada.
 *
 * Memoizada con `cache()`: la revalidación agrega UNA consulta por request, no
 * una por llamador (un render llama a este helper varias veces vía los guards).
 *
 * Siempre se llama desde el servidor (Server Component, Route Handler,
 * Server Action). El service_role_key nunca sale al cliente.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  // ── 1. ls_session cookie ──────────────────────────────────────────────────
  const cookieStore = await cookies();
  const lsCookieValue = cookieStore.get(SESSION_COOKIE)?.value;

  if (lsCookieValue) {
    const payload = await verifySession(lsCookieValue);
    if (payload) {
      const staff = payload.staff_id ? await getStaffVigente(payload.staff_id) : null;
      const veredicto = resolverSesionPin(payload, staff);

      if (veredicto.ok) {
        return {
          type: 'business',
          business_id: veredicto.businessId,
          role: veredicto.role as AuthRole,
          staff_id: veredicto.staffId,
          // El nombre sale de la fila. Antes era `null` siempre y cada vista que
          // lo necesitaba iba a buscarlo por su cuenta.
          name: veredicto.name,
          auth_type: 'token',
        };
      }

      // Ruidoso, no mudo: una sesión que se cae sin dejar rastro es indistinguible
      // de un bug de login. Sin PII — el staff_id ya es un identificador interno.
      console.warn(JSON.stringify({
        ts:          new Date().toISOString(),
        service:     'auth',
        event:       'ls_session_rechazada',
        motivo:      veredicto.motivo,
        business_id: payload.business_id,
        staff_id:    payload.staff_id ?? null,
      }));
      // y sigue al camino 2 — no `return null`.
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
});

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


/**
 * Obtiene el slug del negocio a partir del business_id.
 *
 * Lo pide el enlace "cambiar de perfil" (S9-SEC-01): el selector vive en
 * /[slug]/staff, y desde adentro de una vista solo se conoce el business_id.
 */
export async function getBusinessSlug(businessId: string): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('slug')
    .eq('id', businessId)
    .maybeSingle();

  return (data as { slug: string } | null)?.slug ?? null;
}
