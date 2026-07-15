// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
// Cierre de sesión REAL y reusable. Limpia LOS DOS mecanismos de sesión:
//   1. ls_session  — cookie HMAC custom (PIN del barbero/asistente, token del dueño).
//   2. Supabase Auth — cookies sb-* (login del dueño por email+contraseña).
//
// Por qué existe: hasta hoy no había ninguna forma de cerrar sesión en ninguna
// vista. Además `getCurrentSession` prioriza ls_session sobre Supabase Auth — si
// una compu tiene una ls_session vieja (de un PIN o token previo), TAPA el login por
// email del dueño. `LoginForm` llama esta ruta antes de `signInWithPassword` para
// arrancar de cero; la UI puede reusarla como botón "Cerrar sesión".

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { SESSION_COOKIE } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();

  // 1. Borrar la cookie HMAC custom (ls_session). path='/' — igual que al firmarla.
  cookieStore.delete(SESSION_COOKIE);

  // 2. Cerrar la sesión de Supabase Auth — expira las cookies sb-* vía el server
  //    client cookie-aware. Best-effort: si no había sesión, no es error.
  try {
    const supabase = await createAuthClient();
    await supabase.auth.signOut();
  } catch {
    // sin sesión de Supabase o error de red — la limpieza de ls_session ya ocurrió
  }

  return NextResponse.json({ ok: true });
}
