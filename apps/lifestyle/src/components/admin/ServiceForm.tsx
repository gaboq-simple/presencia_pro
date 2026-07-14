// ─── ServiceForm ──────────────────────────────────────────────────────────────
// Client Component — formulario de crear/editar un servicio del catálogo.
//
// Molde: StaffScheduleEditor — recibe datos por prop, valida client-side (espeja
// la Zod del server), hace su propio fetch (POST si es nuevo, PATCH si edita) y
// llama onSaved(servicio) / onCancel(). Se monta dentro del modal del panel.

'use client';

import { useState } from 'react';
import type { AdminServiceRow } from '@/lib/dashboard.types';

// El servicio tal como lo devuelven las rutas (sin upcomingCount, que es del server).
export type ServiceMutationResult = Omit<AdminServiceRow, 'upcomingCount'>;

type Props = {
  /** Servicio a editar; ausente ⇒ crear uno nuevo. */
  initial?: AdminServiceRow;
  onSaved:  (service: ServiceMutationResult) => void;
  onCancel: () => void;
};

function toMoneyInput(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

export default function ServiceForm({ initial, onSaved, onCancel }: Props) {
  const isEdit = initial != null;

  const [name, setName]                 = useState(initial?.name ?? '');
  const [price, setPrice]               = useState(initial ? String(initial.price) : '');
  const [duration, setDuration]         = useState(initial ? String(initial.duration_minutes) : '');
  const [description, setDescription]   = useState(initial?.description ?? '');
  const [useRange, setUseRange]         = useState(!!(initial?.price_min != null && initial?.price_max != null));
  const [priceMin, setPriceMin]         = useState(toMoneyInput(initial?.price_min));
  const [priceMax, setPriceMax]         = useState(toMoneyInput(initial?.price_max));
  const [priceNote, setPriceNote]       = useState(initial?.price_note ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── Validación client-side (espeja schema.ts) ──────────────────────────────

  function validate(): { ok: false; msg: string } | { ok: true; body: Record<string, unknown> } {
    const trimmedName = name.trim();
    if (!trimmedName) return { ok: false, msg: 'El nombre es requerido' };
    if (trimmedName.length > 80) return { ok: false, msg: 'El nombre: máximo 80 caracteres' };

    const priceNum = Number(price);
    if (price.trim() === '' || Number.isNaN(priceNum) || priceNum < 0) {
      return { ok: false, msg: 'El precio debe ser un número ≥ 0' };
    }

    const durNum = Number(duration);
    if (duration.trim() === '' || !Number.isInteger(durNum) || durNum <= 0) {
      return { ok: false, msg: 'La duración debe ser un entero mayor a 0' };
    }

    let minVal: number | null = null;
    let maxVal: number | null = null;
    if (useRange) {
      minVal = Number(priceMin);
      maxVal = Number(priceMax);
      if (priceMin.trim() === '' || Number.isNaN(minVal) || minVal < 0 ||
          priceMax.trim() === '' || Number.isNaN(maxVal) || maxVal < 0) {
        return { ok: false, msg: 'El rango de precio requiere mínimo y máximo ≥ 0' };
      }
      if (minVal > maxVal) {
        return { ok: false, msg: 'El precio mínimo no puede ser mayor que el máximo' };
      }
    }

    const body: Record<string, unknown> = {
      name:             trimmedName,
      price:            priceNum,
      duration_minutes: durNum,
      description:      description.trim() === '' ? null : description.trim(),
      price_min:        minVal,
      price_max:        maxVal,
      price_note:       useRange && priceNote.trim() !== '' ? priceNote.trim() : null,
    };
    return { ok: true, body };
  }

  async function handleSave() {
    const v = validate();
    if (!v.ok) {
      setError(v.msg);
      return;
    }

    setSaving(true);
    setError(null);

    const url    = isEdit ? `/api/services/${initial!.id}` : '/api/services';
    const method = isEdit ? 'PATCH' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify(v.body),
      });

      if (res.ok) {
        const saved = (await res.json()) as ServiceMutationResult;
        onSaved(saved);
      } else {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'Error al guardar el servicio');
      }
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50';

  return (
    <div className="space-y-3">
      {/* Nombre */}
      <div>
        <label htmlFor="svc-name" className="block text-xs font-medium text-gray-700">Nombre</label>
        <input
          id="svc-name"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          disabled={saving}
          placeholder="Corte de cabello"
          maxLength={80}
          className={`mt-1 ${inputCls}`}
        />
      </div>

      {/* Precio + Duración */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="svc-price" className="block text-xs font-medium text-gray-700">
            Precio {useRange && <span className="text-gray-400">(base)</span>}
          </label>
          <input
            id="svc-price"
            type="number"
            inputMode="decimal"
            min={0}
            value={price}
            onChange={(e) => { setPrice(e.target.value); setError(null); }}
            disabled={saving}
            placeholder="150"
            className={`mt-1 ${inputCls} tabular-nums`}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="svc-duration" className="block text-xs font-medium text-gray-700">Duración (min)</label>
          <input
            id="svc-duration"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={duration}
            onChange={(e) => { setDuration(e.target.value); setError(null); }}
            disabled={saving}
            placeholder="30"
            className={`mt-1 ${inputCls} tabular-nums`}
          />
        </div>
      </div>

      {/* Descripción */}
      <div>
        <label htmlFor="svc-desc" className="block text-xs font-medium text-gray-700">
          Descripción <span className="text-gray-400">(opcional)</span>
        </label>
        <textarea
          id="svc-desc"
          value={description}
          onChange={(e) => { setDescription(e.target.value); setError(null); }}
          disabled={saving}
          rows={2}
          maxLength={500}
          className={`mt-1 ${inputCls} resize-none`}
        />
      </div>

      {/* Rango de precio (opcional) */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={useRange}
            onChange={() => { setUseRange((v) => !v); setError(null); }}
            disabled={saving}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-800"
          />
          <span className="text-xs font-medium text-gray-700">Usar rango de precio (“desde/hasta”)</span>
        </label>

        {useRange && (
          <div className="mt-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number" inputMode="decimal" min={0}
                value={priceMin}
                onChange={(e) => { setPriceMin(e.target.value); setError(null); }}
                disabled={saving}
                placeholder="Mín"
                className={`${inputCls} tabular-nums`}
              />
              <span className="shrink-0 text-xs text-gray-400">–</span>
              <input
                type="number" inputMode="decimal" min={0}
                value={priceMax}
                onChange={(e) => { setPriceMax(e.target.value); setError(null); }}
                disabled={saving}
                placeholder="Máx"
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <input
              type="text"
              value={priceNote}
              onChange={(e) => { setPriceNote(e.target.value); setError(null); }}
              disabled={saving}
              placeholder="Nota (opcional) — ej. según largo"
              maxLength={120}
              className={inputCls}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      {/* Acciones */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear servicio'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
