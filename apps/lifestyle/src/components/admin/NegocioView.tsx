// ─── Pestaña "Panorama" — todo cómo va ────────────────────────────────────────
// Server Component presentacional. Lectura pura (no muta nada).
// Paso 4 (mapa A): el pulso de hoy + la semana que viene + el feed de rescate arriba;
// el BI histórico (Ingresos del mes, heatmap, recompra) PLEGADO abajo en un <details>.
// El panel de administración se movió a la pestaña "Administrar".
//   Ingresos (héroe sellado + comparación mismo-tramo + 6 meses).
//   Ocupación (heatmap POSITIVO día×hora + huecos + potencial hedged).
//   Barberos (recompra vs promedio del local, SIN ranking).
// Copy sin promesas, sin juicios. Tokens Zentriq-claro. Español mexicano neutro.

import type { NegocioRevenue } from '@/lib/negocioMetrics';
import type { OccupancyResult } from '@/lib/occupancy';
import type { StaffRecompraResult, StaffRecompraRow, RecompraTone } from '@/lib/staffRecompra';
import type { PulsoHoy as PulsoHoyData } from '@/lib/pulsoHoy';
import type { SemanaProxima as SemanaData } from '@/lib/pulsoSemana';
import type { RetentionFeed } from '@/lib/cadence';
import PulsoHoy from '@/components/admin/PulsoHoy';
import SemanaProxima from '@/components/admin/SemanaProxima';
import HoyFeed from '@/components/admin/HoyFeed';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
function money(n: number): string {
  return MXN.format(Math.round(n));
}

// ── Comparación de tramo (real, no proyección) ──
function Comparison({ c }: { c: NonNullable<NegocioRevenue['comparison']> }): React.ReactElement {
  const delta = c.thisMonthToDate - c.prevMonthSameTramo;
  const up = delta >= 0;
  const tone = up ? 'text-teal-ink' : 'text-amber';
  const arrow = up ? '▲' : '▼';
  return (
    <p className="mt-2 text-sm text-ink-2">
      <span className={`font-medium tabular-nums ${tone}`}>{arrow} {money(Math.abs(delta))}</span>{' '}
      vs {c.prevMonthName}: a esta altura del mes ibas{' '}
      <span className="font-medium tabular-nums">{money(c.prevMonthSameTramo)}</span>
      {c.prevMonthClamped && <span className="text-faint"> (mes completo)</span>}.
    </p>
  );
}

// ── Serie de 6 meses ──
function MonthlyBars({ months }: { months: NegocioRevenue['months'] }): React.ReactElement {
  const max = Math.max(1, ...months.map((m) => m.revenue));
  return (
    <div className="mt-4 flex items-end justify-between gap-2">
      {months.map((m) => {
        const h = Math.round((m.revenue / max) * 100);
        return (
          <div key={m.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[10px] text-faint tabular-nums">{m.revenue > 0 ? money(m.revenue) : ''}</span>
            {/* Track de altura fija → el % de la barra resuelve contra él. */}
            <div className="flex h-24 w-full items-end">
              <div
                className={`w-full rounded-t ${m.partial ? 'border border-b-0 border-dashed border-teal-border bg-tint-1' : 'bg-teal-border'}`}
                style={{ height: `${Math.max(h, m.revenue > 0 ? 5 : 0)}%` }}
                title={m.partial ? `${m.label} (en curso)` : m.label}
              />
            </div>
            <span className="text-center text-[11px] text-faint">
              {m.label}
              {m.partial && <span className="block text-[9px] text-teal-ink">en curso</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Ocupación: heatmap positivo día×hora ──
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function fmtHour(h: number): string {
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${am ? 'a' : 'p'}`;
}
// Verde creciente con ocupación (llenar = orgullo). Vacío = teal muy pálido, calmo.
function cellBg(intensity: number): string {
  const alpha = 0.08 + intensity * 0.82; // 0.08 (pálido) → 0.9 (lleno)
  return `rgba(29,158,117,${alpha.toFixed(2)})`; // teal operativo #1D9E75
}

function Heatmap({ occ }: { occ: OccupancyResult }): React.ReactElement {
  const cellOf = new Map(occ.cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const isOpportunity = new Set(occ.opportunities.map((o) => `${o.dow}:${o.hour}`));
  const isStar = occ.starCell ? `${occ.starCell.dow}:${occ.starCell.hour}` : '';
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: '2px' }}>
        <thead>
          <tr>
            <th className="w-8" />
            {occ.hours.map((h) => (
              <th key={h} className="px-0.5 text-[9px] font-normal text-faint tabular-nums">{fmtHour(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {occ.dows.map((dow) => (
            <tr key={dow}>
              <td className="pr-1 text-[10px] text-faint">{DOW_SHORT[dow]}</td>
              {occ.hours.map((h) => {
                const c = cellOf.get(`${dow}:${h}`);
                const k = `${dow}:${h}`;
                if (!c || c.capacity === 0 && occ.mode === 'capacity') {
                  return <td key={h} className="h-6 w-6 rounded-sm bg-past-bg/40" title="cerrado" />;
                }
                const opp = isOpportunity.has(k);
                return (
                  <td
                    key={h}
                    className={`h-6 w-6 rounded-sm text-center align-middle ${opp ? 'ring-2 ring-amber-border' : ''}`}
                    style={{ backgroundColor: cellBg(c.intensity) }}
                    title={`${DOW_SHORT[dow]} ${fmtHour(h)} · ${occ.mode === 'capacity' ? `${Math.round((c.occPct ?? 0) * 100)}% lleno` : `${c.booked} citas`}`}
                  >
                    {k === isStar && <span className="text-[10px] leading-none">★</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OcupacionBlock({ occ }: { occ: OccupancyResult }): React.ReactElement | null {
  if (occ.cells.length === 0) return null; // sin datos → no renderiza (sin crash)

  const capMode = occ.mode === 'capacity';
  const pct = capMode && occ.overallPct !== null ? Math.round(occ.overallPct * 100) : null;

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Ocupación · semana típica</p>

      {capMode && pct !== null ? (
        <p className="mt-2 text-sm text-ink-2">
          <span className="text-2xl font-bold tabular-nums text-ink">{pct}%</span> de tus sillas ocupadas.
          El otro {100 - pct}% son huecos que igual pagás — ahí está tu espacio para crecer.
        </p>
      ) : (
        <p className="mt-2 text-sm text-faint">
          Definí los horarios de tus barberos para ver ocupación real; por ahora, el patrón de concurrencia.
        </p>
      )}

      <Heatmap occ={occ} />

      {capMode && occ.opportunities.length > 0 && (
        <div className="mt-3 rounded-xl border-l-4 border-l-amber-border bg-amber-tint/40 px-3 py-2">
          <p className="text-sm font-medium text-ink">Tu mayor oportunidad</p>
          <p className="mt-0.5 text-sm text-ink-2">
            {occ.opportunities.map((o) => `${DOW_SHORT[o.dow]} ${fmtHour(o.hour)}`).join(' y ')}
            {' '}está{occ.opportunities.length > 1 ? 'n' : ''} casi {occ.opportunities.length > 1 ? 'vacías' : 'vacía'}.
          </p>
          {occ.potentialMonthly !== null && occ.potentialMonthly > 0 && (
            <p className="mt-1 text-xs text-faint">
              Potencial estimado: hasta ~{money(occ.potentialMonthly)}/mes si trabajás esas franjas. No es un resultado garantizado.
            </p>
          )}
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Próximamente"
            className="mt-2 cursor-not-allowed rounded-lg border border-teal-border bg-tint-1 px-3 py-1.5 text-sm font-medium text-teal-ink opacity-70"
          >
            Crear promo
          </button>
        </div>
      )}
      <p className="mt-2 px-1 text-[11px] text-faint">
        Ocupación estimada sobre los horarios de tus barberos (servicio típico), últimas 8 semanas.
      </p>
    </section>
  );
}

// ── Barberos: recompra de héroe vs promedio del local (PR-Neg-3) ──
function pct(n: number): number {
  return Math.round(n * 100);
}

// Tono → colores del relleno de la barra (teal arriba, gris cerca, ámbar abajo).
// El color habla de la relación con el PROMEDIO, no de un puesto en un ranking.
const TONE_FILL: Record<RecompraTone, string> = {
  above: 'bg-teal-border',
  near: 'bg-line-2',
  below: 'bg-amber-border',
  insufficient: 'bg-line-2',
};

function BarberoRow({ row, avgRate }: { row: StaffRecompraRow; avgRate: number | null }): React.ReactElement {
  const r = row.rate; // narrowing por status del union discriminado
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{row.staffName}</span>
        {r.status === 'ok' ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{pct(r.rate)}%</span>
        ) : (
          <span className="shrink-0 text-[11px] text-faint">aún juntando datos</span>
        )}
      </div>

      {r.status === 'ok' ? (
        // Track 0–100% igual para todos; la línea del promedio cae en la MISMA x en
        // cada barbero → "vs promedio" se lee sin ordenar por la métrica.
        <div className="relative mt-1 h-5 w-full overflow-hidden rounded bg-tint-1">
          <div
            className={`h-full rounded ${TONE_FILL[row.tone]}`}
            style={{ width: `${Math.max(pct(r.rate), 2)}%` }}
          />
          {avgRate !== null && (
            <div
              className="absolute inset-y-0 w-px bg-ink/50"
              style={{ left: `${pct(avgRate)}%` }}
              title={`Promedio del local: ${pct(avgRate)}%`}
            />
          )}
        </div>
      ) : (
        // Piso: <5 clientes maduros → sin barra (una barra sería un juicio con ruido).
        <p className="mt-1 text-[11px] text-faint">
          {r.cohortSize === 0
            ? 'Sin clientes con visita completada todavía.'
            : `Solo ${r.cohortSize} cliente${r.cohortSize === 1 ? '' : 's'} con historia — hace falta más para una tasa creíble.`}
        </p>
      )}
    </li>
  );
}

// Promedio de recompra de un subconjunto (solo rates listas) para la fila colapsada.
function avgRecompra(rows: StaffRecompraRow[]): number | null {
  const vals = rows.map((r) => (r.rate.status === 'ok' ? r.rate.rate : null)).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const VISIBLE_RECOMPRA = 3;

function BarberosBlock({ data }: { data: StaffRecompraResult }): React.ReactElement | null {
  // Regla de robustez 1: con ≤1 barbero no hay con qué comparar (su recompra ya es la
  // del local) → la sección no aporta, no se renderiza.
  if (data.staff.length <= 1) return null;

  const avg = data.localAverage;
  const avgRate = avg.status === 'ok' ? avg.rate : null;
  const anyRate = data.staff.some((s) => s.rate.status === 'ok');

  // Regla 3: 3 visibles + resto colapsado.
  const shown = data.staff.slice(0, VISIBLE_RECOMPRA);
  const rest = data.staff.slice(VISIBLE_RECOMPRA);
  const restAvg = avgRecompra(rest);

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Barberos · recompra</p>
      <p className="mt-1 text-sm text-ink-2">
        De los clientes que atendió cada barbero, cuántos <span className="font-medium">volvieron a él</span>.
        No es cuántos cortes hizo — es si su gente regresa.
      </p>

      {avgRate !== null ? (
        <p className="mt-2 text-sm text-ink-2">
          Promedio del local:{' '}
          <span className="font-semibold tabular-nums text-ink">{pct(avgRate)}%</span>
          <span className="text-faint"> — la línea de referencia en cada barra.</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-faint">Aún juntando historia de recompra del local.</p>
      )}

      <ul className="mt-3 divide-y divide-line">
        {shown.map((row) => (
          <BarberoRow key={row.staffId} row={row} avgRate={avgRate} />
        ))}
      </ul>
      {/* Regla 3: el resto colapsa en un <details> nativo (sin JS de cliente). */}
      {rest.length > 0 && (
        <details className="group mt-1 border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-sm text-ink-2 marker:content-none">
            <span>+{rest.length} barbero{rest.length === 1 ? '' : 's'} más</span>
            <span className="text-faint">{restAvg !== null ? `~${pct(restAvg)}% recompra` : 'aún sin tasa'}</span>
          </summary>
          <ul className="divide-y divide-line">
            {rest.map((row) => (
              <BarberoRow key={row.staffId} row={row} avgRate={avgRate} />
            ))}
          </ul>
        </details>
      )}

      {/* Caveat de justicia — el número se conversa, no se castiga. */}
      <div className="mt-3 rounded-xl border-l-4 border-l-line-2 bg-tint-1/40 px-3 py-2">
        <p className="text-[11px] text-ink-2">
          La recompra cambia por horario, antigüedad o tipo de cliente. Un barbero con menos
          clientes no es peor — tiene menos datos. Úsalo para conversar, no para castigar.
        </p>
      </div>

      <p className="mt-2 px-1 text-[11px] text-faint">
        {anyRate ? 'Histórico. ' : ''}Un cliente entra al cálculo cuando pasaron al menos {data.matureDays} días
        desde su primera visita con ese barbero (antes, aún está en tiempo de volver).
      </p>
    </section>
  );
}

export default function NegocioView({ revenue, occupancy, barberos, pulso, semana, feed, contactados }: { revenue: NegocioRevenue; occupancy: OccupancyResult; barberos: StaffRecompraResult; pulso: PulsoHoyData; semana: SemanaData; feed: RetentionFeed; contactados: number }): React.ReactElement {
  const { thisMonth, comparison, months, hasAnyRevenue } = revenue;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <p className="px-1 text-xs text-faint">Cómo va tu negocio — hoy, lo que viene y la historia.</p>

      {/* ── Pulso de hoy (Paso 1) — arriba de todo ── */}
      <PulsoHoy data={pulso} />

      {/* ── La semana que viene (Paso 2) — la pieza accionable ── */}
      <SemanaProxima data={semana} />

      {/* ── El rescate (feed RFM, ex-pestaña "Hoy") — lugar de "la fuga" (se rediseña
           en un paso posterior; por ahora se preserva tal cual). ── */}
      <div className="mt-6">
        <HoyFeed feed={feed} contactados={contactados} embedded />
      </div>

      {/* ── BI histórico — plegado abajo: el "cómo viene el mes" no compite con el hoy. ── */}
      <details className="group mt-6">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-card px-4 py-3 shadow-card marker:content-none">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">La historia · ingresos, ocupación y barberos</span>
          <span className="text-faint transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        </summary>

      {/* ── Ingresos (héroe) ── */}
      <section className="mt-2 rounded-xl bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Ingresos · este mes</p>
          <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-faint">estimado</span>
        </div>

        {hasAnyRevenue ? (
          <>
            <p className="mt-2 text-4xl font-bold tabular-nums text-ink">{money(thisMonth)}</p>
            {comparison
              ? <Comparison c={comparison} />
              : <p className="mt-2 text-sm text-faint">Aún no hay un mes anterior con ingresos para comparar.</p>}
            <MonthlyBars months={months} />
            <p className="mt-2 px-1 text-[11px] text-faint">
              Estimado sobre el precio de cada servicio al completarse. No incluye propinas ni productos.
            </p>
          </>
        ) : (
          // Degradado: negocio nuevo sin ingresos aún — digno, no seis ceros.
          <div className="mt-3 rounded-xl border border-dashed border-line-2 bg-card px-4 py-8 text-center">
            <p className="text-sm font-medium text-ink">Aún juntando historia de ingresos</p>
            <p className="mt-1 text-sm text-ink-2">
              Cuando completes tus primeras citas, aquí verás cuánto llevas este mes y cómo se
              compara con el anterior.
            </p>
          </div>
        )}
      </section>

      {/* ── Ocupación (PR-Neg-2) ── */}
      <OcupacionBlock occ={occupancy} />

      {/* ── Barberos · recompra de héroe (PR-Neg-3) ── */}
      <BarberosBlock data={barberos} />
      </details>
    </div>
  );
}
