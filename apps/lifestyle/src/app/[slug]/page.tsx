// ─── Mini-sitio público del negocio ──────────────────────────────────────────
// Server Component puro — sin hidratación de cliente.
// Objetivo LCP < 2.5s en móvil 4G: HTML completo en la primera respuesta,
// next/image para assets, cero JS bloqueante en el critical path.
//
// Paletas activas: arena (default) | obsidian | humo | cuero | bronce | blanco
// CSS vars de paleta inyectadas como <style> inline → visibles en el primer byte.
// Fuentes: next/font con variable CSS — solo se descarga la paleta activa.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// next/font — variable CSS por fuente
import { Bebas_Neue } from 'next/font/google';
import { DM_Sans } from 'next/font/google';
import { Barlow_Condensed } from 'next/font/google';
import { Inter } from 'next/font/google';
import { Playfair_Display } from 'next/font/google';
import { Lato } from 'next/font/google';
import { Cormorant_Garamond } from 'next/font/google';
import { Source_Sans_3 } from 'next/font/google';
import { Instrument_Serif } from 'next/font/google';
import { DM_Serif_Display } from 'next/font/google';
import type {
  SiteBusinessRow,
  SiteServiceRow,
  SiteStaffRow,
  SitePalette,
} from '@/lib/dashboard.types';

import { HeroSection }     from '@/components/site/HeroSection';
import { Navbar }          from '@/components/site/Navbar';
import { AboutSection }    from '@/components/site/AboutSection';
import { ServicesSection } from '@/components/site/ServicesSection';
import { TeamSection }     from '@/components/site/TeamSection';
import { HoursSection }    from '@/components/site/HoursSection';
import { LocationSection } from '@/components/site/LocationSection';
import { FinalCTA }        from '@/components/site/FinalCTA';
import { SiteFooter }      from '@/components/site/Footer';
import { StickyWhatsApp }  from '@/components/site/StickyWhatsApp';

import './site.css';

// ─── Font declarations ────────────────────────────────────────────────────────
// Todas las fuentes tienen variable CSS. Solo se descarga la que se aplica
// como clase al wrapper. El navegador no solicita fuentes no referenciadas.

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const barlowCondensed = Barlow_Condensed({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const lato = Lato({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const cormorantGaramond = Cormorant_Garamond({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const dmSerifDisplay = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

// ─── Paletas ──────────────────────────────────────────────────────────────────

type PaletteConfig = {
  bg: string;
  text: string;
  accent: string;
  muted: string;
  surface: string;
  border: string;
  displayClass: string;
  bodyClass: string;
};

const PALETTES: Record<SitePalette, PaletteConfig> = {
  arena: {
    bg: '#F5EFE6', text: '#2C1A0E', accent: '#C4622D',
    muted: 'rgba(44,26,14,0.5)', surface: '#EDE5D8',
    border: 'rgba(44,26,14,0.1)',
    displayClass: dmSerifDisplay.variable,
    bodyClass: dmSans.variable,
  },
  obsidian: {
    bg: '#0A0A0A', text: '#F5F5F5', accent: '#C9A84C',
    muted: 'rgba(245,245,245,0.5)', surface: '#141414',
    border: 'rgba(245,245,245,0.1)',
    displayClass: bebasNeue.variable,
    bodyClass: dmSans.variable,
  },
  humo: {
    bg: '#1C1C1E', text: '#E8E8E8', accent: '#5B8DB8',
    muted: 'rgba(232,232,232,0.5)', surface: '#252527',
    border: 'rgba(232,232,232,0.1)',
    displayClass: barlowCondensed.variable,
    bodyClass: inter.variable,
  },
  cuero: {
    bg: '#2C1810', text: '#F2E8DC', accent: '#C4784A',
    muted: 'rgba(242,232,220,0.5)', surface: '#3A2318',
    border: 'rgba(242,232,220,0.1)',
    displayClass: playfairDisplay.variable,
    bodyClass: lato.variable,
  },
  bronce: {
    bg: '#1A2318', text: '#E8E4DC', accent: '#9B7D4A',
    muted: 'rgba(232,228,220,0.5)', surface: '#232E20',
    border: 'rgba(232,228,220,0.1)',
    displayClass: cormorantGaramond.variable,
    bodyClass: sourceSans3.variable,
  },
  blanco: {
    bg: '#FAFAF8', text: '#111111', accent: '#2D2D2D',
    muted: 'rgba(17,17,17,0.5)', surface: '#F0F0EE',
    border: 'rgba(17,17,17,0.1)',
    displayClass: instrumentSerif.variable,
    bodyClass: dmSans.variable,
  },
};

// ─── DB client ────────────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key);
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getBusinessBySlug(slug: string): Promise<SiteBusinessRow | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('businesses')
    .select(`
      id, name, slug, whatsapp_number,
      logo_url, cover_image_url, description, address,
      palette, tagline, office_hours,
      instagram_url, tiktok_url,
      whatsapp_message
    `)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error(`getBusinessBySlug failed: ${error.message}`);
  return data as SiteBusinessRow | null;
}

async function getActiveServices(businessId: string): Promise<SiteServiceRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('services')
    .select('id, name, description, duration_minutes, price, currency')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  if (error) throw new Error(`getActiveServices failed: ${error.message}`);
  return (data ?? []) as SiteServiceRow[];
}

async function getActiveStaff(businessId: string): Promise<SiteStaffRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, active, photo_url')
    .eq('business_id', businessId)
    .eq('active', true)
    .in('role', ['barber', 'assistant'])
    .order('name');

  if (error) throw new Error(`getActiveStaff failed: ${error.message}`);
  return (data ?? []) as SiteStaffRow[];
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);

  if (!business) return { title: 'Negocio no encontrado' };

  const description =
    business.tagline ??
    business.description ??
    `Agenda tu cita en ${business.name}.`;

  return {
    title: business.name,
    description,
    openGraph: {
      title: business.name,
      description,
      ...(business.cover_image_url && {
        images: [{ url: business.cover_image_url, width: 1200, height: 630 }],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: business.name,
      description,
      ...(business.cover_image_url && { images: [business.cover_image_url] }),
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);

  if (!business) notFound();

  const [services, staffMembers] = await Promise.all([
    getActiveServices(business.id),
    getActiveStaff(business.id),
  ]);

  const palette = PALETTES[business.palette] ?? PALETTES.obsidian;
  const waMessage = encodeURIComponent(
    business.whatsapp_message ?? `Hola, me gustaría agendar una cita en ${business.name}.`,
  );
  const waUrl = `https://wa.me/${business.whatsapp_number}?text=${waMessage}`;

  // CSS vars de paleta inyectados inline — visibles antes de cualquier JS.
  const paletteVars = `
    :root {
      --bg: ${palette.bg};
      --text: ${palette.text};
      --accent: ${palette.accent};
      --muted: ${palette.muted};
      --surface: ${palette.surface};
      --border: ${palette.border};
    }
    html, body { background-color: var(--bg); color: var(--text); }
  `;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    description: business.description ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address,
      addressCountry: 'MX',
    },
    ...(business.cover_image_url && { image: business.cover_image_url }),
    ...(business.whatsapp_number && {
      telephone: `+${business.whatsapp_number}`,
    }),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: paletteVars }} />
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div
        className={`site-root ${palette.displayClass} ${palette.bodyClass}`}
        data-palette={business.palette}
      >
        <Navbar
          businessName={business.name}
          logoUrl={business.logo_url}
          waUrl={waUrl}
        />

        <HeroSection
          businessName={business.name}
          tagline={business.tagline}
          coverImageUrl={business.cover_image_url}
          logoUrl={business.logo_url}
          waUrl={waUrl}
        />

        <AboutSection description={business.description} />

        <ServicesSection services={services} />

        <TeamSection staffMembers={staffMembers} palette={business.palette} />

        <HoursSection officeHours={business.office_hours} />

        <LocationSection address={business.address} />

        <FinalCTA businessName={business.name} waUrl={waUrl} />

        <SiteFooter
          businessName={business.name}
          logoUrl={business.logo_url}
          address={business.address}
          instagramUrl={business.instagram_url}
          tiktokUrl={business.tiktok_url}
        />

        <StickyWhatsApp waUrl={waUrl} />
      </div>
    </>
  );
}
