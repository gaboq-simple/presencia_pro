// ─── Pestaña "Actividad" — capa visible del audit (dueño) ─────────────────────
// Client Component. Feed unificado (citas + gestión) ya traducido a lenguaje humano
// por lib/activityFeed (server). Acá: filtro por tipo, detalle expandible (before/
// after crudo, no default), "Cargar más" (GET /api/activity?before=), estado vacío.
// Tokens Zentriq-claro; tiempos en Inter tabular-nums.

'use client';

import { useState } from 'react';
import type { ActivityEvent, ActivityCategory } from '@/lib/activityFeed';

type Filter = 'todo' | ActivityCategory;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'todo',    label: 'Todo' },
  { key: 'citas',   label: 'Citas' },
  { key: 'gestion', label: 'Gestión' },
];

const CATEGORY_PILL: Record<ActivityCategory, string> = {
  citas:   'bg-tint-1 text-teal-ink border border-teal-border',
  gestion: 'bg-past-bg text-past-ink border border-past-line',
};
const CATEGORY_LABEL: Record<ActivityCategory, string> = { citas: 'Cita', gestion: 'Gestión' };

// Tiempo relativo (tz local del que mira; el "cuándo" de la cita ya viene formateado
// en hora del negocio dentro del summary).
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.round((Date.now() - then) / 1000);
  if (diff < 45) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function EventRow({ ev }: { ev: ActivityEvent }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hasDetail = ev.detail && (ev.detail.before != null || ev.detail.after != null);

  return (
    <li className="rounded-xl bg-card shadow-card">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm text-ink">
            <span className="font-semibold">{ev.actorLabel}</span>{' '}
            <span className="text-ink-2">{ev.summary.slice(ev.actorLabel.length).trimStart()}</span>
          </p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_PILL[ev.category]}`}>
            {CATEGORY_LABEL[ev.category]}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-faint tabular-nums">{relTime(ev.at)}</span>
          {hasDetail && (
            <>
              <span className="text-line-2" aria-hidden>·</span>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-teal-ink hover:underline"
                aria-expanded={open}
              >
                {open ? 'Ocultar detalle' : 'Ver detalle'}
              </button>
            </>
          )}
        </div>

        {open && hasDetail && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <DetailBlock label="Antes" data={ev.detail!.before} />
            <DetailBlock label="Después" data={ev.detail!.after} />
          </div>
        )}
      </div>
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
}: {
  initialEvents: ActivityEvent[];
  initialCursor: string | null;
}): React.ReactElement {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [filter, setFilter] = useState<Filter>('todo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === 'todo' ? events : events.filter((e) => e.category === filter);

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
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Actividad</h2>
        <p className="text-xs text-faint">Quién cambió qué</p>
      </div>

      {/* Filtro */}
      <div className="mt-3 flex gap-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                on ? 'bg-teal-ink text-white' : 'border border-line-2 text-ink-2 hover:bg-tint-1'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      {visible.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {visible.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-line-2 bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink">
            {events.length === 0 ? 'Todavía no hay actividad' : 'Nada en este filtro'}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {events.length === 0
              ? 'Cuando tú o tu equipo hagan cambios (citas, servicios, staff, horarios), aquí queda el registro de quién hizo qué.'
              : 'Probá con otro filtro para ver más actividad.'}
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
