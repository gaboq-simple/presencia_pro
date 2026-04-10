'use client';

// ─── KPICard ───────────────────────────────────────────────────────────────────
// Card de KPI con label, valor, delta y sparkline de 7 barras.
// Línea top 2px en acento con opacidad 40%.
// La última barra del sparkline es el acento, el resto surf2.

export type KPICardProps = {
  readonly label: string;
  readonly value: string;
  readonly delta: string;
  readonly direction: 'up' | 'down' | 'neutral';
  readonly sparkline: number[];
};

export function KPICard({ label, value, delta, direction, sparkline }: KPICardProps) {
  const deltaColor =
    direction === 'up'
      ? 'var(--an-grn)'
      : direction === 'down'
        ? 'var(--an-red)'
        : 'var(--an-t3)';

  // Normalizar sparkline para que el máximo sea 22px de altura
  const maxVal  = Math.max(...sparkline, 1);
  const heights = sparkline.map((v) => Math.max(3, Math.round((v / maxVal) * 22)));
  const lastIdx = sparkline.length - 1;

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        overflow: 'hidden',
        padding: '1rem 1.125rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {/* Línea top */}
      <div
        style={{
          height: '2px',
          backgroundColor: 'var(--an-ac)',
          opacity: 0.4,
          borderRadius: '2px',
          marginBottom: '4px',
          marginLeft: '-1.125rem',
          marginRight: '-1.125rem',
          marginTop: '-1rem',
        }}
      />

      {/* Label */}
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
        {label}
      </p>

      {/* Valor */}
      <p
        style={{
          margin: 0,
          fontSize: '23px',
          fontWeight: 500,
          color: 'var(--an-t1)',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>

      {/* Delta + Sparkline */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginTop: '2px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '11px',
            fontWeight: 400,
            color: deltaColor,
            lineHeight: 1,
          }}
        >
          {delta}
        </p>

        {/* Sparkline */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '2px',
            height: '22px',
          }}
        >
          {heights.map((h, i) => (
            <div
              key={i}
              style={{
                width: '6px',
                height: `${h}px`,
                backgroundColor: i === lastIdx ? 'var(--an-ac)' : 'var(--an-surf2)',
                borderRadius: '1px 1px 0 0',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
