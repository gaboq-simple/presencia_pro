// ─── Hours Section ────────────────────────────────────────────────────────────
// Lista estilizada (no <table>). Separadores decorativos, dot indicator hoy.
// Día actual destacado en accent. Server Component.

import type { OfficeHours } from '@/lib/dashboard.types';
import { RevealObserver } from './RevealObserver';

type HoursSectionProps = {
  officeHours: OfficeHours;
};

const DAY_LABELS: Record<string, string> = {
  '0': 'Domingo',
  '1': 'Lunes',
  '2': 'Martes',
  '3': 'Miercoles',
  '4': 'Jueves',
  '5': 'Viernes',
  '6': 'Sabado',
};

// Día actual en México (UTC-6 CST).
function getTodayDayOfWeek(): number {
  const now = new Date();
  const mexicoOffset = -6 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const mexicoMs = utcMs + mexicoOffset * 60_000;
  return new Date(mexicoMs).getDay();
}

export function HoursSection({ officeHours }: HoursSectionProps) {
  const isEmpty = Object.keys(officeHours).length === 0;
  const todayDow = getTodayDayOfWeek();

  return (
    <section id="horarios" className="site-section">
      <RevealObserver />

      <div className="reveal">
        <p className="site-section-label">Cuando nos encuentras</p>
        <h2 className="site-section-title">Horarios</h2>
      </div>

      {isEmpty ? (
        <p
          className="reveal reveal-delay-1"
          style={{
            marginTop: '2rem',
            color: 'var(--muted)',
            fontSize: '1rem',
            lineHeight: 1.6,
          }}
        >
          Contactanos para conocer nuestros horarios.
        </p>
      ) : (
        <ul className="hours-list reveal reveal-delay-1" style={{ listStyle: 'none' }}>
          {(['1', '2', '3', '4', '5', '6', '0'] as const).map((dow) => {
            const slot = officeHours[dow];
            if (!slot) return null;

            const isToday = Number(dow) === todayDow;

            return (
              <li
                key={dow}
                className={`hours-row${isToday ? ' hours-row--today' : ''}`}
              >
                <span className="hours-row__day">
                  <span className="hours-row__dot" aria-hidden />
                  {DAY_LABELS[dow]}
                  {isToday && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--accent)',
                        opacity: 0.75,
                      }}
                    >
                      hoy
                    </span>
                  )}
                </span>
                <span className="hours-row__time">
                  {slot.start} – {slot.end}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
