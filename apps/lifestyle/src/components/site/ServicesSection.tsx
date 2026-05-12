// ─── Services Section ─────────────────────────────────────────────────────────
// Lista estilizada — no grid de cards iguales.
// Cada servicio: nombre (display font) + precio prominente (accent).
// El primero tiene tratamiento destacado (featured).
// Fade-in escalonado al scroll. Server Component.

import type { SiteServiceRow } from '@/lib/dashboard.types';
import { RevealObserver } from './RevealObserver';

type ServicesSectionProps = {
  services: SiteServiceRow[];
};

function formatPrice(price: number, currency: string): React.ReactNode {
  const formatted = price.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (
    <>
      <sup>{currency}</sup>
      {formatted}
    </>
  );
}

export function ServicesSection({ services }: ServicesSectionProps) {
  if (services.length === 0) return null;

  return (
    <section
      id="servicios"
      className="site-section-full"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <div className="site-section-inner">
        <RevealObserver />

        <div className="reveal">
          <p className="site-section-label">Lo que hacemos</p>
          <h2 className="site-section-title">Servicios</h2>
        </div>

        <ul className="services-list reveal reveal-delay-1" style={{ listStyle: 'none' }}>
          {services.map((service, i) => {
            const isFeatured = i === 0;
            const delayClass = `reveal-delay-${Math.min(i + 1, 6)}`;

            return (
              <li
                key={service.id}
                className={`service-row reveal ${delayClass}${isFeatured ? ' service-row--featured' : ''}`}
              >
                <div className="service-row__left">
                  <span className="service-row__name">{service.name}</span>
                  <span className="service-row__meta">
                    {service.duration_minutes} min
                    {isFeatured && (
                      <span
                        style={{
                          marginLeft: '0.75rem',
                          color: 'var(--accent)',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Popular
                      </span>
                    )}
                  </span>
                  {service.description && (
                    <span className="service-row__desc">{service.description}</span>
                  )}
                </div>

                <div className="service-row__price">
                  {formatPrice(service.price, service.currency)}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
