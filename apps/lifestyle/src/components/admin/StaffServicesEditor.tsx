// ─── StaffServicesEditor ──────────────────────────────────────────────────────
// Client Component — edita qué servicios hace un barbero (tabla staff_services).
//
// Molde: StaffScheduleEditor — recibe el estado actual como prop (pre-cargado por
// StaffManagementPanel vía GET), lo edita en local (staged), y guarda con
// replace-all en un PATCH. Solo muestra servicios ACTIVOS del negocio.

'use client';

import { useState } from 'react';

export type ServiceOption = { id: string; name: string; price: number; currency: string };

type Props = {
  staffId:      string;
  staffName:    string;
  services:     ServiceOption[];   // servicios activos del negocio
  initialIds:   string[];          // servicios que ya hace el barbero
  onSaved:      () => void;
  onCancel:     () => void;
};

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

export default function StaffServicesEditor({
  staffId, staffName, services, initialIds, onSaved, onCancel,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/${staffId}/services`, {
        method:      'PATCH',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ service_ids: [...selected] }),
      });
      if (res.ok) {
        onSaved();
      } else {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'Error al guardar los servicios');
      }
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Servicios que hace <span className="font-medium text-gray-700">{staffName}</span>
      </p>

      {services.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
          No hay servicios activos. Crea servicios en “Catálogo de servicios” primero.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => {
            const on = selected.has(svc.id);
            return (
              <div
                key={svc.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  on ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${on ? 'text-gray-900' : 'text-gray-500'}`}>
                    {svc.name}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400 tabular-nums">
                    {formatMoney(svc.price, svc.currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(svc.id)}
                  aria-label={`${on ? 'Quitar' : 'Asignar'} ${svc.name}`}
                  aria-pressed={on}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                    on ? 'bg-gray-800' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      on ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
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
