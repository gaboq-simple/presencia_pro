import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // El engine usa extensiones .js en imports TypeScript (convención ESM estándar).
  // resolveAliasExtensions le indica a Turbopack (Next.js 16) que .js puede ser .ts.
  // La config webpack cubre el fallback para entornos sin Turbopack stable.
  turbopack: {
    resolveAliasExtensions: {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
