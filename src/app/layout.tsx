import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { ContentSchema } from '@/lib/content.schema';
import rawContent from '@/content/content.json';
import './globals.css';

// ─── Fonts ────────────────────────────────────────────────────────────────────

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

// ─── Content validation ───────────────────────────────────────────────────────
// Guard: fail fast at build time if content.json doesn't match the schema.

const content = ContentSchema.parse(rawContent);

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: content.seo.title,
  description: content.seo.description,
  keywords: content.seo.keywords,
  openGraph: {
    title: content.seo.title,
    description: content.seo.description,
    locale: 'es_MX',
    type: 'website',
  },
};

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es-MX"
      className={`${playfair.variable} ${inter.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
