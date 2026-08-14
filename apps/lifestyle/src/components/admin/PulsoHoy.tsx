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
import { StatFila } from '@/components/admin/viz/StatFila';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));
const pctInt = (p: number | null): number => Math.round((p ?? 0) * 100);

const DOW_NAME = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** Misma regla que `deltaLabel`, en texto plano: `StatFila` recibe contexto como
 *  string. Flat es "igual", no un +0 — un cero con signo parece un cambio. */
function deltaTexto(m: DayMetric, dowName: string): string {
  if (m.lastWeek === null) return `sin dato del ${dowName} pasado`;
  const d = m.today - m.lastWeek;
  if (d === 0) return `igual que el ${dowName} pasado`;
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} vs el ${dowName} pasado`;
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
  const { projection, cobrado, occupancyDeltaPoints: dp, comparable } = data;

  // Regla 3: 3 visibles + resto colapsado.
  const shown = data.barberos.slice(0, VISIBLE_BARBEROS);
  const rest = data.barberos.slice(VISIBLE_BARBEROS);
  const restAvg = avgPct(rest);

  return (
    <section className="mt-2 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Hoy · ocupación</p>

      {/* ── Hoy compacto (dv3-3'): el gauge DESAPARECE ──────────────────────
           El donut de 140px era la pieza más grande de la página para el dato
           menos accionable a las 8pm. Degrada a número dentro de la fila de
           stats: la misma información, sin quedarse con el peso visual que
           ahora es del héroe de la semana. ── */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <StatFila
          kicker="Cobrado"
          valor={money(cobrado.total)}
          contexto={cobrado.entradas > 0 ? `incluye ${money(cobrado.entradas)} fuera de agenda` : undefined}
          i={0}
        />
        <StatFila
          kicker="Ocupación"
          valor={data.occupancyPct === null ? '—' : `${Math.round(data.occupancyPct * 100)}%`}
          contexto={`${data.booked} de ${data.capacity} lugares`}
          i={1}
        />
        <StatFila kicker="Citas"    valor={String(data.citas.today)}   contexto={comparable ? deltaTexto(data.citas, dowName) : undefined} i={2} />
        <StatFila kicker="No-shows" valor={String(data.noShows.today)} contexto={data.noShowRate30d === null ? undefined : `promedio 30d ${Math.round(data.noShowRate30d * 100)}%`} i={3} />
      </div>

      {/* La proyección y las salidas quedan como UNA línea de contexto: son
          potencial y contrapeso, no titulares. El titular del día ya está
          arriba, y el de la semana es el héroe. */}
      <p className="mt-3 text-[13px] text-ink-2">
        <span className="tabular-nums">+{money(projection.agendado)}</span> agendado
        {' · '}
        <span className="tabular-nums">+{money(projection.huecos)}</span> si llenas los huecos
        {cobrado.salidas > 0 && (
          <>
            {' · '}
            <span className="tabular-nums">{money(cobrado.salidas)}</span> de salidas (aparte, no se restan)
          </>
        )}
      </p>
      <p className="mt-0.5 text-[13px] text-faint">
        {data.occupancyPct !== null && !comparable && 'Sin semana pasada todavía con qué comparar · '}
        {data.occupancyPct !== null && comparable && dp !== null && dp !== 0 && (
          <>
            <span className="tabular-nums">{dp > 0 ? '+' : '−'}{Math.abs(dp)} pts</span> de ocupación vs el {dowName} pasado{' · '}
          </>
        )}
        <span className="tabular-nums">{data.walkIns.today}</span> walk-ins
      </p>

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
        </div>
      )}
    </section>
  );
}
