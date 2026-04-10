'use client';

// ─── BotConversionCard ─────────────────────────────────────────────────────────
// Donut gauge 76px con porcentaje de conversión del bot.
// ≥60% → verde, ≥45% → acento, <45% → rojo.

export type BotConversionCardProps = {
  readonly chats: number;
  readonly booked: number;
};

export function BotConversionCard({ chats, booked }: BotConversionCardProps) {
  const pct           = chats > 0 ? Math.round((booked / chats) * 100) : 0;
  const r             = 30;
  const cx            = 38;
  const cy            = 38;
  const circumference = 2 * Math.PI * r;
  const filled        = (pct / 100) * circumference;

  const color =
    pct >= 60 ? 'var(--an-grn)' : pct >= 45 ? 'var(--an-ac)' : 'var(--an-red)';

  const nota =
    pct >= 60
      ? 'Convirtiendo correctamente'
      : 'Revisa el mensaje de bienvenida del bot';

  return (
    <div
      style={{
        backgroundColor: 'var(--an-card)',
        borderRadius: '10px',
        border: '1px solid var(--an-br)',
        padding: '1rem 1.125rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
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
        Conversión del bot
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Donut */}
        <svg width="76" height="76" viewBox="0 0 76 76" style={{ flexShrink: 0 }}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--an-surf)"
            strokeWidth="8"
          />
          {chats > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeDasharray={`${filled} ${circumference - filled}`}
              strokeDashoffset={circumference * 0.25}
              strokeLinecap="round"
            />
          )}
          <text
            x={cx}
            y={cy - 3}
            textAnchor="middle"
            fontSize="15"
            fontWeight="500"
            fill="var(--an-t1)"
            style={{ fontFamily: 'inherit' }}
          >
            {pct}%
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            fontSize="8"
            fontWeight="400"
            fill="var(--an-t3)"
            letterSpacing="0.05em"
            style={{ fontFamily: 'inherit' }}
          >
            CONV.
          </text>
        </svg>

        {/* Texto */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--an-t2)', lineHeight: 1.4 }}>
            {booked} citas agendadas de {chats} conversaciones
          </p>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '11px',
              color: pct >= 60 ? 'var(--an-grn)' : pct >= 45 ? 'var(--an-ac)' : 'var(--an-red)',
              lineHeight: 1.4,
            }}
          >
            {nota}
          </p>
        </div>
      </div>
    </div>
  );
}
