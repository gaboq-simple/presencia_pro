// ─── Pestaña "Clientela" — la gente como un todo (agregados, cero PII) ────────
// Server Component presentacional. Recibe los agregados ya computados (lib/cadence
// via lib/clientelaStats). NO es un rolodex: sin buscador, sin nombres/teléfonos —
// solo la base como colectivo (crecimiento + grupos por segmento).
// PR-A: Crecimiento + Grupos por conteo. Retención (PR-B) y Movimiento (PR-C) aparte.
// Tokens Zentriq-claro (globals.css @theme): teal=bueno, ámbar=atención, gris=perdido.

import type { ClientelaStats, RfmSegment, SegmentCounts } from '@/lib/cadence';

type SegmentStyle = { key: RfmSegment; label: string; hint: string; card: string; count: string; pill: string };

// Orden de presentación + color por segmento. Teal=bueno (campeones), neutro=regulares/
// nuevos, ámbar=atención (se están yendo), gris=perdido.
const SEGMENTS: SegmentStyle[] = [
  { key: 'campeones',      label: 'Campeones',      hint: 'tus más fieles',            card: 'border-l-4 border-l-teal-border', count: 'text-teal-ink', pill: 'bg-tint-1 text-teal-ink border border-teal-border' },
  { key: 'regulares',      label: 'Regulares',      hint: 'vienen a su ritmo',         card: 'border-l-4 border-l-line-2',      count: 'text-ink',      pill: 'bg-card text-ink-2 border border-line-2' },
  { key: 'nuevos',         label: 'Nuevos',         hint: 'aún sin patrón',            card: 'border-l-4 border-l-line-2',      count: 'text-ink',      pill: 'bg-card text-ink-2 border border-line-2' },
  { key: 'se_estan_yendo', label: 'Se están yendo', hint: 'atrasados de su ritmo',     card: 'border-l-4 border-l-amber-border', count: 'text-amber',   pill: 'bg-amber-tint text-amber border border-amber-border' },
  { key: 'perdidos',       label: 'Perdidos',       hint: 'hace mucho que no vuelven', card: 'border-l-4 border-l-past-line',   count: 'text-past-ink', pill: 'bg-past-bg text-past-ink border border-past-line' },
];

function hasSegmentedHistory(counts: SegmentCounts): boolean {
  // ¿Hay algún cliente clasificado más allá de "Nuevos"? Si no, aún no hay historial
  // de visitas suficiente para segmentar (degradado con gracia, no un error).
  return counts.campeones + counts.regulares + counts.se_estan_yendo + counts.perdidos > 0;
}

function SegmentRow({ s, count, delta }: { s: SegmentStyle; count: number; delta: number }): React.ReactElement {
  return (
    <li className={`rounded-xl bg-card shadow-card ${s.card}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{s.label}</p>
          <p className="mt-0.5 text-xs text-faint">{s.hint}</p>
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          {delta > 0 && (
            <span className="rounded-full bg-tint-1 px-2 py-0.5 text-[11px] font-medium text-teal-ink tabular-nums">
              +{delta} este mes
            </span>
          )}
          <span className={`text-2xl font-bold tabular-nums ${s.count}`}>{count}</span>
        </div>
      </div>
    </li>
  );
}

export default function ClientelaView({ stats }: { stats: ClientelaStats }): React.ReactElement {
  const { totalCustomers, newThisMonth, segmentCounts, newThisMonthBySegment } = stats;
  const hasCustomers = totalCustomers > 0;
  const segmented = hasSegmentedHistory(segmentCounts);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <p className="px-1 text-xs text-faint">
        La clientela como un todo — sin nombres ni teléfonos.
      </p>

      {/* ── Crecimiento (héroe) ── */}
      <section className="mt-2 rounded-xl bg-card p-4 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">Tu base</p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-4xl font-bold tabular-nums text-ink">{totalCustomers}</span>
          <span className="text-sm text-ink-2">en total</span>
          {newThisMonth > 0 && (
            <span className="ml-auto rounded-full bg-tint-1 px-2.5 py-1 text-sm font-semibold text-teal-ink tabular-nums">
              +{newThisMonth} este mes
            </span>
          )}
        </div>
      </section>

      {/* ── Grupos por conteo ── */}
      <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-ink">Cómo se agrupan</h2>

      {hasCustomers ? (
        <>
          <ul className="space-y-2">
            {SEGMENTS.map((s) => (
              <SegmentRow
                key={s.key}
                s={s}
                count={segmentCounts[s.key]}
                delta={newThisMonthBySegment[s.key]}
              />
            ))}
          </ul>
          {!segmented && (
            <p className="mt-2 px-1 text-xs text-faint">
              Cuando tus clientes acumulen algunas visitas, aquí verás quiénes son tus
              campeones, quiénes se enfrían y quiénes ya casi no vuelven.
            </p>
          )}
        </>
      ) : (
        // Degradado con gracia: negocio sin clientes aún, no un panel roto.
        <div className="rounded-xl border border-dashed border-line-2 bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">Todavía no hay clientela que mostrar</p>
          <p className="mt-1 text-sm text-ink-2">
            Cuando lleguen tus primeros clientes, aquí verás cómo crece tu base y cómo se
            agrupa por lealtad.
          </p>
        </div>
      )}
    </div>
  );
}
