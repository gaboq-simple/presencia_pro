// ─── Pulso de hoy (Negocio · Panorama) — presentacional ───────────────────────
// Gauge de ocupación (héroe) + proyección tres capas + métricas del día con
// comparación + barberos de hoy. INFORMA, no opina: cada número va con su dato de
// comparación, jamás un juicio ("vas bien" / "mal día" están prohibidos).
//
// Reglas de robustez (Paso 4):
//   1. "Barberos hoy" desaparece con ≤1 barbero (comparar uno contra sí mismo = ruido).
//   2. Sin semana pasada (`comparable=false`) → placeholder que orienta, nunca un +0%.
//   3. >3 barberos → 3 visibles + el resto colapsado en un <details> nativo (sin JS).
//   4. Comparación flat (igual que la semana pasada) en gris neutro, sin juicio.
// Server Component. Tokens Zentriq-claro, Inter tabular-nums. Español mexicano neutro.

import type { PulsoHoy as PulsoHoyData, DayMetric, PulsoBarbero } from '@/lib/pulsoHoy';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));
const pctInt = (p: number | null): number => Math.round((p ?? 0) * 100);

const DOW_NAME = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// Delta neutro (dato, no juicio). Flat (igual) en gris; el color solo dirige la mirada.
function deltaLabel(m: DayMetric, dowName: string): React.ReactElement {
  if (m.lastWeek === null) {
    return <span className="text-faint">sin dato del {dowName} pasado</span>;
  }
  const d = m.today - m.lastWeek;
  if (d === 0) {
    // Regla 4: flat NO alarma ni felicita — gris neutro.
    return <span className="text-faint">igual que el {dowName} pasado</span>;
  }
  const sign = d > 0 ? '+' : '−';
  return (
    <span className="text-ink-2">
      <span className="tabular-nums">{sign}{Math.abs(d)}</span> vs el {dowName} pasado
    </span>
  );
}

// ── Gauge circular (SVG) — donut de progreso. Teal = lleno, track neutro = hueco. ──
function Gauge({ pct }: { pct: number | null }): React.ReactElement {
  const R = 54;
  const C = 2 * Math.PI * R;
  const p = pct ?? 0;
  const offset = C * (1 - p);
  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-past-bg)" strokeWidth="13" />
        {pct !== null && (
          <circle
            cx="70" cy="70" r={R} fill="none"
            stroke="var(--color-teal)" strokeWidth="13" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct === null ? (
          <span className="px-4 text-center text-xs text-faint">nadie<br />agenda hoy</span>
        ) : (
          <>
            <span className="text-4xl font-bold tabular-nums text-ink">{pctInt(pct)}%</span>
            <span className="text-[11px] text-faint">ocupación</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Barra de ocupación de un barbero ──
function BarberoRow({ b }: { b: PulsoBarbero }): React.ReactElement {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{b.staffName}</span>
        <span className="shrink-0 text-sm text-ink-2">
          {b.pct === null
            ? <span className="text-faint">no trabaja hoy</span>
            : <><span className="font-semibold tabular-nums text-ink">{pctInt(b.pct)}%</span> · <span className="tabular-nums">{money(b.revenue)}</span></>}
        </span>
      </div>
      {b.pct !== null && (
        <div className="mt-1 h-2 w-full overflow-hidden rounded bg-tint-1">
          <div className="h-full rounded bg-teal-border" style={{ width: `${Math.max(pctInt(b.pct), 2)}%` }} />
        </div>
      )}
    </li>
  );
}

// Promedio de ocupación (solo barberos que trabajan hoy) para la fila colapsada.
function avgPct(list: PulsoBarbero[]): number | null {
  const vals = list.map((b) => b.pct).filter((p): p is number => p !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const VISIBLE_BARBEROS = 3;

export default function PulsoHoy({ data }: { data: PulsoHoyData }): React.ReactElement {
  const dowName = DOW_NAME[weekdayOf(data.dateStr)] ?? 'la semana';
  const { projection, occupancyDeltaPoints: dp, comparable } = data;

  // Regla 3: 3 visibles + resto colapsado.
  const shown = data.barberos.slice(0, VISIBLE_BARBEROS);
  const rest = data.barberos.slice(VISIBLE_BARBEROS);
  const restAvg = avgPct(rest);

  return (
    <section className="mt-2 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Hoy · ocupación</p>

      {/* ── Héroe: gauge + proyección ── */}
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Gauge pct={data.occupancyPct} />

        <div className="min-w-0 flex-1">
          {/* Comparación de ocupación (dato, no juicio). Regla 2: sin semana pasada → orienta. */}
          {data.occupancyPct !== null && (
            !comparable ? (
              <p className="text-sm text-faint">
                Sin semana pasada todavía — cuando tengas una semana de historia vas a ver cómo cambian tus números.
              </p>
            ) : dp === null ? (
              <p className="text-sm text-faint">sin comparación con el {dowName} pasado</p>
            ) : dp === 0 ? (
              <p className="text-sm text-faint">igual que el {dowName} pasado</p>
            ) : (
              <p className="text-sm text-ink-2">
                <span className={`font-medium tabular-nums ${dp > 0 ? 'text-teal-ink' : 'text-ink'}`}>{dp > 0 ? '+' : '−'}{Math.abs(dp)} pts</span> vs el {dowName} pasado
              </p>
            )
          )}
          <p className="mt-0.5 text-[11px] text-faint">
            <span className="tabular-nums">{data.booked}</span> de <span className="tabular-nums">{data.capacity}</span> lugares agendables
          </p>

          {/* Proyección — tres capas de certeza decreciente */}
          <div className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Ingreso del día</p>
            <p className="mt-1 text-sm text-ink">
              <span className="text-xl font-bold tabular-nums">{money(projection.piso)}</span> ya hecho
            </p>
            <p className="mt-0.5 text-sm text-ink-2">
              <span className="tabular-nums">+{money(projection.agendado)}</span> agendado
              {' · '}
              <span className="tabular-nums">+{money(projection.huecos)}</span> si llenas los huecos
            </p>
            <p className="mt-1 text-[11px] text-faint">
              Piso cobrado. Lo demás es potencial de la agenda y los huecos, no un resultado garantizado.
            </p>
          </div>
        </div>
      </div>

      {/* ── Métricas del día con comparación ── */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-line bg-canvas px-3 py-2">
          <p className="text-2xl font-bold tabular-nums text-ink">{data.citas.today}</p>
          <p className="text-[11px] text-faint">citas</p>
          <p className="mt-0.5 text-[11px]">
            {comparable ? deltaLabel(data.citas, dowName) : <span className="text-faint">—</span>}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-canvas px-3 py-2">
          <p className="text-2xl font-bold tabular-nums text-ink">{data.noShows.today}</p>
          <p className="text-[11px] text-faint">no-shows</p>
          <p className="mt-0.5 text-[11px] text-ink-2">
            {data.noShowRate30d === null
              ? <span className="text-faint">sin promedio aún</span>
              : <>promedio 30d <span className="tabular-nums">{Math.round(data.noShowRate30d * 100)}%</span></>}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-canvas px-3 py-2">
          <p className="text-2xl font-bold tabular-nums text-ink">{data.walkIns.today}</p>
          <p className="text-[11px] text-faint">walk-ins</p>
          <p className="mt-0.5 text-[11px]">
            {comparable ? deltaLabel(data.walkIns, dowName) : <span className="text-faint">—</span>}
          </p>
        </div>
      </div>

      {/* ── Barberos de hoy — Regla 1: solo con 2+ barberos ── */}
      {data.barberos.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Barberos hoy</p>
          <ul className="mt-1 divide-y divide-line">
            {shown.map((b) => <BarberoRow key={b.staffId} b={b} />)}
          </ul>
          {/* Regla 3: el resto colapsa en un <details> nativo (sin JS de cliente). */}
          {rest.length > 0 && (
            <details className="group mt-1 border-t border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-sm text-ink-2 marker:content-none">
                <span>+{rest.length} barbero{rest.length === 1 ? '' : 's'} más</span>
                <span className="text-faint">{restAvg !== null ? `~${pctInt(restAvg)}% ocupación` : 'no trabajan hoy'}</span>
              </summary>
              <ul className="divide-y divide-line">
                {rest.map((b) => <BarberoRow key={b.staffId} b={b} />)}
              </ul>
            </details>
          )}
          <p className="mt-1 px-1 text-[11px] text-faint">
            Ocupación de hoy y lo que lleva cobrado cada uno. Sin propinas.
          </p>
        </div>
      )}
    </section>
  );
}
