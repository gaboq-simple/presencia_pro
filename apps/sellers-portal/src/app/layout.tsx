import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'PresenciaPro — Portal de vendedores',
  description: 'Portal interno para vendedores de PresenciaPro',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${inter.variable} min-h-screen bg-gray-50 font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
