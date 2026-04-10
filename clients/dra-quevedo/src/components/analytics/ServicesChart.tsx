'use client';

// ─── ServicesChart ─────────────────────────────────────────────────────────────
// Barras horizontales por servicio con label, barra de 5px, conteo y porcentaje.
// Track: surf #F2EEE8, fill: acento #C4916A.

export type ServicesChartProps = {
  readonly services: {
    readonly name: string;
    readonly count: number;
    readonly total: number;
  }[];
};

export function ServicesChart({ services }: ServicesChartProps) {
  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--an-t1)',
          letterSpacing: '-0.01em',
        }}
      >
        Servicios realizados
      </p>

      {services.length === 0 ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--an-t3)' }}>
          Sin citas completadas en el período
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {services.map(({ name, count, total }) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Label */}
                <p
                  style={{
                    margin: 0,
                    width: '126px',
                    fontSize: '12px',
                    color: 'var(--an-t2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {name}
                </p>

                {/* Track + fill */}
                <div
                  style={{
                    flex: 1,
                    height: '5px',
                    backgroundColor: 'var(--an-surf)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: 'var(--an-ac)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* Conteo */}
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--an-t1)',
                    minWidth: '20px',
                    textAlign: 'right',
                  }}
                >
                  {count}
                </p>

                {/* Porcentaje */}
                <p
                  style={{
                    margin: 0,
                    fontSize: '11px',
                    color: 'var(--an-t3)',
                    minWidth: '32px',
                    textAlign: 'right',
                  }}
                >
                  {pct}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
