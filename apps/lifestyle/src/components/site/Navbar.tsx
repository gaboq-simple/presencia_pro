'use client';

// ─── Navbar ───────────────────────────────────────────────────────────────────
// Sticky. Transparente sobre el hero, sólido al hacer scroll > 60px.
// Texto adaptivo: blanco sobre imagen, --text sobre fondo sólido.
// Altura: 3.5rem — delgada y elegante.
// Client Component — necesita window.scrollY.

import { useEffect, useState } from 'react';
import Image from 'next/image';

type NavbarProps = {
  businessName: string;
  logoUrl: string | null;
  waUrl: string;
};

const NAV_LINKS = [
  { label: 'Servicios', href: '#servicios' },
  { label: 'Equipo', href: '#equipo' },
  { label: 'Horarios', href: '#horarios' },
  { label: 'Ubicacion', href: '#ubicacion' },
];

export function Navbar({ businessName, logoUrl, waUrl }: NavbarProps) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const handleScroll = () => setSolid(window.scrollY > 60);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const textClass = solid ? 'site-navbar__link--dark' : 'site-navbar__link--light';
  const brandClass = solid ? 'site-navbar__brand-name--dark' : 'site-navbar__brand-name--light';

  return (
    <nav
      className={`site-navbar ${solid ? 'site-navbar--solid' : 'site-navbar--transparent'}`}
      aria-label="Navegacion principal"
    >
      {/* Marca */}
      <a href="#inicio" className="site-navbar__brand">
        {logoUrl && (
          <Image
            src={logoUrl}
            alt={businessName}
            width={28}
            height={28}
            style={{ objectFit: 'contain', height: 28, width: 'auto' }}
          />
        )}
        <span className={`site-navbar__brand-name ${brandClass}`}>
          {businessName}
        </span>
      </a>

      {/* Links de ancla — solo desktop */}
      <ul className="site-navbar__links" role="list">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className={`site-navbar__link ${textClass}`}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>

      {/* CTA WhatsApp */}
      <a
        href={waUrl}
        className={`wa-btn site-navbar__cta${!solid ? ' wa-btn--nav-light' : ''}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Agendar
      </a>

      {/* Adaptar colores del wa-btn en navbar transparente */}
      {!solid && (
        <style>{`
          .wa-btn--nav-light {
            background-color: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.5);
            color: #ffffff;
          }
          .wa-btn--nav-light:hover {
            background-color: rgba(255,255,255,0.25);
            color: #ffffff;
          }
        `}</style>
      )}
    </nav>
  );
}
