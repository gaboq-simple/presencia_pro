'use client';

// ─── Error boundary — Mini-sitio público [slug] ───────────────────────────────
// Captura errores en la página pública del negocio.
// Usa estilos inline autónomos — las CSS vars de paleta no están disponibles
// en el momento del error (las inyecta la propia página).

import { useEffect } from 'react';

export default function SlugError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error-boundary:slug]', error.digest ?? error.message);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        color: '#f5f5f5',
        padding: '1.5rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: '20rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          No pudimos cargar esta página
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'rgba(245,245,245,0.6)', lineHeight: 1.6 }}>
          Ocurrió un error al cargar el sitio. Intenta recargar la página.
        </p>
        <p style={{ fontSize: '0.75rem', color: 'rgba(245,245,245,0.4)', lineHeight: 1.6, marginTop: '0.5rem' }}>
          Si el problema persiste,{' '}
          <a
            href={`mailto:contacto@zentriq.mx?subject=Error%20presenciapro${error.digest ? `%20${error.digest}` : ''}`}
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            escríbenos a contacto@zentriq.mx
          </a>.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '1.25rem',
            padding: '0.5rem 1.5rem',
            borderRadius: '0.5rem',
            border: 'none',
            backgroundColor: '#27272a',
            color: '#f5f5f5',
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
