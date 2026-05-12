import type { NextConfig } from 'next';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// El shell puede heredar vars vacías que sobreescriben .env.local.
// Next.js no hace override de vars ya definidas en el proceso, así
// que lo hacemos aquí manualmente.
const envLocalPath = resolve(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Supabase Storage — logos y cover images de cada negocio.
        // Reemplazar con el hostname exacto del proyecto en producción.
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Placeholder images para datos de prueba en desarrollo.
        protocol: 'https',
        hostname: 'placehold.co',
      },
    ],
  },
};

export default nextConfig;
