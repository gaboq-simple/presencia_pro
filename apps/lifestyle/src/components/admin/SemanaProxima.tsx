// ─── La semana que viene (Negocio · Paso 2) — presentacional ──────────────────
// Barras por día (próximos 7): de un vistazo, qué días vienen flojos y cuáles llenos.
// SEÑALA sin concluir: el color dirige la mirada (ámbar = hueco/oportunidad, teal =
// lleno), y el hueco se muestra como DATO ("N libres"), nunca como juicio ("vacío" /
// "mal día"). El dueño decide con el número; la app no opina.
// Server Component. Tokens Zentriq-claro, Inter tabular-nums.

import type { SemanaProxima as SemanaData, SemanaDia } from '@/lib/pulsoSemana';
import { occupancyBand } from '@/lib/pulso';

const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const dayNum = (dateStr: string): string => String(Number(dateStr.split('-')[2]));
const pctInt = (p: number | null): number => Math.round((p ?? 0) * 100);

// El color de relleno traduce la banda a "dónde mirar": ámbar = flojo (hay lugar),
// teal fuerte = lleno (se está por tapar), teal medio = neutro. No es un semáforo de
// aprobación — es una guía de atención.
function fillClass(day: SemanaDia): string {
  switch (occupancyBand(day.pct)) {
    case 'flojo': return 'bg-amber-border';
    case 'lleno': return 'bg-teal-border';
    case 'medio': return 'bg-teal';
    default:      return 'bg-past-line';
  }
}

function DayBar({ day }: { day: SemanaDia }): React.ReactElement {
  const band = occupancyBand(day.pct);
  const closed = band === 'cerrado';
  const flojo = band === 'flojo';
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      {/* % arriba (o —) */}
      <span className="text-[11px] font-semibold tabular-nums text-ink">
        {closed ? <span className="text-faint">—</span> : `${pctInt(day.pct)}%`}
      </span>

      {/* Track de altura fija → la barra resuelve su % contra él. */}
      <div className="flex h-28 w-full items-end rounded bg-past-bg/50">
        {!closed && (
          <div
            className={`w-full rounded ${fillClass(day)}`}
            style={{ height: `${Math.max(pctInt(day.pct), 3)}%` }}
            title={`${DOW_SHORT[day.dow]} ${dayNum(day.dateStr)} · ${day.booked}/${day.capacity} agendables`}
          />
        )}
      </div>

      {/* Etiqueta del día */}
      <span className="text-center text-[11px] leading-tight text-faint">
        <span className="block">{DOW_SHORT[day.dow]}</span>
        <span className="block tabular-nums">{dayNum(day.dateStr)}</span>
      </span>

      {/* Señal como DATO: los huecos de los días flojos (no "vacío"). */}
      <span className="h-3 text-center text-[10px] leading-none tabular-nums text-amber">
        {closed ? 'cerrado' : flojo ? `${day.emptySlots} libres` : ''}
      </span>
    </div>
  );
}

export default function SemanaProxima({ data }: { data: SemanaData }): React.ReactElement | null {
  const anyOpen = data.days.some((d) => d.capacity > 0);
  if (!anyOpen) return null; // ningún día con capacidad (negocio sin horarios) → no renderiza

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Los próximos 7 días</p>
      <p className="mt-1 text-sm text-ink-2">Ocupación proyectada de cada día. En ámbar, los días con más lugar libre.</p>

      <div className="mt-3 flex items-end justify-between gap-1.5">
        {data.days.map((d) => <DayBar key={d.dateStr} day={d} />)}
      </div>

      <p className="mt-2 px-1 text-[11px] text-faint">
        Capacidad de cada día según los horarios que vienen, restando días libres y bloqueos ya cargados.
      </p>
    </section>
  );
}
