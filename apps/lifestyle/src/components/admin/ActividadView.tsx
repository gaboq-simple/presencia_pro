// ─── Pestaña "Actividad" — el archivo (dv3-5'') ───────────────────────────────
// Client Component. Feed unificado (citas + gestión + caja) ya traducido a lenguaje
// humano por `lib/activityFeed` (server). Acá: filtro por tipo, detalle expandible
// (before/after crudo, nunca por default), "Cargar más" y estado vacío.
//
// Es la pestaña relegada y su diseño lo dice: **sin héroe, una sola card**, los días
// como kickers, filas densas con un riel de puntos por tipo y la hora tabular a la
// derecha. Monocroma salvo los puntos. Un archivo se diseña como archivo — denso,
// rítmico— y no como una pila de tarjetas iguales, que es lo que había: cada evento
// en su propia card con su pill, todas del mismo peso, sin manera de ubicar cuándo
// pasó algo sin leer las tres líneas.
//
// **El tiempo pasa de relativo a hora de pared, agrupado por día.** "hace 3 min"
// obliga a hacer la cuenta para ubicar un evento, hace que dos filas de días
// distintos se vean igual, y —el que más costó— vuelve imposible comparar dos
// capturas, porque el texto cambia solo con el reloj. La agrupación vive en
// `lib/actividadDias` (puro) y el día es el del NEGOCIO, no el del navegador.

'use client';

import { useState } from 'react';
import type { ActivityEvent, ActivityCategory } from '@/lib/activityFeed';
import { agruparPorDia, horaLocal } from '@/lib/actividadDias';

type Filter = 'todo' | ActivityCategory;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'todo',    label: 'Todo' },
  { key: 'citas',   label: 'Citas' },
  { key: 'gestion', label: 'Gestión' },
  { key: 'caja',    label: 'Caja' },
];

// El tipo pasa de pill a PUNTO: en un archivo denso, una pill por fila compite con
// el texto y hace que todas las filas pesen lo mismo. El punto codifica igual y no
// grita. La caja va en violeta (`walk`) porque es el color con el que el panorama ya
// pinta lo que entra FUERA de la agenda reservada — la misma idea, otra pantalla.
const CATEGORY_DOT: Record<ActivityCategory, string> = {
  citas:   'var(--color-viz-cat-1)',
  gestion: 'var(--color-viz-cat-2)',
  caja:    'var(--color-walk)',
};
const CATEGORY_LABEL: Record<ActivityCategory, string> = { citas: 'citas', gestion: 'gestión', caja: 'caja' };

function EventRow({ ev, timezone }: { ev: ActivityEvent; timezone: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hasDetail = ev.detail && (ev.detail.before != null || ev.detail.after != null);

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className="mt-[7px] inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: CATEGORY_DOT[ev.category] }}
        aria-label={CATEGORY_LABEL[ev.category]}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink-2">
          <strong className="font-semibold text-ink">{ev.actorLabel}</strong>{' '}
          {ev.summary.slice(ev.actorLabel.length).trimStart()}
        </p>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-[11px] font-medium text-teal-ink hover:underline"
            aria-expanded={open}
          >
            {open ? 'Ocultar detalle' : 'Ver detalle'}
          </button>
        )}
        {open && hasDetail && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <DetailBlock label="Antes" data={ev.detail!.before} />
            <DetailBlock label="Después" data={ev.detail!.after} />
          </div>
        )}
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-faint">
        {horaLocal(ev.at, timezone)}
      </span>
    </li>
  );
}

function DetailBlock({ label, data }: { label: string; data: unknown }): React.ReactElement {
  return (
    <div className="rounded-lg border border-line-2 bg-canvas p-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-ink-2">
        {data == null ? '—' : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function ActividadView({
  initialEvents,
  initialCursor,
  timezone,
  hoyLocal,
}: {
  initialEvents: ActivityEvent[];
  initialCursor: string | null;
  /** IANA del negocio — el día del archivo es el del NEGOCIO, no el del navegador. */
  timezone: string;
  /** 'YYYY-MM-DD' local del negocio, resuelto en el server: sin él, un dueño que
   *  abre desde otra zona vería "Hoy" sobre el día equivocado. */
  hoyLocal: string;
}): React.ReactElement {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [filter, setFilter] = useState<Filter>('todo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === 'todo' ? events : events.filter((e) => e.category === filter);
  const dias = agruparPorDia(visible, timezone, hoyLocal);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activity?before=${encodeURIComponent(cursor)}`, { credentials: 'same-origin' });
      if (!res.ok) { setError('No se pudo cargar más'); return; }
      const page = (await res.json()) as { events: ActivityEvent[]; nextCursor: string | null };
      setEvents((prev) => [...prev, ...page.events]);
      setCursor(page.nextCursor);
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Actividad</p>
          <p className="mt-0.5 text-[11px] font-medium text-faint">Quién cambió qué</p>
        </div>
        {/* Pills con tap-state. El activo va en tinta, no en teal: el filtro no es
            una acción de marca, es el estado de una lista. */}
        <div className="flex shrink-0 gap-1.5">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={on}
                className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors active:scale-[.97] ${
                  on ? 'border border-ink bg-ink text-card' : 'border border-line-2 text-ink-2 hover:bg-canvas'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed: UNA card, los días como kickers */}
      {visible.length > 0 ? (
        <section className="mt-4 rounded-xl bg-card p-4 shadow-card">
          {dias.map((d, i) => (
            <div key={d.fecha || `sin-fecha-${i}`} className={i > 0 ? 'mt-4' : ''}>
              <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">{d.etiqueta}</p>
              <ul className="mt-1 divide-y divide-line">
                {d.eventos.map((ev) => (
                  <EventRow key={ev.id} ev={ev} timezone={timezone} />
                ))}
              </ul>
            </div>
          ))}

          {/* Leyenda de los puntos — sin ella el color es decoración */}
          <div className="mt-3 flex items-center gap-4 border-t border-line pt-2">
            {(['citas', 'gestion', 'caja'] as ActivityCategory[]).map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CATEGORY_DOT[c] }}
                  aria-hidden
                />
                {CATEGORY_LABEL[c]}
              </span>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-line-2 bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink">
            {events.length === 0 ? 'Todavía no hay actividad' : 'Nada en este filtro'}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {events.length === 0
              ? 'Cuando tú o tu equipo hagan cambios (citas, servicios, staff, horarios), aquí queda el registro de quién hizo qué.'
              : 'Prueba con otro filtro para ver más actividad.'}
          </p>
        </div>
      )}

      {/* Cargar más — solo cuando el filtro es "todo" (paginación del server es global) */}
      {filter === 'todo' && cursor && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="rounded-lg border border-line-2 bg-card px-4 py-2 text-sm font-medium text-ink-2 hover:bg-tint-1 disabled:opacity-50"
          >
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
          {error && <p className="mt-2 text-xs text-red-ink">{error}</p>}
        </div>
      )}
    </div>
  );
}
