// ─── Home raíz ────────────────────────────────────────────────────────────────
// Server Component. Resuelve la sesión ANTES de renderizar:
//   · Con sesión → redirect server-side a la vista del rol (sin parpadeo).
//   · Sin sesión → página de entrada premium con los tres caminos.
//
// El redirect vive acá (no en proxy.ts) porque getCurrentSession() unifica los dos
// backends (ls_session token/PIN y Supabase Auth) y resuelve el rol — el proxy sólo
// tiene el rol para ls_session, no para Supabase Auth. Un solo lugar, sin duplicar.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentSession } from '@/lib/auth';

// ── Los tres accesos, uno por vista/rol ───────────────────────────────────────
// · Profesional (barbero) y Recepción (asistente) → /staff: misma pantalla de
//   PIN, el rol lo deriva el PIN (barber → vista del día; assistant → mesa de
//   control). Se listan como tarjetas separadas para que cada quien reconozca la
//   suya, aunque la puerta de PIN sea compartida.
// · Administración (dueño/admin) → /login: único que entra por correo.
// Etiquetas genéricas a propósito (no "barbería") para adoptar Zlot en otros giros.
const ACCESOS = [
  { label: 'Profesional',    hint: 'Tu agenda del día · PIN',    href: '/staff', icon: 'pro'   as const },
  { label: 'Recepción',      hint: 'Mesa de control · PIN',      href: '/staff', icon: 'desk'  as const },
  { label: 'Administración', hint: 'Panel del negocio · Correo', href: '/login', icon: 'admin' as const },
] as const;

// ── Iconografía de línea (stroke 1.5, genérica entre giros) ────────────────────
function AccessIcon({ name }: { name: 'pro' | 'desk' | 'admin' }) {
  const common = {
    className: 'h-[22px] w-[22px]',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
  };
  if (name === 'pro') {
    // Persona — el que da el servicio, neutral entre oficios.
    return (
      <svg {...common}>
        <path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        <path d="M4.5 19.75a7.5 7.5 0 0 1 15 0" />
      </svg>
    );
  }
  if (name === 'desk') {
    // Campana de recepción — front desk / mesa de control.
    return (
      <svg {...common}>
        <path d="M3.75 18.75h16.5" />
        <path d="M5.5 18.75a6.5 6.5 0 0 1 13 0" />
        <path d="M12 6.25V4.5" />
        <path d="M10 4.5h4" />
      </svg>
    );
  }
  // Barras — panel / métricas del negocio.
  return (
    <svg {...common}>
      <path d="M4.5 20.25v-5.5" />
      <path d="M9.5 20.25V9.75" />
      <path d="M14.5 20.25v-7.5" />
      <path d="M19.5 20.25V6.25" />
    </svg>
  );
}

export default async function HomePage() {
  const session = await getCurrentSession();

  if (session) {
    const target =
      session.type === 'business' && session.role === 'barber' ? '/staff' : '/dashboard';
    redirect(target);
  }

  // ── Sin sesión: página de entrada ──────────────────────────────────────────
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-6 py-14">
      {/* ── Fondo sofisticado en capas (todo decorativo, sin interacción) ──────── */}

      {/* 1 · Rejilla técnica con máscara radial: foco arriba-centro y se desvanece
             hacia los bordes → spotlight, no papel milimétrico uniforme. */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid"
        aria-hidden="true"
        style={{
          WebkitMaskImage:
            'radial-gradient(118% 82% at 50% 4%, #000 28%, transparent 76%)',
          maskImage: 'radial-gradient(118% 82% at 50% 4%, #000 28%, transparent 76%)',
        }}
      />

      {/* 2 · Profundidad teal en capas: halo principal arriba + acento asimétrico
             a la derecha + base fría abajo-izquierda → volumen, no degradado plano. */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(56% 46% at 50% -2%, rgba(0, 194, 168, 0.16), transparent 68%),' +
            'radial-gradient(42% 38% at 88% 24%, rgba(0, 194, 168, 0.07), transparent 72%),' +
            'radial-gradient(52% 44% at 6% 94%, rgba(1, 130, 113, 0.06), transparent 74%)',
        }}
      />

      {/* 3 · Grano finísimo: textura táctil (feTurbulence inline, sin red). Muy sutil
             a propósito — da tacto premium sin ensuciar el near-white. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-soft-light"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '160px 160px',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* ── Marca ── */}
        <div className="mb-11 flex flex-col items-center text-center animate-rise-in">
          <div className="relative">
            {/* halo suave detrás del monograma */}
            <div
              className="pointer-events-none absolute -inset-5 -z-10"
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(50% 50% at 50% 50%, rgba(0, 194, 168, 0.22), rgba(0, 194, 168, 0) 70%)',
              }}
            />
            <div className="flex h-[64px] w-[64px] items-center justify-center rounded-hero bg-hero-grad shadow-hero">
              <span className="text-[30px] font-semibold leading-none tracking-[-0.05em] text-white">
                Z
              </span>
            </div>
          </div>
          <h1 className="mt-5 text-[36px] font-semibold leading-none tracking-[-0.035em] text-teal-ink">
            Zlot
          </h1>
          <p className="mt-2.5 text-[14.5px] text-ink-2">La agenda de tu negocio.</p>
        </div>

        {/* ── Tres caminos — uno por vista ── */}
        <nav className="space-y-2.5" aria-label="Acceso">
          {ACCESOS.map((acceso, i) => (
            <Link
              key={acceso.label}
              href={acceso.href}
              className="entry-card group flex items-center gap-4 rounded-card border border-line bg-card px-4 py-3.5 shadow-card animate-rise-in"
              style={{ animationDelay: `${0.09 * (i + 1)}s` }}
            >
              <span className="entry-ico flex h-11 w-11 shrink-0 items-center justify-center rounded-avatar bg-tint-1 text-teal-ink">
                <AccessIcon name={acceso.icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold leading-tight text-ink">
                  {acceso.label}
                </span>
                <span className="mt-0.5 text-[12.5px] text-faint">{acceso.hint}</span>
              </span>
              <span
                className="shrink-0 text-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-teal-ink"
                aria-hidden="true"
              >
                →
              </span>
            </Link>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div
          className="mt-11 animate-rise-in border-t border-line pt-6 text-center text-[11.5px] text-faint"
          style={{ animationDelay: '0.42s' }}
        >
          <p className="tracking-wide">de Zentriq</p>
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
