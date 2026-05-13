'use client';

// ─── Error boundary — Staff ───────────────────────────────────────────────────
// Captura errores en cualquier página dentro de /staff.
// Mensaje amigable sin información técnica ni stack trace.

import { useEffect } from 'react';

export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error-boundary:staff]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-sm space-y-4">
        <h2 className="text-xl font-semibold text-zinc-100">Ocurrió un error</h2>
        <p className="text-zinc-400 text-sm leading-relaxed">
          No pudimos cargar tu agenda. Intenta de nuevo o contacta al administrador.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm font-medium text-white transition-colors"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
