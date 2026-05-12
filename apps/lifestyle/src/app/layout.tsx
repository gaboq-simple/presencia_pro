import type { Metadata, Viewport } from 'next';
import './globals.css';

// ─── Metadata raíz ────────────────────────────────────────────────────────────
// Cada [slug] sobreescribe estos valores con generateMetadata dinámico.

export const metadata: Metadata = {
  title: {
    default: 'PresenciaPro Lifestyle',
    template: '%s | PresenciaPro',
  },
  description: 'Agenda tu cita en segundos.',
  robots: {
    index: true,
    follow: true,
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
