// ─── HourlyPeaksChart ─────────────────────────────────────────────────────────
// Gráfica de barras CSS — distribución de citas por hora (8h-20h).
// Sin librerías externas — puro CSS/Tailwind.
//
// Diseño:
//   - 13 columnas (8h → 20h inclusive)
//   - Cada barra escala al máximo del conjunto (altura relativa)
//   - Etiqueta de hora abajo, valor encima si es > 0
//   - Mínimo de barra visible: 2px para que horas con 1 cita sean visibles

'use client';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  hourly: Record<number, number>;  // hora (0-23) → nº de citas
};

// ─── Config ───────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);  // 8 … 20
const BAR_MAX_HEIGHT = 48;  // px — alto máximo de barra
const BAR_MIN_HEIGHT = 2;   // px — mínimo visible cuando count > 0

// ─── Component ────────────────────────────────────────────────────────────────

export default function HourlyPeaksChart({ hourly }: Props) {
  const maxCount = Math.max(1, ...HOURS.map((h) => hourly[h] ?? 0));

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-500">Picos por hora</p>
      <div className="flex items-end gap-0.5" style={{ height: `${BAR_MAX_HEIGHT + 16}px` }}>
        {HOURS.map((hour) => {
          const count = hourly[hour] ?? 0;
          const heightPx =
            count === 0
              ? 0
              : Math.max(BAR_MIN_HEIGHT, Math.round((count / maxCount) * BAR_MAX_HEIGHT));

          return (
            <div
              key={hour}
              className="relative flex flex-1 flex-col items-center justify-end"
              style={{ height: `${BAR_MAX_HEIGHT + 16}px` }}
              title={`${hour}h: ${count} cita${count !== 1 ? 's' : ''}`}
            >
              {/* Valor sobre la barra — solo si hay citas */}
              {count > 0 && (
                <span
                  className="absolute text-[9px] font-semibold text-gray-600"
                  style={{ bottom: `${heightPx + 2}px` }}
                >
                  {count}
                </span>
              )}

              {/* Barra */}
              <div
                className={`w-full rounded-sm transition-all ${
                  count === 0 ? 'bg-transparent' : 'bg-gray-800'
                }`}
                style={{ height: `${heightPx}px` }}
              />

              {/* Etiqueta de hora */}
              <span className="mt-0.5 text-[8px] text-gray-400">
                {hour}h
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
