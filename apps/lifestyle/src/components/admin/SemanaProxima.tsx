// ─── La semana que viene (Negocio · Paso 2 · recompuesto en dv3-3') ───────────
// Columnas pista+relleno con el kit (`Columnas`), y el hueco señalado con un
// ANILLO ámbar en los dos días con más lugar — no pintando de ámbar todo lo
// flojo. La diferencia importa: el relleno MIDE (ocupación, un solo matiz) y el
// anillo SEÑALA (dónde hay lugar). Cuando el color hacía las dos cosas, un día
// al 35% y otro al 5% se veían igual de ámbar y el dato se perdía.
//
// La card perdió su borde de acento: el gesto de marca (border-left) es del
// héroe y de nadie más — si lo llevan dos piezas, deja de ser un gesto.
//
// SEÑALA sin concluir: el hueco se muestra como DATO ("N libres"), nunca como
// juicio. Server Component. Tokens Zentriq-claro, Inter tabular-nums.

import type { SemanaProxima as SemanaData } from '@/lib/pulsoSemana';
import { Columnas, type ColumnaDato } from '@/components/admin/viz/Columnas';
import { pctWidth } from '@/lib/viz';

const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const dayNum = (dateStr: string): string => String(Number(dateStr.split('-')[2]));

/** Cuántos días se marcan como "acá hay lugar". Dos: uno solo se lee como
 *  excepción y tres ya es "toda la semana está floja" — deja de dirigir. */
const DIAS_SEÑALADOS = 2;

export default function SemanaProxima({ data }: { data: SemanaData }): React.ReactElement | null {
  const anyOpen = data.days.some((d) => d.capacity > 0);
  if (!anyOpen) return null; // ningún día con capacidad (negocio sin horarios) → no renderiza

  // Los dos días con MÁS lugar libre, y solo si de verdad hay lugar: sin huecos
  // no hay nada que señalar y la semana se rinde sin anillos.
  const conHueco = data.days.filter((d) => d.capacity > 0 && d.emptySlots > 0);
  const señalados = new Set(
    [...conHueco].sort((a, b) => b.emptySlots - a.emptySlots).slice(0, DIAS_SEÑALADOS).map((d) => d.dateStr),
  );

  const maxOcupacion = Math.max(0, ...data.days.map((d) => d.pct ?? 0));

  const datos: ColumnaDato[] = data.days.map((d) => ({
    label:   `${DOW_SHORT[d.dow]} ${dayNum(d.dateStr)}`,
    pct:     pctWidth(d.pct ?? 0, maxOcupacion),
    actual:  señalados.has(d.dateStr),
    anillo:  'ambar',
    cerrado: d.capacity === 0,
    valor:   señalados.has(d.dateStr) ? `${d.emptySlots} libres` : undefined,
  }));

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Los próximos 7 días</p>
      <p className="mt-1 text-sm text-ink-2">
        Ocupación proyectada de cada día. Con anillo, los dos días con más lugar libre.
      </p>

      <div className="mt-3">
        <Columnas datos={datos} />
      </div>

      <p className="mt-2 px-1 text-[11px] text-faint">
        Capacidad de cada día según los horarios que vienen, restando días libres y bloqueos ya cargados.
      </p>
    </section>
  );
}
