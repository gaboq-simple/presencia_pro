// ─── Footer ───────────────────────────────────────────────────────────────────
// 3 zonas en desktop: marca / dirección / redes.
// Separador superior con borde. Nombre en display font.
// Server Component.

import Image from 'next/image';

type SiteFooterProps = {
  businessName: string;
  logoUrl: string | null;
  address: string;
  instagramUrl: string | null;
  tiktokUrl: string | null;
};

export function SiteFooter({
  businessName,
  logoUrl,
  address,
  instagramUrl,
  tiktokUrl,
}: SiteFooterProps) {
  const year = new Date().getFullYear();
  const hasSocials = Boolean(instagramUrl ?? tiktokUrl);

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        {/* Columna 1: Marca */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.625rem' }}>
            {logoUrl && (
              <Image
                src={logoUrl}
                alt={businessName}
                width={28}
                height={28}
                style={{ objectFit: 'contain', height: 28, width: 'auto' }}
              />
            )}
            <p className="site-footer__brand-name">{businessName}</p>
          </div>
          <p className="site-footer__tagline">
            Agenda tu cita en minutos.
          </p>
        </div>

        {/* Columna 2: Dirección */}
        <div>
          <p className="site-footer__col-label">Ubicacion</p>
          <p className="site-footer__address-text">{address}</p>
        </div>

        {/* Columna 3: Redes */}
        {hasSocials && (
          <div>
            <p className="site-footer__col-label">Redes sociales</p>
            <div className="site-footer__socials">
              {instagramUrl && (
                <a
                  href={instagramUrl}
                  className="site-footer__social-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                >
                  <InstagramIcon />
                  Instagram
                </a>
              )}
              {tiktokUrl && (
                <a
                  href={tiktokUrl}
                  className="site-footer__social-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TikTok"
                >
                  <TikTokIcon />
                  TikTok
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Línea inferior */}
      <div className="site-footer__bottom">
        <span className="site-footer__year">
          &copy; {year} {businessName}
        </span>
        <span className="site-footer__powered">
          Creado con PresenciaPro
        </span>
      </div>
    </footer>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z" />
    </svg>
  );
}
