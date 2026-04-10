'use client';

// ─── PatientTypeDonut ──────────────────────────────────────────────────────────
// SVG donut 88px, stroke-width 10.
// Recurrentes: #C4916A · Nuevos: #6B5E52.
// Centro: total + label "TOTAL" 9px.
// Leyenda a la derecha: dot 7px, label, valor, porcentaje.

export type PatientTypeDonutProps = {
  readonly recurring: number;
  readonly new: number;
};

export function PatientTypeDonut({ recurring, new: newPat }: PatientTypeDonutProps) {
  const total = recurring + newPat;
  const r     = 34;
  const cx    = 44;
  const cy    = 44;
  const circumference = 2 * Math.PI * r;

  // Porcentaje de recurrentes: primer arco (parte del total)
  const recurringPct  = total > 0 ? recurring / total : 0;
  const recurringDash = circumference * recurringPct;
  const newDash       = circumference * (1 - recurringPct);

  // El arco de recurrentes empieza arriba (-90°)
  // El arco de nuevos empieza donde termina el de recurrentes

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
        Tipo de pacientes
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        {/* Donut SVG */}
        <div style={{ flexShrink: 0 }}>
          <svg width="88" height="88" viewBox="0 0 88 88">
            {total === 0 ? (
              /* Estado vacío: anillo gris */
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="var(--an-surf2)"
                strokeWidth="10"
              />
            ) : (
              <>
                {/* Arco de recurrentes — terracota */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="var(--an-ac)"
                  strokeWidth="10"
                  strokeDasharray={`${recurringDash} ${circumference - recurringDash}`}
                  strokeDashoffset={circumference * 0.25}
                  strokeLinecap="butt"
                />
                {/* Arco de nuevos — t2 */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="var(--an-t2)"
                  strokeWidth="10"
                  strokeDasharray={`${newDash} ${circumference - newDash}`}
                  strokeDashoffset={circumference * 0.25 - recurringDash}
                  strokeLinecap="butt"
                />
              </>
            )}

            {/* Centro */}
            <text
              x={cx}
              y={cy - 5}
              textAnchor="middle"
              fontSize="17"
              fontWeight="500"
              fill="var(--an-t1)"
              style={{ fontFamily: 'inherit' }}
            >
              {total}
            </text>
            <text
              x={cx}
              y={cy + 9}
              textAnchor="middle"
              fontSize="9"
              fontWeight="400"
              fill="var(--an-t3)"
              letterSpacing="0.07em"
              style={{ fontFamily: 'inherit' }}
            >
              TOTAL
            </text>
          </svg>
        </div>

        {/* Leyenda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            {
              label: 'Recurrentes',
              value: recurring,
              color: 'var(--an-ac)',
            },
            {
              label: 'Nuevos',
              value: newPat,
              color: 'var(--an-t2)',
            },
          ].map(({ label, value, color }) => {
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--an-t2)', lineHeight: 1 }}>
                  {label}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--an-t1)',
                    lineHeight: 1,
                  }}
                >
                  {value}
                </p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--an-t3)', lineHeight: 1 }}>
                  {pct}%
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
