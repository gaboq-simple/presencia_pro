// ─── BarbershopPrompt ─────────────────────────────────────────────────────────
// Client Component — fallback cuando un barbero llega a /staff SIN contexto de
// negocio (sin sesión y sin slug en la URL).
//
// Pide el identificador (slug) de su barbería y navega a /[slug]/staff, donde el
// login por PIN queda scopeado al negocio correcto (MT-02). NO lista los negocios
// (eso filtraría el padrón de tenants). Si el slug no existe, /[slug]/staff
// responde con notFound() — la validación vive allá, no acá.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BarbershopPrompt() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slug = value.trim().toLowerCase();
    if (!slug) return;
    router.push(`/${encodeURIComponent(slug)}/staff`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white px-6 py-8 shadow-sm border border-gray-100">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-900">
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 4.092m0 0l.923 1.817M9.384 9.137L7.848 8.25m4.535 5.046l1.538-.887m-1.538.887a3 3 0 105.194 3 3 3 0 00-5.194-3zm1.538-.887l-2.077-4.092m0 0l-.923-1.817M14.616 14.183L16.152 15.75M14.616 14.183L12.54 10.09m0 0l.923-1.817m-1.846 0l.923 1.817"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">¿Cuál es tu barbería?</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ingresa el identificador de tu barbería para continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="mi-barberia"
            aria-label="Identificador de la barbería"
            className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-center text-base text-gray-900 focus:border-gray-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continuar
          </button>
        </form>
      </div>
    </main>
  );
}
