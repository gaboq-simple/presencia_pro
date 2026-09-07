// ─── Pulso de hoy (Negocio · Panorama) — presentacional ───────────────────────
// Cuatro stats del día + dos líneas de contexto. INFORMA, no opina: cada número
// va con su dato de comparación, jamás un juicio ("vas bien" / "mal día" están
// prohibidos).
//
// P1 (S10-DUE-01) le sacó el bloque "Barberos hoy" —era su pieza más alta— y lo
// mudó a Administrar como `BarberosHoy.tsx`, junto al riel del día y al equipo de
// la semana. Con él se fueron las reglas 1 y 3, que eran suyas y viajaron con el
// componente. Lo que queda acá es el pulso: cuánto se lleva cobrado, qué tan
// llena está la silla, cuántas citas y cuántas faltas.
//
// Reglas de robustez que SIGUEN acá (Paso 4):
//   2. Sin semana pasada (`comparable=false`) → placeholder que orienta, nunca un +0%.
//   4. Comparación flat (igual que la semana pasada) en gris neutro, sin juicio.
// Server Component. Tokens Zentriq-claro, Inter tabular-nums. Español mexicano neutro.

import type { PulsoHoy as PulsoHoyData, DayMetric } from '@/lib/pulsoHoy';
import { StatFila } from '@/components/admin/viz/StatFila';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));

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

export default function PulsoHoy({ data }: { data: PulsoHoyData }): React.ReactElement {
  const dowName = DOW_NAME[weekdayOf(data.dateStr)] ?? 'la semana';
  const { projection, cobrado, occupancyDeltaPoints: dp, comparable } = data;

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

    </section>
  );
}
