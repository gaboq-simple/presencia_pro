// ─── Home raíz ────────────────────────────────────────────────────────────────
// Server Component. Resuelve la sesión ANTES de renderizar:
//   · Con sesión → redirect server-side a la vista del rol (sin parpadeo).
//   · Sin sesión → página de entrada sobria con los dos caminos.
//
// El redirect vive acá (no en proxy.ts) porque getCurrentSession() unifica los dos
// backends (ls_session token/PIN y Supabase Auth) y resuelve el rol — el proxy sólo
// tiene el rol para ls_session, no para Supabase Auth. Un solo lugar, sin duplicar.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentSession } from '@/lib/auth';

export default async function HomePage() {
  const session = await getCurrentSession();

  if (session) {
    const target =
      session.type === 'business' && session.role === 'barber' ? '/staff' : '/dashboard';
    redirect(target);
  }

  // ── Sin sesión: página de entrada ──────────────────────────────────────────
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas bg-grid px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Marca */}
        <div className="mb-10 text-center">
          <h1 className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-teal-ink">
            Zlot
          </h1>
          <p className="mt-3 text-[15px] text-ink-2">La agenda de tu barbería.</p>
        </div>

        {/* Dos caminos */}
        <nav className="space-y-3" aria-label="Acceso">
          <Link
            href="/staff"
            className="group flex items-center justify-between rounded-card border border-line bg-card px-5 py-4 shadow-card transition-colors hover:border-teal-border"
          >
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">Soy barbero</span>
              <span className="text-[12.5px] text-faint">Entrar con PIN</span>
            </span>
            <span
              className="text-teal-ink transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            >
              →
            </span>
          </Link>

          <Link
            href="/login"
            className="group flex items-center justify-between rounded-card border border-line bg-card px-5 py-4 shadow-card transition-colors hover:border-teal-border"
          >
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">Soy dueño / recepción</span>
              <span className="text-[12.5px] text-faint">Entrar con correo o enlace</span>
            </span>
            <span
              className="text-teal-ink transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            >
              →
            </span>
          </Link>
        </nav>

        {/* Footer mínimo */}
        <div className="mt-10 text-center text-[11.5px] text-faint">
          <p>de Zentriq</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <a href="mailto:contacto@zentriq.mx" className="transition-colors hover:text-teal-ink">
              contacto@zentriq.mx
            </a>
            <span aria-hidden="true">·</span>
            <Link href="/aviso-de-privacidad" className="transition-colors hover:text-teal-ink">
              Aviso de privacidad
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/arco" className="transition-colors hover:text-teal-ink">
              Derechos ARCO
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
