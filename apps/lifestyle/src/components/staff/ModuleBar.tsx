// ─── ModuleBar — la barra de módulos del Asistente (M1 de S10-ASIS-01) ────────
// Client Component. Barra INFERIOR fija, mismo patrón y mismos tokens que
// `admin/OwnerTabs.tsx`: el producto ya tiene un idioma para "shell de módulos" y
// esta vista lo adopta en vez de inventar otro.
//
// LOS CUATRO SLOTS SE DECLARAN DESDE M1 (decisión de Gabriel, 2026-09-06) aunque
// dos se enciendan en M6. La razón no es estética: una barra que crece de 2 a 4
// mueve el piso bajo el pulgar de alguien que ya aprendió dónde tocar, y el
// mostrador aprende esta barra el primer día.
//
// DOS CLASES DE SLOT, y la distinción es a propósito:
//   · 'modulo' — cambia el módulo activo. Agenda, Caja, Clientes.
//   · 'accion' — NO cambia el módulo: dispara algo y la vista se queda donde
//     estaba. Hoy solo Mensajes, que abre la hoja de conversaciones que YA
//     funciona (`ConversationList`, un bottom sheet con su propio chrome).
//
// Por qué Mensajes es 'accion' y no un módulo vacío: inlinear esa hoja es trabajo
// de M6, y un slot que no hace nada es exactamente el defecto que esta ola le
// diagnostica al botón "Buscar cliente" (`AssistantControlDesk.tsx:1048`, disabled
// desde PR-5 con el título "Disponible en la próxima iteración"). Mensajes nace
// alcanzable; en M6 su `kind` pasa a 'modulo' y la barra no cambia de forma.

'use client';

export type ModuloId = 'agenda' | 'caja' | 'mensajes' | 'clientes';

type Slot = {
  id: ModuloId;
  label: string;
  kind: 'modulo' | 'accion';
  icon: React.ReactElement;
};

const SLOTS: readonly Slot[] = [
  {
    id: 'agenda',
    label: 'Agenda',
    kind: 'modulo',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    ),
  },
  {
    id: 'caja',
    label: 'Caja',
    kind: 'modulo',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    ),
  },
  {
    id: 'mensajes',
    label: 'Mensajes',
    kind: 'accion',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
    ),
  },
  {
    id: 'clientes',
    label: 'Clientes',
    kind: 'modulo',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    ),
  },
];

type Props = {
  active: ModuloId;
  /** Slots 'modulo': cambia el módulo activo. */
  onSelect: (id: ModuloId) => void;
  /** Slots 'accion': dispara sin cambiar de módulo. */
  onAction: (id: ModuloId) => void;
  /** Conversaciones en manos humanas — el mismo número que el header ya mostraba. */
  mensajesBadge?: number;
};

export default function ModuleBar({
  active,
  onSelect,
  onAction,
  mensajesBadge = 0,
}: Props): React.ReactElement {
  return (
    <nav
      className="shrink-0 border-t border-line bg-card"
      aria-label="Módulos del asistente"
    >
      <ul className="mx-auto flex max-w-2xl">
        {SLOTS.map((s) => {
          // Un slot de acción NUNCA se pinta como activo: no hay nada que quede
          // seleccionado, y decir lo contrario mentiría sobre dónde está parado
          // el mostrador.
          const isActive = s.kind === 'modulo' && active === s.id;
          return (
            <li key={s.id} className="flex-1">
              <button
                type="button"
                onClick={() => (s.kind === 'modulo' ? onSelect(s.id) : onAction(s.id))}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex w-full flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-ink ${
                  isActive ? 'text-teal-ink' : 'text-faint'
                }`}
              >
                <svg
                  className="h-[22px] w-[22px]"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={isActive ? 2 : 1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  {s.icon}
                </svg>
                {s.label}
                {s.id === 'mensajes' && mensajesBadge > 0 && (
                  <span className="absolute right-1/2 top-1 flex h-4 min-w-4 translate-x-4 items-center justify-center rounded-pill bg-teal px-1 text-[10px] font-bold text-card">
                    {mensajesBadge > 9 ? '9+' : mensajesBadge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
