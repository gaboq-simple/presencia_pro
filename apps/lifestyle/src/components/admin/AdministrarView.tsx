// ─── Pestaña "Administrar" — operar el día (dv3-4') ───────────────────────────
// Server Component (composición). El orden de la pestaña ES su argumento:
//
//   encabezado con la fecha → EL DÍA COMO RIEL (héroe) → el equipo de la semana
//   → lo del día sin resolver, el cuadre y las solicitudes → configuración
//   plegada en cinco filas.
//
// Lo que cambió de fondo: la agenda dejó de ser una pila de cajas iguales y pasó
// a ser un riel de tiempo, y los ocho paneles de configuración dejaron de
// competir con el día. La pestaña se lee de arriba abajo como se opera un día,
// no como se navega un menú.
//
// La navegación de días vive acá y no en el bloque de abajo porque el día es el
// eje de TODA la pestaña: el riel es de ese día, y la semana del equipo es la
// semana que lo contiene.

import Link from 'next/link';
import type { DayRevenue } from '@/lib/dashboard.types';
import type { EquipoSemana as EquipoSemanaData } from '@/lib/equipoSemana';
import type { DiaRail as DiaRailData } from '@/lib/diaRail';
import { toDateStr } from '@/lib/dashboard.types';
import { isTodayInTz, todayStrInTz } from '@/lib/dayWindow';
import DiaRail from '@/components/admin/DiaRail';
import EquipoSemana from '@/components/admin/EquipoSemana';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offsetDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/**
 * "Martes 18 de agosto".
 *
 * `capitalize` de CSS no sirve acá: pone en mayúscula CADA palabra y rinde
 * "Martes, 18 De Agosto". Y el `es-MX` de `toLocaleDateString` mete una coma
 * después del día de la semana que la maqueta no tiene. Se arma a mano: solo la
 * primera letra en mayúscula, sin coma.
 */
function formatDateDisplay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const dia = d.toLocaleDateString('es-MX', { weekday: 'long' });
  const resto = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${resto}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdministrarView({
  date,
  timezone,
  dayRevenue,
  rail,
  equipo,
  panel,
}: {
  date: string;
  timezone: string;
  dayRevenue: DayRevenue;
  /** El riel ya resuelto por `lib/diaRailData` (ahí vive el reloj). */
  rail: DiaRailData;
  equipo: EquipoSemanaData;
  /** La configuración y lo del día sin resolver (DashboardLayout). */
  panel: React.ReactNode;
}): React.ReactElement {
  const prevDate = offsetDay(date, -1);
  const nextDate = offsetDay(date, +1);
  const esHoy = isTodayInTz(date, timezone);

  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-4 pt-5">

        {/* ── Encabezado: qué día se está operando ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Administrar</p>
            <p className="mt-0.5 truncate text-[15px] font-semibold text-ink">
              {formatDateDisplay(date)}
            </p>
            {!esHoy && (
              <Link
                href={`/dashboard?date=${todayStrInTz(timezone)}`}
                className="text-[11px] font-medium text-teal-ink underline"
              >
                Ir a hoy
              </Link>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/dashboard?date=${prevDate}`}
              aria-label="Día anterior"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line-2 text-base text-ink-2 hover:bg-canvas"
            >
              ‹
            </Link>
            <Link
              href={`/dashboard?date=${nextDate}`}
              aria-label="Día siguiente"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line-2 text-base text-ink-2 hover:bg-canvas"
            >
              ›
            </Link>
          </div>
        </div>

        {/* ── El héroe: el día como riel ── */}
        <DiaRail
          rail={rail}
          revenue={dayRevenue.total}
          currency={dayRevenue.currency}
          vacioEsHoy={esHoy}
        />

        {/* ── El equipo de la semana que contiene este día ── */}
        <EquipoSemana data={equipo} />
      </div>

      {/* ── Lo del día sin resolver, el cuadre, las solicitudes y la configuración ── */}
      {panel}
    </div>
  );
}
