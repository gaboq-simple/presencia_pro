'use client';

// ─── Error boundary global ────────────────────────────────────────────────────
// Captura errores no manejados en cualquier ruta sin error boundary propio.
// Muestra mensaje amigable sin información técnica.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Loguear para Vercel Dashboard → Logs. No exponer al usuario.
    console.error('[error-boundary:global]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
      <div className="text-center max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Algo salió mal</h1>
        <p className="text-zinc-400 text-sm leading-relaxed">
          Ocurrió un error inesperado. Si el problema persiste,{' '}
          <a
            href={`mailto:contacto@zentriq.mx?subject=Error%20presenciapro${error.digest ? `%20${error.digest}` : ''}`}
            className="underline hover:text-zinc-200"
          >
            escríbenos a contacto@zentriq.mx
          </a>.
        </p>
        <button
          onClick={reset}
          className="mt-2 px-6 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium transition-colors"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
