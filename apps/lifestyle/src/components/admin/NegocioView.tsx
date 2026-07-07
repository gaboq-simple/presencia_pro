// ─── Pestaña "Negocio" — la operación (PR-Neg-1: Ingresos) ────────────────────
// Server Component presentacional. Lectura pura (no muta nada). Bloque Ingresos:
// héroe del mes en curso (precio SELLADO), comparación con el mismo tramo del mes
// anterior, y la serie de 6 meses (la del mes en curso marcada PARCIAL).
// Copy sin promesas: muestra lo real + comparación honesta, cero proyección (eso es
// PR-Neg-2, ocupación). Tokens Zentriq-claro.

import type { NegocioRevenue } from '@/lib/negocioMetrics';

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

export default function NegocioView({ revenue }: { revenue: NegocioRevenue }): React.ReactElement {
  const { thisMonth, comparison, months, hasAnyRevenue } = revenue;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <p className="px-1 text-xs text-faint">Tu operación — ingresos reales, sin promesas.</p>

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

      {/* Próximos bloques de Negocio (PR-Neg-2/3). */}
      <p className="mt-6 px-1 text-xs text-faint">
        Ocupación, huecos y barberos llegan pronto a esta pestaña.
      </p>
    </div>
  );
}
