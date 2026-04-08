import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { clientConfig } from '@/config/client.config';
import './globals.css';

// ─── Fonts ────────────────────────────────────────────────────────────────────
// Next.js font imports deben ser estáticos. clientConfig.design.fonts documenta
// qué fuentes se usan — estas importaciones las implementan.

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-playfair',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

// ─── Metadata ─────────────────────────────────────────────────────────────────

const siteUrl = `https://${clientConfig.client.domain}`;

export const metadata: Metadata = {
  title: clientConfig.seo.title,
  description: clientConfig.seo.description,
  keywords: clientConfig.seo.keywords,
  robots: { index: true, follow: true },
  openGraph: {
    title: clientConfig.seo.title,
    description: clientConfig.seo.description,
    url: siteUrl,
    siteName: clientConfig.client.name,
    locale: clientConfig.client.locale.replace('-', '_'),
    type: 'website',
    ...(clientConfig.seo.ogImage
      ? { images: [{ url: `${siteUrl}${clientConfig.seo.ogImage}` }] }
      : {}),
  },
};

// ─── Schema.org JSON-LD ───────────────────────────────────────────────────────
// MedicalBusiness: mejora SEO local y puede activar rich results en Google.
// Construido completamente desde clientConfig — cero datos hardcodeados.

function buildJsonLd(): string {
  const specialist = clientConfig.specialists[0]!;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: clientConfig.client.name,
    description: clientConfig.seo.description,
    url: siteUrl,
    telephone: `+${clientConfig.contact.whatsapp}`,
    medicalSpecialty: clientConfig.client.specialty,
    areaServed: clientConfig.serviceModes.domicilio.availableZones.map((zone) => ({
      '@type': 'City',
      name: zone,
    })),
    address: {
      '@type': 'PostalAddress',
      addressLocality: clientConfig.serviceModes.consultorio.address,
      addressCountry: 'MX',
    },
    image: specialist.photo ? `${siteUrl}${specialist.photo}` : undefined,
    ...(clientConfig.serviceModes.consultorio.googleMapsUrl
      ? { hasMap: clientConfig.serviceModes.consultorio.googleMapsUrl }
      : {}),
  });
}

// ─── Design tokens ────────────────────────────────────────────────────────────
// Inyecta los colores del cliente como CSS custom properties.
// Sobreescriben los defaults del @theme en globals.css en tiempo de ejecución,
// haciendo la landing completamente config-driven para cualquier cliente.

function buildDesignTokensCss(): string {
  const c = clientConfig.design.colors;
  return `
    :root {
      --color-canvas:    ${c.background};
      --color-surface:   ${c.surface};
      --color-border:    ${c.border};
      --color-ink:       ${c.text};
      --color-ink-muted: ${c.textMuted};
      --color-accent:    ${c.primary};
      --color-accent-lg: ${c.primaryLight};
      --color-accent-dk: ${c.primaryDark};
      --color-accent-fg: ${c.white};
    }
  `.trim();
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang={clientConfig.client.locale}
      className={`${playfair.variable} ${inter.variable}`}
    >
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: buildDesignTokensCss() }} />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: buildJsonLd() }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
