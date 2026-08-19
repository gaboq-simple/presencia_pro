// ─── Pestaña "Análisis" — la historia del negocio (dv3-6) ─────────────────────
// Server Component presentacional. Es la APUESTA del plan: asume que el dueño
// quiere el análisis separado del pulso. Si las entrevistas la invalidan, se
// retira y Panorama recupera su `<details>` "La historia" — nada más se pierde.
//
// Tres de sus cinco cards salieron del `<details>` de Panorama y **reusan sus
// módulos sin tocarles una línea** (`negocioMetrics`, `occupancy`,
// `staffRecompra`); lo que cambia es la piel. Las dos nuevas —mezcla por
// servicio y canal + la ventana al bot— son la razón de que la pestaña exista.
//
// **La ventana al bot es el diferenciador y hasta hoy era invisible.** El bot
// agenda, conversa y a veces le pasa la conversación a una persona, y el dueño
// no tenía una sola superficie donde ver que eso ocurre. Tres números y ninguna
// promesa.
//
// 🔴 La frontera de D6 sigue en pie: el titular dice "Ingresos" y lleva el chip
//    "estimado" porque es agenda × (`price_charged` ∥ precio de lista) — un
//    DERIVADO. "Cobrado" es la palabra del estado confirmado y vive en Panorama.

import type { NegocioRevenue } from '@/lib/negocioMetrics';
import type { OccupancyResult } from '@/lib/occupancy';
import type { StaffRecompraResult, StaffRecompraRow } from '@/lib/staffRecompra';
import type { AnalisisData } from '@/lib/analisisData';
import { CANAL_COLOR, CANAL_LABEL } from '@/lib/analisis';
import { seqStep, pctWidth } from '@/lib/viz';
import { BarraFila } from './viz/BarraFila';
import { HeatmapGrid, type HeatCelda } from './viz/HeatmapGrid';
import { Columnas, type ColumnaDato } from './viz/Columnas';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function fmtHour(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'a' : 'p'}`;
}

// ─── 1. Héroe: el mes ─────────────────────────────────────────────────────────

function Hero({ revenue, mesLabel }: { revenue: NegocioRevenue; mesLabel: string }): React.ReactElement {
  const { thisMonth, comparison, months, hasAnyRevenue } = revenue;
  const max = Math.max(0, ...months.map((m) => m.revenue));

  const datos: ColumnaDato[] = months.map((m) => ({
    label:  m.label,
    pct:    pctWidth(m.revenue, max),
    valor:  m.revenue > 0 ? `${Math.round(m.revenue / 1000)}k` : undefined,
    actual: m.partial,
  }));

  return (
    <section aria-label="Ingresos del mes" className="mt-2 rounded-xl border-l-2 border-l-teal bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Ingresos · {mesLabel}</p>
        <span className="shrink-0 rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-faint">estimado</span>
      </div>

      {hasAnyRevenue ? (
        <>
          <p className="mt-3 text-[40px] font-light leading-[44px] tabular-nums tracking-[-.02em] text-ink">
            {money(thisMonth)}
          </p>
          {comparison ? (
            <p className="mt-1 text-[13px] text-ink-2">
              <span className={`font-medium tabular-nums ${comparison.thisMonthToDate >= comparison.prevMonthSameTramo ? 'text-teal-ink' : 'text-amber'}`}>
                {comparison.thisMonthToDate >= comparison.prevMonthSameTramo ? '▲' : '▼'}{' '}
                {money(Math.abs(comparison.thisMonthToDate - comparison.prevMonthSameTramo))}
              </span>{' '}
              vs {comparison.prevMonthName} a esta altura (
              <span className="tabular-nums">{money(comparison.prevMonthSameTramo)}</span>)
              {comparison.prevMonthClamped && <span className="text-faint"> · mes completo</span>}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-faint">Aún no hay un mes anterior con ingresos para comparar.</p>
          )}
          <div className="mt-4">
            <Columnas datos={datos} />
          </div>
          <p className="mt-2 text-[11px] text-faint">
            Estimado sobre el precio de cada servicio al completarse. No incluye propinas ni productos.
          </p>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-line-2 px-4 py-8 text-center">
          <p className="text-[15px] font-medium text-ink">Aún juntando historia de ingresos</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Cuando completes tus primeras citas, aquí verás cuánto llevas este mes y cómo se
            compara con el anterior.
          </p>
        </div>
      )}
    </section>
  );
}

// ─── 2. Semana típica (ocupación) ─────────────────────────────────────────────

function SemanaTipica({ occ }: { occ: OccupancyResult }): React.ReactElement | null {
  if (occ.cells.length === 0) return null;

  const cellOf = new Map(occ.cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const celdas: HeatCelda[][] = occ.dows.map((dow) =>
    occ.hours.map((h) => {
      const c = cellOf.get(`${dow}:${h}`);
      if (!c || (occ.mode === 'capacity' && c.capacity === 0)) {
        return { cerrado: true, step: 1, titulo: `${DOW_SHORT[dow]} ${fmtHour(h)} · cerrado` };
      }
      return {
        step: seqStep(c.intensity),
        titulo: `${DOW_SHORT[dow]} ${fmtHour(h)} · ${
          occ.mode === 'capacity' ? `${Math.round((c.occPct ?? 0) * 100)}% lleno` : `${c.booked} citas`
        }`,
      };
    }),
  );

  const pct = occ.mode === 'capacity' && occ.overallPct !== null ? Math.round(occ.overallPct * 100) : null;

  return (
    <section aria-label="Ocupación de la semana típica" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Ocupación · semana típica</p>
      <p className="mt-2 text-[13px] text-ink-2">
        {pct !== null ? (
          <>
            <span className="text-[22px] font-light leading-[26px] tabular-nums text-ink">{pct}%</span>{' '}
            de tus sillas ocupadas, últimas {occ.windowWeeks} semanas.
          </>
        ) : (
          'Define los horarios de tus barberos para ver ocupación real; por ahora, el patrón de concurrencia.'
        )}
      </p>

      <div className="mt-3 overflow-x-auto">
        <HeatmapGrid
          celdas={celdas}
          columnas={occ.hours.map((h) => fmtHour(h))}
          filas={occ.dows.map((d) => DOW_SHORT[d]!)}
          rampa="seq"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium text-faint">menos</span>
        <span className="flex gap-0.5">
          {[1, 3, 5, 7].map((s) => (
            <span key={s} className="h-2 w-3.5 rounded-[2px]" style={{ backgroundColor: `var(--color-viz-seq-${s})` }} />
          ))}
        </span>
        <span className="text-[11px] font-medium text-faint">más ocupado</span>
        {occ.opportunities.length > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-faint">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-border" aria-hidden />
            {occ.opportunities.map((o) => `${DOW_SHORT[o.dow]} ${fmtHour(o.hour)}`).join(' y ')}, casi
            {occ.opportunities.length > 1 ? ' vacías' : ' vacía'}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Ocupación estimada sobre los horarios de tus barberos (servicio típico).
      </p>
    </section>
  );
}

// ─── 3. Mezcla por servicio ───────────────────────────────────────────────────

function Servicios({ data, mesLabel }: { data: AnalisisData['servicios']; mesLabel: string }): React.ReactElement {
  return (
    <section aria-label="Servicios del mes" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      {/* El total VOLVIÓ (S7-BUG-01). Se había retirado en dv3-6 porque no cuadraba
          con el titular del héroe —$46,580 contra $47,100— y dos cifras que se
          contradicen en la misma pantalla son peores que una sola. La causa era
          `revenueTrend` armando sus ventanas en UTC; migrado al helper, la
          invariante del plan se cumple: **la suma de las barras ES el titular**. */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Servicios · {mesLabel}</p>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-faint">{money(data.total)}</span>
      </div>
      {data.vacio ? (
        <p className="py-6 text-center text-[13px] text-faint">Sin servicios cobrados este mes todavía.</p>
      ) : (
        <div className="mt-1">
          {data.filas.map((f, i) => (
            <BarraFila
              key={f.nombre}
              label={f.nombre}
              pct={f.pct}
              valor={money(f.revenue)}
              i={i}
              esOtros={f.esOtros}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── 4. Canal + la ventana al bot ─────────────────────────────────────────────

function CanalYBot({ canal, bot, mesLabel }: {
  canal: AnalisisData['canal']; bot: AnalisisData['bot']; mesLabel: string;
}): React.ReactElement {
  return (
    <section aria-label="De dónde vienen las citas" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">
        De dónde vienen las citas · {mesLabel}
      </p>

      {canal.vacio ? (
        <p className="mt-3 text-[13px] text-faint">Sin citas este mes todavía.</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-[4px] bg-gap">
            {canal.filas.filter((f) => f.pct > 0).map((f) => (
              <span
                key={f.key}
                className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                style={{ width: `${f.pct}%`, backgroundColor: CANAL_COLOR[f.key] }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {canal.filas.map((f) => (
              <span key={f.key} className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: CANAL_COLOR[f.key] }} aria-hidden />
                {CANAL_LABEL[f.key]}{' '}
                <strong className="font-semibold tabular-nums text-ink-2">{Math.round(f.pct)}%</strong>
              </span>
            ))}
          </div>
        </>
      )}

      {/* La ventana al bot: el diferenciador, visible por primera vez para el dueño. */}
      <div className="mt-4 flex border-t border-line pt-3">
        {[
          { n: bot.conversaciones,   l: <>conversaciones<br />esta semana</> },
          { n: bot.citasDelBot,      l: <>citas del bot<br />esta semana</> },
          { n: bot.tomadasPorHumano, l: <>tomadas por<br />tu equipo</> },
        ].map((x, i) => (
          <div key={i} className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tabular-nums text-ink">{x.n}</p>
            <p className="text-[11px] font-medium text-faint">{x.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── 5. Barberos · recompra ───────────────────────────────────────────────────

const TONE_FILL: Record<StaffRecompraRow['tone'], string> = {
  above:        'var(--color-viz-cat-1)',
  near:         'var(--color-line-2)',
  below:        'var(--color-amber-border)',
  insufficient: 'var(--color-line-2)',
};

function Barberos({ data }: { data: StaffRecompraResult }): React.ReactElement | null {
  if (data.staff.length === 0) return null;
  const avg = data.localAverage.status === 'ok' ? data.localAverage.rate : null;

  return (
    <section aria-label="Recompra por barbero" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Barberos · recompra</p>
      <p className="mt-1 text-[11px] font-medium text-faint">
        De los clientes de cada barbero, cuántos volvieron a él.
        {avg !== null && <> Promedio del local: <span className="font-semibold tabular-nums text-ink-2">{Math.round(avg * 100)}%</span> (la línea).</>}
      </p>

      <div className="mt-1">
        {data.staff.map((row, i) => (
          row.rate.status === 'ok' ? (
            <div key={row.staffId} className="py-2">
              <div className="flex justify-between">
                <span className="text-[13px] font-medium text-ink">{row.staffName}</span>
                <span className="text-[13px] font-semibold tabular-nums text-ink">{Math.round(row.rate.rate * 100)}%</span>
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-[4px] bg-tint-1">
                <span
                  className="block h-full origin-left rounded-[4px] animate-viz-grow-x"
                  style={{
                    '--i': i,
                    width: `${Math.round(row.rate.rate * 100)}%`,
                    backgroundColor: TONE_FILL[row.tone],
                    animationDelay: 'calc(var(--i) * var(--stagger))',
                  } as React.CSSProperties}
                />
                {/* La línea del promedio: el color habla de la relación con ella,
                    no de un puesto en un ranking. */}
                {avg !== null && (
                  <span
                    className="absolute -top-0.5 -bottom-0.5 w-px bg-ink opacity-50"
                    style={{ left: `${Math.round(avg * 100)}%` }}
                    aria-hidden
                  />
                )}
              </div>
            </div>
          ) : (
            <div key={row.staffId} className="flex min-h-[44px] items-center gap-3">
              <span className="flex-1 text-[13px] font-medium text-ink">{row.staffName}</span>
              <span className="text-[11px] font-medium text-faint">aún juntando datos</span>
            </div>
          )
        ))}
      </div>

      <p className="mt-1 text-[11px] font-medium text-faint">
        La recompra cambia por horario y antigüedad. Úsalo para conversar, no para castigar.
      </p>
    </section>
  );
}

// ─── Vista ────────────────────────────────────────────────────────────────────

export default function AnalisisView({
  revenue, occupancy, barberos, analisis,
}: {
  revenue: NegocioRevenue;
  occupancy: OccupancyResult;
  barberos: StaffRecompraResult;
  analisis: AnalisisData;
}): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Análisis</p>
      <p className="mt-0.5 text-[11px] font-medium text-faint">
        La historia del negocio — meses, patrones y canales.
      </p>

      <Hero revenue={revenue} mesLabel={analisis.mesLabel} />
      <SemanaTipica occ={occupancy} />
      <Servicios data={analisis.servicios} mesLabel={analisis.mesLabel} />
      <CanalYBot canal={analisis.canal} bot={analisis.bot} mesLabel={analisis.mesLabel} />
      <Barberos data={barberos} />
    </div>
  );
}
