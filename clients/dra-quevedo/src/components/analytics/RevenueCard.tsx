'use client';

// ─── RevenueCard ───────────────────────────────────────────────────────────────
// Card de ingresos estimados con barra de progreso hacia meta y mini-sparkline.
// Valor: 26px peso 500. Barra de progreso 5px, fill acento.

export type RevenueCardProps = {
  readonly value: string;
  readonly breakdown: string;
  readonly achieved: number;
  readonly goal: number;
  readonly trend: number[];
};

export function RevenueCard({ value, breakdown, achieved, goal, trend }: RevenueCardProps) {
  const pct  = goal > 0 ? Math.min(100, Math.round((achieved / goal) * 100)) : 0;
  const maxT = Math.max(...trend, 1);
  const tHeights = trend.map((v) => Math.max(3, Math.round((v / maxT) * 22)));
  const lastIdx  = trend.length - 1;

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '10px',
          fontWeight: 400,
          color: 'var(--an-t3)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          lineHeight: 1,
        }}
      >
        Ingresos estimados
      </p>

      {/* Valor */}
      <p
        style={{
          margin: 0,
          fontSize: '26px',
          fontWeight: 500,
          color: 'var(--an-t1)',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>

      {/* Breakdown */}
      <p style={{ margin: 0, fontSize: '11px', color: 'var(--an-t3)' }}>
        {breakdown}
      </p>

      {/* Barra de progreso */}
      <div>
        <div
          style={{
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '4px',
          }}
        >
          <p style={{ margin: 0, fontSize: '10px', color: 'var(--an-t3)' }}>
            {pct}% de la meta
          </p>
          <p style={{ margin: 0, fontSize: '10px', color: 'var(--an-t3)' }}>
            {value} / {goal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Mini sparkline */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '22px',
          marginTop: '4px',
        }}
      >
        {tHeights.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h}px`,
              backgroundColor: i === lastIdx ? 'var(--an-ac)' : 'var(--an-surf2)',
              borderRadius: '1px 1px 0 0',
            }}
          />
        ))}
      </div>
    </div>
  );
}
