'use client';

// ─── Error boundary — Dashboard ───────────────────────────────────────────────
// Captura errores en cualquier página dentro de /dashboard.
// Mensaje amigable sin información técnica ni stack trace.

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error-boundary:dashboard]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-sm space-y-4">
        <h2 className="text-xl font-semibold text-zinc-100">Error en el dashboard</h2>
        <p className="text-zinc-400 text-sm leading-relaxed">
          No pudimos cargar esta sección. Intenta de nuevo o recarga la página.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium text-white transition-colors"
          >
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-300 transition-colors"
          >
            Recargar
          </button>
        </div>
      </div>
    </div>
  );
}
