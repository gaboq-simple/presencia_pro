'use client';

// ─── ReportsConfigPanel ───────────────────────────────────────────────────────
// Client Component — configuración de reportes semanales por WhatsApp.
//
// - Toggle: activar/desactivar reporte semanal
// - Campo: número de WhatsApp para recibir el reporte
// - Cada cambio hace PATCH /api/business/config de forma independiente
// - Carga estado inicial desde GET /api/business/config al montar

import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfigData = {
  report_enabled:  boolean;
  report_whatsapp: string | null;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

async function patchConfig(body: Partial<ConfigData>): Promise<ConfigData> {
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
  return res.json() as Promise<ConfigData>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportsConfigPanel() {
  const [config, setConfig]         = useState<ConfigData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const [saving, setSaving]         = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg]       = useState<string | null>(null);

  // Cargar config inicial
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/business/config', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as ConfigData;
        if (!cancelled) {
          setConfig(data);
          setPhoneInput(data.report_whatsapp ?? '');
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
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await patchConfig({ report_enabled: value });
      setConfig(updated);
    } catch {
      // silencioso — el toggle se revierte visualmente al no actualizar config
    } finally {
      setSaving(false);
    }
  }

  async function savePhone() {
    if (!config || saving) return;

    // Validar formato — 10 a 13 dígitos numéricos
    const clean = phoneInput.replace(/\D/g, '');
    if (clean.length < 10 || clean.length > 13) {
      setPhoneError('Debe tener entre 10 y 13 dígitos numéricos');
      return;
    }

    setPhoneError(null);
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await patchConfig({ report_whatsapp: clean });
      setConfig(updated);
      setPhoneInput(clean);
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
        <p className="text-xs font-medium text-gray-500">Reportes</p>
        <p className="mt-2 text-xs text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">Reportes</p>

      <div className="mt-3 space-y-4">

        {/* Toggle reporte semanal */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Reporte semanal por WhatsApp
            </p>
            <p className="text-xs text-gray-400">
              El reporte llega cada lunes a las 10am
            </p>
          </div>

          {/* Toggle switch */}
          <button
            role="switch"
            aria-checked={config.report_enabled}
            disabled={saving}
            onClick={() => void toggleEnabled(!config.report_enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
              config.report_enabled ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                config.report_enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Campo número para reportes */}
        <div>
          <label className="block text-sm font-medium text-gray-900" htmlFor="report-phone">
            Número para reportes
          </label>
          <p className="text-xs text-gray-400">Formato: +52 55 XXXX XXXX (sin espacios ni +)</p>

          <div className="mt-1.5 flex gap-2">
            <input
              id="report-phone"
              type="tel"
              inputMode="numeric"
              placeholder="5215512345678"
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setPhoneError(null);
              }}
              disabled={saving}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void savePhone()}
              disabled={saving || phoneInput === (config.report_whatsapp ?? '')}
              className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {saving ? '…' : 'Guardar'}
            </button>
          </div>

          {phoneError && (
            <p className="mt-1 text-xs text-red-500">{phoneError}</p>
          )}
          {saveMsg && !phoneError && (
            <p className={`mt-1 text-xs ${saveMsg === 'Guardado' ? 'text-green-600' : 'text-red-500'}`}>
              {saveMsg}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
