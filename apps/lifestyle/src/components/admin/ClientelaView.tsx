// ─── Pestaña "Clientela" — la base como un todo (dv3-5'') ─────────────────────
// Server Component presentacional. Recibe los agregados ya computados
// (`lib/cadence` vía `lib/clientelaStats`). NO es un rolodex: sin buscador, sin
// nombres ni teléfonos — la base como colectivo.
//
// El rediseño cambia una cosa de fondo: **la composición del todo ES el dato**, y
// cinco tarjetas apiladas la escondían. Antes había que leer cinco números y
// hacer la proporción en la cabeza; ahora la barra la muestra y los números
// quedan de apoyo. Es la pestaña más corta a propósito: tres cards y mucho aire.
//
// El color de los grupos sale de `lib/segmentStyles.dot` y NO es la categórica:
// sigue al ciclo de vida (ver la nota en ese módulo). Los porcentajes salen de
// `lib/viz.sharePcts`, que reparte 100 conservando la suma — `pctWidth` mediría
// contra el máximo y daría una barra que suma 240%.

import type { ClientelaStats, RfmSegment, SegmentCounts, RetentionRate, SegmentMovement } from '@/lib/cadence';
import { SEGMENT_STYLE, SEGMENT_ORDER } from '@/lib/segmentStyles';
import { sharePcts } from '@/lib/viz';
import { Apilada, type SegmentoApilada } from '@/components/admin/viz/Apilada';

// Copy propia de la leyenda (no es color/label → no va al módulo compartido).
const SEGMENT_HINT: Record<RfmSegment, string> = {
  campeones:      'tus más fieles',
  regulares:      'vienen a su ritmo',
  nuevos:         'aún sin patrón',
  se_estan_yendo: 'atrasados de su ritmo',
  perdidos:       'hace mucho que no vuelven',
};

/** Tono del número de cada grupo: los dos estados de salida se marcan, el resto no. */
const SEGMENT_NUM: Record<RfmSegment, string> = {
  campeones:      'text-ink',
  regulares:      'text-ink',
  nuevos:         'text-ink',
  se_estan_yendo: 'text-amber',
  perdidos:       'text-past-ink',
};

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                   'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function hasSegmentedHistory(counts: SegmentCounts): boolean {
  // ¿Hay alguien clasificado más allá de "Nuevos"? Si no, todavía no hay historial
  // de visitas para segmentar (degradado con gracia, no un error).
  return counts.campeones + counts.regulares + counts.se_estan_yendo + counts.perdidos > 0;
}

// ─── Héroe: crecimiento + composición + leyenda ───────────────────────────────

function Hero({
  total, newThisMonth, counts, segmented,
}: {
  total: number; newThisMonth: number; counts: SegmentCounts; segmented: boolean;
}): React.ReactElement {
  const pcts = sharePcts(SEGMENT_ORDER.map((s) => counts[s]));
  const segmentos: SegmentoApilada[] = SEGMENT_ORDER.map((s, i) => ({
    label: SEGMENT_STYLE[s].label,
    pct:   pcts[i]!,
    color: SEGMENT_STYLE[s].dot,
  }));

  return (
    <section
      aria-label="Tu base"
      className="mt-2 rounded-xl border-l-2 border-l-teal bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[40px] font-light leading-[44px] tabular-nums tracking-[-.02em] text-ink">
          {total}
        </span>
        <span className="text-[13px] text-ink-2">{total === 1 ? 'cliente' : 'clientes'}</span>
        {newThisMonth > 0 && (
          <span className="ml-auto text-[11px] font-medium tabular-nums text-faint">
            +{newThisMonth} este mes
          </span>
        )}
      </div>

      {/* La composición del todo. Sin esta barra, los cinco números de abajo
          obligan a hacer la proporción en la cabeza. */}
      <div className="mt-4">
        <Apilada segmentos={segmentos} />
      </div>

      <ul className="mt-3">
        {SEGMENT_ORDER.map((seg) => (
          <li key={seg} className="flex min-h-[44px] items-center gap-3">
            <span
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: SEGMENT_STYLE[seg].dot }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">
              <strong className="font-medium text-ink">{SEGMENT_STYLE[seg].label}</strong>
              {' · '}{SEGMENT_HINT[seg]}
            </span>
            <span className={`shrink-0 text-[20px] font-light leading-[26px] tabular-nums ${SEGMENT_NUM[seg]}`}>
              {counts[seg]}
            </span>
          </li>
        ))}
      </ul>

      {!segmented && (
        <p className="mt-1 text-[11px] text-faint">
          Cuando tus clientes acumulen algunas visitas, aquí verás quiénes son tus
          campeones, quiénes se enfrían y quiénes ya casi no vuelven.
        </p>
      )}
    </section>
  );
}

// ─── Quién vuelve: par de stats con su ventana declarada ──────────────────────

function Rate({
  title, window: windowLabel, rate, i,
}: {
  title: string; window: string; rate: RetentionRate; i: number;
}): React.ReactElement {
  return (
    <div className="min-w-0 flex-1">
      {rate.status === 'ok' ? (
        <>
          <p className="text-[26px] font-light leading-8 tabular-nums text-ink">
            {Math.round(rate.rate * 100)}%
          </p>
          <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-gap">
            <span
              className="block h-full origin-left rounded-full animate-viz-grow-x"
              style={{
                '--i': i,
                width: `${Math.round(rate.rate * 100)}%`,
                backgroundColor: 'var(--color-viz-cat-1)',
                animationDelay: 'calc(var(--i) * var(--stagger))',
              } as React.CSSProperties}
            />
          </span>
          <p className="mt-2 text-[11px] font-medium text-faint">
            {title}<br />
            <span className="tabular-nums">{rate.retained} de {rate.cohortSize}</span> · {windowLabel}
          </p>
        </>
      ) : (
        <>
          {/* Por debajo del piso de cohorte NO se rinde un %: un 100% de dos
              clientes no es un dato, es una anécdota. */}
          <p className="text-[15px] font-medium text-faint">Sin datos suficientes</p>
          <span className="mt-2 block h-1 w-full rounded-full bg-gap" />
          <p className="mt-2 text-[11px] font-medium text-faint">
            {title}<br />
            <span className="tabular-nums">{rate.cohortSize}</span> {rate.cohortSize === 1 ? 'cliente' : 'clientes'} · {windowLabel}
          </p>
        </>
      )}
    </div>
  );
}

// ─── Cómo se mueven: el signo es el mensaje ───────────────────────────────────

const MOVEMENT_HIGHLIGHTS: Array<{ from: RfmSegment; to: RfmSegment; read: string; tone: 'good' | 'bad' }> = [
  { from: 'nuevos',    to: 'regulares',      read: 'los estás fidelizando', tone: 'good' },
  { from: 'regulares', to: 'se_estan_yendo', read: 'se están enfriando',    tone: 'bad' },
];

/** Flecha Heroicons outline 18px: sube-derecha para lo bueno, baja-derecha para la fuga. */
function Flecha({ tone }: { tone: 'good' | 'bad' }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      className={`h-[18px] w-[18px] shrink-0 ${tone === 'good' ? 'text-teal-ink' : 'text-amber'}`}
      aria-hidden
    >
      <path
        strokeLinecap="round" strokeLinejoin="round"
        d={tone === 'good' ? 'M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25' : 'M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25'}
      />
    </svg>
  );
}

function MovementBlock({ movement }: { movement: SegmentMovement }): React.ReactElement {
  // Degradado honesto: nadie tenía presencia al cierre del mes pasado → no hay base
  // para comparar. Banda, no un movimiento fabricado.
  if (movement.eligibleCount === 0) {
    return (
      <p className="text-[13px] text-ink-2">
        Aún no hay suficiente historia para ver movimiento. Cuando tus clientes tengan
        más de un mes de historia, aquí verás quiénes se fidelizan y quiénes se enfrían.
      </p>
    );
  }

  const highlighted = MOVEMENT_HIGHLIGHTS
    .map((h) => ({ ...h, count: movement.transitions.find((t) => t.from === h.from && t.to === h.to)?.count ?? 0 }))
    .filter((h) => h.count > 0);

  // "Otras": transiciones reales no destacadas — nada se oculta en silencio.
  const otras = movement.movedCount - highlighted.reduce((a, h) => a + h.count, 0);

  return (
    <>
      {highlighted.length > 0 ? (
        <ul>
          {highlighted.map((h) => (
            <li key={`${h.from}>${h.to}`} className="flex min-h-[44px] items-center gap-3">
              <span className={`shrink-0 text-[22px] font-light leading-7 tabular-nums ${h.tone === 'good' ? 'text-teal-ink' : 'text-amber'}`}>
                {h.count}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-ink">
                  {SEGMENT_STYLE[h.from].label} → {SEGMENT_STYLE[h.to].label}
                </p>
                <p className="text-[11px] font-medium text-faint">{h.read}</p>
              </div>
              <Flecha tone={h.tone} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-2">
          {movement.movedCount === 0
            ? 'Nadie cambió de grupo este mes — tu clientela se mantuvo estable.'
            : 'Sin movimientos destacados este mes.'}
        </p>
      )}
      {otras > 0 && (
        <p className="mt-2 text-[11px] font-medium text-faint">
          Otras <span className="tabular-nums">{otras}</span> transiciones sin cambio de rumbo.
        </p>
      )}
    </>
  );
}

// ─── Vista ────────────────────────────────────────────────────────────────────

export default function ClientelaView({ stats }: { stats: ClientelaStats }): React.ReactElement {
  const { totalCustomers, newThisMonth, segmentCounts, retention, movement } = stats;
  // Mes anterior (UTC, alineado con el `monthStartMs` del agregador) para el reloj etiquetado.
  const prevMonth = MONTHS_ES[(new Date().getUTCMonth() + 11) % 12];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Clientela</p>
      <p className="mt-0.5 text-[11px] font-medium text-faint">
        La base como un todo — sin nombres ni teléfonos.
      </p>

      {totalCustomers > 0 ? (
        <Hero
          total={totalCustomers}
          newThisMonth={newThisMonth}
          counts={segmentCounts}
          segmented={hasSegmentedHistory(segmentCounts)}
        />
      ) : (
        // Degradado con gracia: negocio sin clientes aún, no un panel roto.
        <div className="mt-2 rounded-xl border border-dashed border-line-2 bg-card px-4 py-8 text-center">
          <p className="text-[15px] font-medium text-ink">Todavía no hay clientela que mostrar</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Cuando lleguen tus primeros clientes, aquí verás cómo crece tu base y cómo se
            agrupa por lealtad.
          </p>
        </div>
      )}

      {/* ── Quién vuelve — dos tasas SEPARADAS: mezcladas mienten, porque los
           clientes de siempre ahogan la señal de los nuevos. ── */}
      <section aria-label="Quién vuelve" className="mt-5 rounded-xl bg-card p-4 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Quién vuelve</p>
        <div className="mt-3 flex gap-4">
          <Rate
            title="Nuevos que vuelven"
            window="1ª visita hace 1–3 meses"
            rate={retention.newReturn}
            i={0}
          />
          <span className="w-px shrink-0 bg-line" aria-hidden />
          <Rate
            title="Recompra de base"
            window="clientes de ≥3 visitas"
            rate={retention.baseRepeat}
            i={1}
          />
        </div>
      </section>

      {/* ── Cómo se mueven ── */}
      <section aria-label="Cómo se mueven" className="mt-5 rounded-xl bg-card p-4 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">
          Cómo se mueven · vs cierre de {prevMonth}
        </p>
        <div className="mt-1">
          <MovementBlock movement={movement} />
        </div>
      </section>
    </div>
  );
}
