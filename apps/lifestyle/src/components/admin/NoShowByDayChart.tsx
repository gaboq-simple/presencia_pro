// ─── NoShowByDayChart ─────────────────────────────────────────────────────────
// Visualiza la tasa de no-show por día de semana (lunes a sábado).
// CSS puro — sin librerías de charts.
// Solo renderiza para períodos 'week' y 'month'.

import type { NoShowByDayEntry, MetricsPeriod } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  noshowByDay: Record<number, NoShowByDayEntry>;
  period: MetricsPeriod;
};

// ─── Config ───────────────────────────────────────────────────────────────────

// JS getDay(): 0=dom, 1=lun … 6=sáb
// Mostramos lunes a sábado (1–6)
const DAYS: { key: number; label: string }[] = [
  { key: 1, label: 'Lun' },
  { key: 2, label: 'Mar' },
  { key: 3, label: 'Mie' },
  { key: 4, label: 'Jue' },
  { key: 5, label: 'Vie' },
  { key: 6, label: 'Sab' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoShowByDayChart({ noshowByDay, period }: Props) {
  if (period === 'day') return null;

  // Calcular tasa por día
  const rows = DAYS.map(({ key, label }) => {
    const entry = noshowByDay[key];
    const total = (entry?.no_show ?? 0) + (entry?.completed ?? 0);
    const rate = total > 0 ? Math.round(((entry?.no_show ?? 0) / total) * 100) : null;
    return { label, rate, total };
  });

  // Si no hay ningún dato aún, no mostrar el componente
  const hasData = rows.some((r) => r.total > 0);
  if (!hasData) return null;

  return (
    <div>
      <p className="mb-2 text-xs text-gray-400">No-show por dia de semana</p>
      <div className="space-y-1.5">
        {rows.map(({ label, rate }) => (
          <div key={label} className="flex items-center gap-2">
            {/* Etiqueta del día */}
            <span className="w-7 shrink-0 text-right text-xs text-gray-400">{label}</span>

            {/* Barra */}
            <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-gray-100">
              {rate !== null && rate > 0 && (
                <div
                  className={`h-full rounded-sm transition-all ${
                    rate > 20 ? 'bg-red-400' : rate < 5 ? 'bg-green-400' : 'bg-gray-400'
                  }`}
                  style={{ width: `${Math.min(rate, 100)}%` }}
                />
              )}
            </div>

            {/* Porcentaje */}
            <span
              className={`w-8 shrink-0 text-right text-xs font-medium tabular-nums ${
                rate === null
                  ? 'text-gray-300'
                  : rate > 20
                  ? 'text-red-600'
                  : rate < 5
                  ? 'text-green-600'
                  : 'text-gray-500'
              }`}
            >
              {rate !== null ? `${rate}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
