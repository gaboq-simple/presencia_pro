import type { Metadata, Viewport } from 'next';
import './globals.css';

// ─── Metadata raíz ────────────────────────────────────────────────────────────
// Cada [slug] sobreescribe estos valores con generateMetadata dinámico.
// metadataBase es necesario para OG images absolutas en producción.

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://app.presenciapro.mx',
  ),
  title: {
    default: 'PresenciaPro — gestión de barbería y servicios',
    template: '%s | PresenciaPro',
  },
  description: 'Agenda tu cita en segundos. Panel de gestión para barberías y salones.',
  manifest: '/manifest.json',
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    siteName: 'PresenciaPro',
    title: 'PresenciaPro — gestión de barbería y servicios',
    description: 'Agenda tu cita en segundos. Panel de gestión para barberías y salones.',
  },
  twitter: {
    card: 'summary',
    title: 'PresenciaPro — gestión de barbería y servicios',
    description: 'Agenda tu cita en segundos. Panel de gestión para barberías y salones.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#18181b',
};

// ─── Root Layout ──────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
