'use client';

// ─── OccupancyHeatmap ──────────────────────────────────────────────────────────
// Grid 5 días × 7 horarios con colores de ocupación.
// TODO: conectar con query de ocupación histórica (ver CLAUDE.md — open decisions).
// Actualmente usa datos mock realistas para mostrar el componente.
// hmLo (<60%): #F5A89A, hmMd (60–80%): #F5D78A, hmHi (>80%): #9ACFB8.

import type { HeatmapCell } from './types';

export type OccupancyHeatmapProps = {
  readonly data: HeatmapCell[];
};

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const HOUR_LABELS = ['09:00', '10:00', '11:00', '12:00', '14:00', '16:00', '18:00'];

function cellColor(pct: number): string {
  if (pct >= 80) return 'var(--an-hmHi)';
  if (pct >= 60) return 'var(--an-hmMd)';
  return 'var(--an-hmLo)';
}

/** Devuelve la recomendación dinámica basada en los datos del heatmap. */
function buildRecommendation(data: HeatmapCell[]): string {
  if (data.length === 0) return '';

  const maxCell = data.reduce((a, b) => (b.pct > a.pct ? b : a), data[0]!);
  const minCell = data.reduce((a, b) => (b.pct < a.pct ? b : a), data[0]!);

  const dayOf = (d: number) => DAY_LABELS[d] ?? `Día ${d}`;

  return (
    `${dayOf(maxCell.day)} a las ${maxCell.hour} tiene ocupación máxima (${maxCell.pct}%). ` +
    `Considera ${minCell.pct < 40 ? 'cerrar' : 'abrir'} más horarios el ${dayOf(minCell.day)} a las ${minCell.hour} (${minCell.pct}% ocupado).`
  );
}

export function OccupancyHeatmap({ data }: OccupancyHeatmapProps) {
  const recommendation = buildRecommendation(data);

  // Indexar por [day][hour] para lookup eficiente
  const cellMap = new Map<string, number>();
  for (const cell of data) {
    cellMap.set(`${cell.day}:${cell.hour}`, cell.pct);
  }

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
            {HOUR_LABELS.map((hour) => (
              <tr key={hour}>
                <td
                  style={{
                    fontSize: '10px',
                    color: 'var(--an-t3)',
                    fontWeight: 400,
                    paddingRight: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hour}
                </td>
                {DAY_LABELS.map((_, dayIdx) => {
                  const pct = cellMap.get(`${dayIdx}:${hour}`) ?? 0;
                  const dayName = DAY_LABELS[dayIdx] ?? '';
                  return (
                    <td key={dayIdx} style={{ padding: 0 }}>
                      <div
                        title={`${dayName} ${hour} — ${pct}% ocupado`}
                        style={{
                          height: '22px',
                          borderRadius: '4px',
                          backgroundColor: pct > 0 ? cellColor(pct) : 'var(--an-surf)',
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
