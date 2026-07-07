// ─── Shell de 4 pestañas del dashboard del dueño ──────────────────────────────
// Client Component: barra inferior (Hoy/Negocio/Clientela/Gestión), default en Hoy.
// Migración por ADICIÓN: "Hoy" es la superficie nueva (feed de rescate); las otras 3
// muestran el DashboardLayout de S6 EXISTENTE sin partir — no se pierde función (cada
// pestaña tendrá su contenido propio en su PR). Recibe los contenidos como ReactNode
// (composición server→client). Tokens Zentriq-claro.

'use client';

import { useState } from 'react';

type TabKey = 'hoy' | 'negocio' | 'clientela' | 'gestion';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactElement }> = [
  {
    key: 'hoy',
    label: 'Hoy',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.412 15.655 9.75 21.75l3.745-4.012M9.257 13.5H3.75l2.659-2.849m2.048-2.194L14.25 2.25 12 10.5h8.25l-4.707 5.043M8.457 8.457 3 3m5.457 5.457 7.086 7.086m0 0L21 21" />
    ),
  },
  {
    key: 'negocio',
    label: 'Negocio',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    ),
  },
  {
    key: 'clientela',
    label: 'Clientela',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    ),
  },
  {
    key: 'gestion',
    label: 'Gestión',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    ),
  },
];

export default function OwnerTabs({
  hoy,
  clientela,
  panel,
}: {
  hoy: React.ReactNode;
  clientela: React.ReactNode;
  panel: React.ReactNode;
}): React.ReactElement {
  const [active, setActive] = useState<TabKey>('hoy');

  return (
    <div className="min-h-screen bg-canvas pb-20">
      {/* Contenido de la pestaña activa. Hoy y Clientela tienen superficie propia;
          Negocio y Gestión aún muestran el dashboard existente (migración por adición). */}
      <div>{active === 'hoy' ? hoy : active === 'clientela' ? clientela : panel}</div>

      {/* Barra inferior */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card"
        aria-label="Secciones del dashboard"
      >
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((t) => {
            const isActive = active === t.key;
            return (
              <li key={t.key} className="flex-1">
                <button
                  type="button"
                  onClick={() => setActive(t.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex w-full flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                    isActive ? 'text-teal-ink' : 'text-faint'
                  }`}
                >
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={isActive ? 2 : 1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    {t.icon}
                  </svg>
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
