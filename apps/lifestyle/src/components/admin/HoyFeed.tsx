// ─── Pestaña "Hoy" — feed de rescate (detector de fugas) ──────────────────────
// Server Component presentacional. Recibe el feed ya computado (lib/cadence via
// lib/retentionFeed) y el pulso. Sin interactividad: el botón "Enviar mensaje" es
// PLACEHOLDER (el bottom-sheet que escribe es PR2); "volvieron" no se trackea aún.
// Tokens Zentriq-claro (globals.css @theme): teal=bueno, ámbar=atención, rojo=crítico.

import type { RetentionFeed, CadenceResult, FeedUrgency } from '@/lib/cadence';

type UrgencyStyle = { pill: string; label: string; card: string };

// Color por urgencia (grupo del feed): crítico=rojo, se-están-yendo=ámbar, perdido=gris.
const URGENCY: Record<Exclude<FeedUrgency, 'none'>, UrgencyStyle> = {
  critical: {
    label: 'Campeón enfriándose',
    pill:  'bg-red-tint text-red-ink border border-red-border',
    card:  'border-l-4 border-l-red-border',
  },
  leaving: {
    label: 'Se está yendo',
    pill:  'bg-amber-tint text-amber border border-amber-border',
    card:  'border-l-4 border-l-amber-border',
  },
  lost: {
    label: 'Perdido',
    pill:  'bg-past-bg text-past-ink border border-past-line',
    card:  'border-l-4 border-l-past-line',
  },
};

function yearOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear());
}

function Row({ r }: { r: CadenceResult }): React.ReactElement {
  const u = URGENCY[r.urgency === 'none' ? 'leaving' : r.urgency];
  const since = yearOf(r.createdAt);
  return (
    <li className={`rounded-xl bg-card shadow-card ${u.card}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-ink">{r.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${u.pill}`}>
              {u.label}
            </span>
            {r.confidence === 'tentative' && (
              <span className="shrink-0 rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-faint">
                cadencia tentativa
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-2">{r.explanation}</p>
          <p className="mt-0.5 text-xs text-faint tabular-nums">
            {r.visitCount} {r.visitCount === 1 ? 'visita' : 'visitas'}
            {since && ` · cliente desde ${since}`}
          </p>
        </div>
        {/* PLACEHOLDER no-funcional — el envío (bottom-sheet) es PR2 */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Próximamente"
          className="shrink-0 cursor-not-allowed rounded-lg border border-teal-border bg-tint-1 px-3 py-1.5 text-sm font-medium text-teal-ink opacity-70"
        >
          Enviar mensaje
        </button>
      </div>
    </li>
  );
}

function PulseStat({ n, label, muted }: { n: number | string; label: string; muted?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-bold tabular-nums ${muted ? 'text-faint' : 'text-ink'}`}>{n}</span>
      <span className="text-xs text-faint">{label}</span>
    </div>
  );
}

export default function HoyFeed({
  feed,
  contactados,
}: {
  feed: RetentionFeed;
  contactados: number;
}): React.ReactElement {
  const hasRows = feed.rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      {/* ── Pulso ── */}
      <section className="rounded-xl bg-card p-4 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">La semana</p>
        <div className="mt-2 flex items-center gap-6">
          <PulseStat n={feed.porRecuperar} label="por recuperar" />
          <span className="text-line-2">·</span>
          <PulseStat n={contactados} label="contactados" />
          <span className="text-line-2">·</span>
          <PulseStat n="—" label="volvieron (pronto)" muted />
        </div>
      </section>

      {/* ── Feed "Para recuperar" ── */}
      <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-ink">Para recuperar</h2>

      {hasRows ? (
        <ul className="space-y-2">
          {feed.rows.map((r) => (
            <Row key={r.customerId} r={r} />
          ))}
        </ul>
      ) : (
        // Degradado con gracia: sin historial suficiente, no un feed roto.
        <div className="rounded-xl border border-dashed border-line-2 bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">Aún no hay patrones que detectar</p>
          <p className="mt-1 text-sm text-ink-2">
            Cuando tus clientes acumulen algunas visitas, aquí verás a quién se está enfriando
            y podrás traerlo de vuelta con un tap.
          </p>
        </div>
      )}
    </div>
  );
}
