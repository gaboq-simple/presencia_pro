// ─── Pestaña "Clientela" — la gente como un todo (agregados, cero PII) ────────
// Server Component presentacional. Recibe los agregados ya computados (lib/cadence
// via lib/clientelaStats). NO es un rolodex: sin buscador, sin nombres/teléfonos —
// solo la base como colectivo (crecimiento + grupos por segmento).
// PR-A: Crecimiento + Grupos. PR-B: Retención. PR-C: Movimiento entre grupos.
// El mapa segmento→{color,label} vive en `lib/segmentStyles` (compartido con el
// bloque de movimiento). Tokens Zentriq-claro: teal=bueno, ámbar=atención, gris=perdido.

import type { ClientelaStats, RfmSegment, SegmentCounts, RetentionRate, SegmentMovement } from '@/lib/cadence';
import { SEGMENT_STYLE, SEGMENT_ORDER } from '@/lib/segmentStyles';

// Copy propia de la grilla de grupos (no es color/label → no va al módulo compartido).
const SEGMENT_HINT: Record<RfmSegment, string> = {
  campeones:      'tus más fieles',
  regulares:      'vienen a su ritmo',
  nuevos:         'aún sin patrón',
  se_estan_yendo: 'atrasados de su ritmo',
  perdidos:       'hace mucho que no vuelven',
};

function hasSegmentedHistory(counts: SegmentCounts): boolean {
  // ¿Hay algún cliente clasificado más allá de "Nuevos"? Si no, aún no hay historial
  // de visitas suficiente para segmentar (degradado con gracia, no un error).
  return counts.campeones + counts.regulares + counts.se_estan_yendo + counts.perdidos > 0;
}

function SegmentRow({ seg, count, delta }: { seg: RfmSegment; count: number; delta: number }): React.ReactElement {
  const s = SEGMENT_STYLE[seg];
  return (
    <li className={`rounded-xl bg-card shadow-card ${s.card}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{s.label}</p>
          <p className="mt-0.5 text-xs text-faint">{SEGMENT_HINT[seg]}</p>
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

// ─── Movimiento: transiciones destacadas (dirección → color, no por segmento) ─────
// Solo las jugadas que el doc resalta; el resto se colapsa en "otras" (honesto, nada
// oculto). El color es por DIRECCIÓN (teal=bueno, ámbar=fuga), no por segmento.
const MOVEMENT_HIGHLIGHTS: { from: RfmSegment; to: RfmSegment; read: string; tone: 'good' | 'bad' }[] = [
  { from: 'nuevos',    to: 'regulares',      read: 'los estás fidelizando', tone: 'good' },
  { from: 'regulares', to: 'se_estan_yendo', read: 'se están enfriando',    tone: 'bad' },
];

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function MovementRow({ from, to, count, read, tone }: { from: RfmSegment; to: RfmSegment; count: number; read: string; tone: 'good' | 'bad' }): React.ReactElement {
  const border = tone === 'good' ? 'border-l-teal-border' : 'border-l-amber-border';
  const num = tone === 'good' ? 'text-teal-ink' : 'text-amber';
  return (
    <li className={`rounded-xl bg-card shadow-card border-l-4 ${border}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {SEGMENT_STYLE[from].label} <span className="text-faint">→</span> {SEGMENT_STYLE[to].label}
          </p>
          <p className="mt-0.5 text-xs text-faint">{read}</p>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${num}`}>{count}</span>
      </div>
    </li>
  );
}

function MovementBlock({ movement }: { movement: SegmentMovement }): React.ReactElement {
  // Degradado honesto: nadie tenía presencia al cierre del mes pasado → sin base para
  // comparar (clientela joven). Banda, no un movimiento fabricado.
  if (movement.eligibleCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-2 bg-card px-4 py-6 text-center">
        <p className="text-sm font-medium text-ink">Aún no hay suficiente historia para ver movimiento</p>
        <p className="mt-1 text-sm text-ink-2">
          Cuando tus clientes tengan historia de más de un mes, aquí verás quiénes se
          fidelizan y quiénes se enfrían.
        </p>
      </div>
    );
  }

  const highlighted = MOVEMENT_HIGHLIGHTS
    .map((h) => ({ ...h, count: movement.transitions.find((t) => t.from === h.from && t.to === h.to)?.count ?? 0 }))
    .filter((h) => h.count > 0);

  // "Otras": transiciones reales no destacadas (nada se oculta en silencio).
  const highlightedTotal = highlighted.reduce((a, h) => a + h.count, 0);
  const otras = movement.movedCount - highlightedTotal;

  return (
    <>
      {highlighted.length > 0 ? (
        <ul className="space-y-2">
          {highlighted.map((h) => (
            <MovementRow key={`${h.from}>${h.to}`} from={h.from} to={h.to} count={h.count} read={h.read} tone={h.tone} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-ink-2">
          {movement.movedCount === 0
            ? 'Nadie cambió de grupo este mes — tu clientela se mantuvo estable.'
            : 'Sin movimientos destacados este mes.'}
        </p>
      )}
      {otras > 0 && (
        <p className="mt-2 px-1 text-xs text-faint tabular-nums">
          Otras transiciones: {otras}
        </p>
      )}
    </>
  );
}

// Una tasa de retención con su ventana etiquetada, o la banda honesta "sin datos"
// cuando la cohorte no llega al piso. `accent`: ámbar = señal a vigilar (balde que
// gotea), teal = señal de salud (recompra de base).
function RateCard({
  title, window: windowLabel, rate, accent,
}: {
  title: string; window: string; rate: RetentionRate; accent: 'amber' | 'teal';
}): React.ReactElement {
  const border = accent === 'amber' ? 'border-l-amber-border' : 'border-l-teal-border';
  const num = accent === 'amber' ? 'text-amber' : 'text-teal-ink';
  return (
    <div className={`rounded-xl bg-card p-3 shadow-card border-l-4 ${border}`}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {rate.status === 'ok' ? (
        <>
          <p className={`mt-1 text-3xl font-bold tabular-nums ${num}`}>{Math.round(rate.rate * 100)}%</p>
          <p className="mt-0.5 text-xs text-faint tabular-nums">
            {rate.retained} de {rate.cohortSize} {rate.cohortSize === 1 ? 'cliente' : 'clientes'}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm font-medium text-faint">Sin datos suficientes</p>
          <p className="mt-0.5 text-xs text-faint tabular-nums">
            {rate.cohortSize} {rate.cohortSize === 1 ? 'cliente' : 'clientes'} · faltan para medir
          </p>
        </>
      )}
      <p className="mt-1.5 text-[11px] text-faint">{windowLabel}</p>
    </div>
  );
}

export default function ClientelaView({ stats }: { stats: ClientelaStats }): React.ReactElement {
  const { totalCustomers, newThisMonth, segmentCounts, newThisMonthBySegment, retention, movement } = stats;
  const hasCustomers = totalCustomers > 0;
  const segmented = hasSegmentedHistory(segmentCounts);
  // Mes anterior (UTC, alineado con monthStartMs del aggregator) para el reloj etiquetado.
  const prevMonth = MONTHS_ES[(new Date().getUTCMonth() + 11) % 12];

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

      {/* ── Retención por cohortes (el balde que gotea) ── */}
      {/* Dos tasas separadas a propósito: mezcladas mienten (los de siempre ahogan la
          señal de los nuevos). Cada una declara su ventana. */}
      <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-ink">Quién vuelve</h2>
      <div className="grid grid-cols-2 gap-3">
        <RateCard
          title="Nuevos que vuelven"
          window="1ª visita hace 1–3 meses · volvieron ≤30 días"
          rate={retention.newReturn}
          accent="amber"
        />
        <RateCard
          title="Recompra de base"
          window="clientes de ≥3 visitas · últimos 60 días"
          rate={retention.baseRepeat}
          accent="teal"
        />
      </div>

      {/* ── Movimiento entre grupos (vs cierre del mes anterior) ── */}
      <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-ink">
        Cómo se mueven <span className="font-normal text-faint">· vs cierre de {prevMonth}</span>
      </h2>
      <MovementBlock movement={movement} />

      {/* ── Grupos por conteo ── */}
      <h2 className="mt-6 mb-2 px-1 text-sm font-semibold text-ink">Cómo se agrupan</h2>

      {hasCustomers ? (
        <>
          <ul className="space-y-2">
            {SEGMENT_ORDER.map((seg) => (
              <SegmentRow
                key={seg}
                seg={seg}
                count={segmentCounts[seg]}
                delta={newThisMonthBySegment[seg]}
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
