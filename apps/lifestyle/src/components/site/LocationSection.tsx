// ─── Location Section ─────────────────────────────────────────────────────────
// Bloque clickeable completo (no solo un link de texto).
// SVG pin inline, no emoji. Dirección en display font.
// Server Component.

import { RevealObserver } from './RevealObserver';

type LocationSectionProps = {
  address: string;
};

export function LocationSection({ address }: LocationSectionProps) {
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(address)}`;

  return (
    <section
      id="ubicacion"
      className="site-section-full"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <div className="site-section-inner">
        <RevealObserver />

        <div className="reveal">
          <p className="site-section-label">Donde estamos</p>
          <h2 className="site-section-title">Ubicacion</h2>
        </div>

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="location-block reveal reveal-delay-1"
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}
          >
            <PinIcon />
            <span className="location-block__address">{address}</span>
          </span>

          <span className="location-block__cta">
            Ver en Google Maps
            <ArrowIcon />
          </span>
        </a>
      </div>
    </section>
  );
}

function PinIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '0.2em' }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}
