'use client';

// ─── OccupancyHeatmap ──────────────────────────────────────────────────────────
// Grid 5 días × 7 horarios con colores de ocupación.
// Datos reales de DB via getOccupancyHeatmap().
// hmLo (<60%): #F5A89A, hmMd (60–80%): #F5D78A, hmHi (>80%): #9ACFB8.
// Celdas sin datos históricos: surf2 #E8E2DA + tooltip "Sin datos históricos".

import type { HeatmapCell } from './types';

export type OccupancyHeatmapProps = {
  readonly data: readonly HeatmapCell[];
};

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const HOUR_INTS  = [9, 10, 11, 12, 14, 16, 18] as const;
const HOUR_LABELS = HOUR_INTS.map((h) => `${String(h).padStart(2, '0')}:00`);

// DOW → display index: 1=lun→0, 2=mar→1, 3=mié→2, 4=jue→3, 5=vie→4
const DOW_TO_DISPLAY: Readonly<Record<number, number>> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };

function cellColor(pct: number): string {
  if (pct >= 80) return 'var(--an-hmHi)';
  if (pct >= 60) return 'var(--an-hmMd)';
  return 'var(--an-hmLo)';
}

/** Devuelve la recomendación dinámica basada en el cellMap procesado. */
function buildRecommendation(cellMap: ReadonlyMap<string, number>): string {
  if (cellMap.size === 0) return '';

  let maxKey = '';
  let maxPct = -1;
  let minKey = '';
  let minPct = 101;

  for (const [key, pct] of cellMap) {
    if (pct > maxPct) { maxPct = pct; maxKey = key; }
    if (pct < minPct) { minPct = pct; minKey = key; }
  }

  if (!maxKey || !minKey) return '';

  const parseKey = (k: string): [number, number] => {
    const sep = k.indexOf(':');
    return [parseInt(k.slice(0, sep), 10), parseInt(k.slice(sep + 1), 10)];
  };

  const [maxDay, maxHour] = parseKey(maxKey);
  const [minDay, minHour] = parseKey(minKey);

  const dayLabel  = (d: number) => DAY_LABELS[d] ?? `Día ${d}`;
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    `${dayLabel(maxDay)} a las ${hourLabel(maxHour)} tiene ocupación máxima (${maxPct}%). ` +
    `Considera ${minPct < 40 ? 'cerrar' : 'abrir'} más horarios el ${dayLabel(minDay)} a las ${hourLabel(minHour)} (${minPct}% ocupado).`
  );
}

export function OccupancyHeatmap({ data }: OccupancyHeatmapProps) {
  // Transformar datos: DOW + integer hour → display index + integer hour
  // La clave en cellMap es `${displayIdx}:${hourInt}`
  const cellMap = new Map<string, number>();
  for (const cell of data) {
    const displayIdx = DOW_TO_DISPLAY[cell.day];
    if (displayIdx === undefined) continue; // saltar fines de semana
    cellMap.set(`${displayIdx}:${cell.hour}`, cell.pct);
  }

  const recommendation = buildRecommendation(cellMap);

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--an-t1)',
            letterSpacing: '-0.01em',
          }}
        >
          Ocupación por horario
        </p>
        {/* Leyenda */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {[
            { label: 'Bajo', color: 'var(--an-hmLo)' },
            { label: 'Medio', color: 'var(--an-hmMd)' },
            { label: 'Alto', color: 'var(--an-hmHi)' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '10px', color: 'var(--an-t3)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '3px', width: '100%' }}>
          <thead>
            <tr>
              <th
                style={{
                  width: '40px',
                  fontSize: '10px',
                  color: 'var(--an-t3)',
                  fontWeight: 400,
                  textAlign: 'left',
                  paddingBottom: '4px',
                }}
              />
              {DAY_LABELS.map((day) => (
                <th
                  key={day}
                  style={{
                    fontSize: '10px',
                    color: 'var(--an-t3)',
                    fontWeight: 400,
                    textAlign: 'center',
                    paddingBottom: '4px',
                    letterSpacing: '0.03em',
                  }}
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOUR_INTS.map((hourInt, rowIdx) => (
              <tr key={hourInt}>
                <td
                  style={{
                    fontSize: '10px',
                    color: 'var(--an-t3)',
                    fontWeight: 400,
                    paddingRight: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {HOUR_LABELS[rowIdx]}
                </td>
                {DAY_LABELS.map((dayName, dayIdx) => {
                  const key     = `${dayIdx}:${hourInt}`;
                  const hasData = cellMap.has(key);
                  const pct     = cellMap.get(key) ?? 0;
                  const tooltip = hasData
                    ? `${dayName} ${HOUR_LABELS[rowIdx]} — ${pct}% ocupado`
                    : `${dayName} ${HOUR_LABELS[rowIdx]} — Sin datos históricos`;
                  return (
                    <td key={dayIdx} style={{ padding: 0 }}>
                      <div
                        title={tooltip}
                        style={{
                          height: '22px',
                          borderRadius: '4px',
                          backgroundColor: hasData ? cellColor(pct) : 'var(--an-surf2)',
                          cursor: 'default',
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recomendación */}
      {recommendation && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 10px',
            backgroundColor: 'var(--an-acL)',
            border: '1px solid var(--an-br)',
            borderRadius: '6px',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              color: 'var(--an-acD)',
              lineHeight: 1.5,
            }}
          >
            {recommendation}
          </p>
        </div>
      )}
    </div>
  );
}
