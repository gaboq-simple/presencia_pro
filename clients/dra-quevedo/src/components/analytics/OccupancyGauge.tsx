'use client';

// ─── OccupancyGauge ────────────────────────────────────────────────────────────
// SVG donut gauge 100px.
// ≥80% → verde #5A8A3C, ≥65% → acento #C4916A, <65% → ámbar #B87A1A.

export type OccupancyGaugeProps = {
  readonly pct: number;
  readonly slots: string;
};

export function OccupancyGauge({ pct, slots }: OccupancyGaugeProps) {
  const r             = 42;
  const cx            = 50;
  const cy            = 50;
  const circumference = 2 * Math.PI * r;
  const clampedPct    = Math.min(100, Math.max(0, pct));
  const filled        = (clampedPct / 100) * circumference;

  const color =
    clampedPct >= 80
      ? 'var(--an-grn)'
      : clampedPct >= 65
        ? 'var(--an-ac)'
        : 'var(--an-amb)';

  const statusLabel =
    clampedPct >= 80 ? 'Agenda llena' : clampedPct >= 65 ? 'Buena ocupación' : 'Ocupación baja';

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--an-t1)',
          letterSpacing: '-0.01em',
          alignSelf: 'flex-start',
        }}
      >
        Ocupación
      </p>

      {/* Donut */}
      <svg width="100" height="100" viewBox="0 0 100 100">
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--an-surf)"
          strokeWidth="10"
        />
        {/* Fill */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeDashoffset={circumference * 0.25}
          strokeLinecap="round"
        />

        {/* Porcentaje */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="17"
          fontWeight="500"
          fill="var(--an-t1)"
          style={{ fontFamily: 'inherit' }}
        >
          {clampedPct}%
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fontSize="9"
          fontWeight="400"
          fill="var(--an-t3)"
          letterSpacing="0.07em"
          style={{ fontFamily: 'inherit' }}
        >
          OCUPACIÓN
        </text>
      </svg>

      {/* Status + slots */}
      <p
        style={{
          margin: 0,
          fontSize: '12px',
          fontWeight: 500,
          color: color,
          textAlign: 'center',
        }}
      >
        {statusLabel}
      </p>
      <p style={{ margin: 0, fontSize: '11px', color: 'var(--an-t3)', textAlign: 'center' }}>
        {slots}
      </p>
    </div>
  );
}
