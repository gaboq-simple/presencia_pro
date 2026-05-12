'use client';

// ─── ReviewConfigPanel ────────────────────────────────────────────────────────
// Client Component — configuración de solicitudes de reseña post-servicio.
//
// - Toggle: activar/desactivar solicitud automática de reseña (24h después)
// - Campo: URL de Google Reviews (visible solo si toggle activo)
// - Cada cambio hace PATCH /api/business/config de forma independiente
// - Carga estado inicial desde GET /api/business/config al montar

import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewConfig = {
  review_requests_enabled: boolean;
  review_url:              string | null;
};

type FullConfig = ReviewConfig & { [key: string]: unknown };

// ─── Helper ───────────────────────────────────────────────────────────────────

async function patchConfig(body: Partial<ReviewConfig> & Record<string, unknown>): Promise<ReviewConfig> {
  const res = await fetch('/api/business/config', {
    method:      'PATCH',
    credentials: 'same-origin',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ReviewConfig>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewConfigPanel() {
  const [config, setConfig]       = useState<ReviewConfig | null>(null);
  const [loading, setLoading]     = useState(true);
  const [urlInput, setUrlInput]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [urlError, setUrlError]   = useState<string | null>(null);
  const [saveMsg, setSaveMsg]     = useState<string | null>(null);

  // Cargar config inicial
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/business/config', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as FullConfig;
        if (!cancelled) {
          setConfig({
            review_requests_enabled: data.review_requests_enabled ?? false,
            review_url:              data.review_url ?? null,
          });
          setUrlInput(data.review_url ?? '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function toggleEnabled(value: boolean) {
    if (!config || saving) return;

    // Si activar y no hay review_url → requerir URL primero
    if (value && !config.review_url && !urlInput.trim()) {
      setUrlError('Ingresa el link de Google Reviews antes de activar');
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    try {
      const body: Partial<ReviewConfig> = { review_requests_enabled: value };
      // Si activar y hay urlInput → enviar ambos en el mismo PATCH
      if (value && urlInput.trim() && urlInput.trim() !== config.review_url) {
        body.review_url = urlInput.trim();
      }
      const updated = await patchConfig(body);
      setConfig(updated);
      if (updated.review_url) setUrlInput(updated.review_url);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function saveUrl() {
    if (!config || saving) return;

    const trimmed = urlInput.trim();

    // Validación básica de URL
    try {
      new URL(trimmed);
    } catch {
      setUrlError('Ingresa una URL válida (ej: https://g.page/r/...)');
      return;
    }

    setUrlError(null);
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await patchConfig({ review_url: trimmed });
      setConfig(updated);
      setUrlInput(updated.review_url ?? trimmed);
      setSaveMsg('Guardado');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-xs font-medium text-gray-500">Reseñas</p>
        <p className="mt-2 text-xs text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">Reseñas</p>

      <div className="mt-3 space-y-4">

        {/* Toggle reseñas automáticas */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Solicitar reseñas automáticamente
            </p>
            <p className="text-xs text-gray-400">
              El cliente recibe un mensaje 24h después de su visita
            </p>
          </div>

          <button
            role="switch"
            aria-checked={config.review_requests_enabled}
            disabled={saving}
            onClick={() => void toggleEnabled(!config.review_requests_enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
              config.review_requests_enabled ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                config.review_requests_enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Campo URL — siempre visible, requerido cuando toggle activo */}
        <div>
          <label className="block text-sm font-medium text-gray-900" htmlFor="review-url">
            Link de Google Reviews
          </label>
          <p className="text-xs text-gray-400">
            Se envía al cliente en el mensaje de solicitud de reseña
          </p>

          <div className="mt-1.5 flex gap-2">
            <input
              id="review-url"
              type="url"
              inputMode="url"
              placeholder="https://g.page/r/..."
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError(null);
              }}
              disabled={saving}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void saveUrl()}
              disabled={saving || urlInput.trim() === (config.review_url ?? '')}
              className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {saving ? '…' : 'Guardar'}
            </button>
          </div>

          {urlError && (
            <p className="mt-1 text-xs text-red-500">{urlError}</p>
          )}
          {saveMsg && !urlError && (
            <p className={`mt-1 text-xs ${saveMsg === 'Guardado' ? 'text-green-600' : 'text-red-500'}`}>
              {saveMsg}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
