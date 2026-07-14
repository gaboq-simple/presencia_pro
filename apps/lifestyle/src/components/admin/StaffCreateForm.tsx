// ─── StaffCreateForm ──────────────────────────────────────────────────────────
// Client Component — alta de un miembro del staff nuevo (caso principal: barbero).
//
// Molde: ServiceForm (Paso 1) — valida client-side, hace su propio POST y llama
// onCreated(staff) / onCancel(). Se monta dentro del modal del panel. El PIN NO se
// pide: lo genera el servidor y viene en la respuesta (el panel lo muestra al dueño).

'use client';

import { useState } from 'react';
import type { ServiceOption } from './StaffServicesEditor';

export type StaffCreateResult = {
  id: string;
  name: string;
  role: string;
  phone: string;
  whatsapp_id: string;
  photo_url: string | null;
  active: boolean;
  pin: string | null;
};

type Props = {
  onCreated: (staff: StaffCreateResult) => void;
  onCancel:  () => void;
  /** Servicios activos del negocio — para elegir qué hace el barbero al darlo de alta. */
  services:  ServiceOption[];
};

type Role = 'barber' | 'assistant' | 'admin';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'barber',    label: 'Barbero' },
  { value: 'assistant', label: 'Asistente' },
  { value: 'admin',     label: 'Admin' },
];

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

export default function StaffCreateForm({ onCreated, onCancel, services }: Props) {
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole]   = useState<Role>('barber');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // 'barber' exige ≥1 servicio. Sin servicios activos en el negocio, no se puede dar
  // de alta un barbero (no hay nada que mapear) → mensaje claro, botón bloqueado.
  const noServicesForBarber = role === 'barber' && services.length === 0;

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { setError('El nombre es requerido'); return; }
    if (trimmedName.length > 80) { setError('El nombre: máximo 80 caracteres'); return; }

    // 'barber' necesita al menos un servicio (regla del backend, espejada acá).
    if (role === 'barber' && selected.size === 0) {
      setError('Seleccioná al menos un servicio que haga el barbero.');
      return;
    }

    // El teléfono es opcional. Si se da, se usa también como whatsapp_id para que
    // el barbero reciba notificaciones (mismo criterio que el script de onboarding).
    const cleanPhone = phone.replace(/[^\d]/g, '');

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/staff', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name:        trimmedName,
          role,
          phone:       cleanPhone === '' ? null : cleanPhone,
          whatsapp_id: cleanPhone === '' ? null : cleanPhone,
          service_ids: [...selected],
        }),
      });

      if (res.ok) {
        const saved = (await res.json()) as StaffCreateResult;
        onCreated(saved);
      } else {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'Error al crear el miembro del staff');
      }
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50';

  return (
    <div className="space-y-3">
      {/* Nombre */}
      <div>
        <label htmlFor="staff-name" className="block text-xs font-medium text-gray-700">Nombre</label>
        <input
          id="staff-name"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          disabled={saving}
          placeholder="Ej. Miguel Ángel"
          maxLength={80}
          className={`mt-1 ${inputCls}`}
        />
      </div>

      {/* Teléfono */}
      <div>
        <label htmlFor="staff-phone" className="block text-xs font-medium text-gray-700">
          Teléfono <span className="text-gray-400">(opcional)</span>
        </label>
        <input
          id="staff-phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setError(null); }}
          disabled={saving}
          placeholder="5215512345678"
          className={`mt-1 ${inputCls} tabular-nums`}
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Si tiene WhatsApp propio, úsalo aquí — recibirá avisos de sus citas.
        </p>
      </div>

      {/* Rol */}
      <div>
        <label htmlFor="staff-role" className="block text-xs font-medium text-gray-700">Rol</label>
        <select
          id="staff-role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={saving}
          className={`mt-1 ${inputCls}`}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-400">
          Los barberos entran con su PIN. El asistente/admin entra con su enlace de acceso.
        </p>
      </div>

      {/* Servicios que hace — obligatorio ≥1 para barbero, opcional para el resto */}
      <div>
        <label className="block text-xs font-medium text-gray-700">
          Servicios que hace{' '}
          {role === 'barber'
            ? <span className="text-gray-400">(obligatorio)</span>
            : <span className="text-gray-400">(opcional)</span>}
        </label>

        {noServicesForBarber ? (
          <p className="mt-1 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-4 text-center text-xs text-amber-700">
            Creá al menos un servicio en “Catálogo de servicios” antes de dar de alta un barbero.
          </p>
        ) : services.length === 0 ? (
          <p className="mt-1 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
            No hay servicios activos todavía.
          </p>
        ) : (
          <div className="mt-1 space-y-2">
            {services.map((svc) => {
              const on = selected.has(svc.id);
              return (
                <div
                  key={svc.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    on ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${on ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
                      {svc.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400 tabular-nums">
                      {formatMoney(svc.price, svc.currency)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleService(svc.id)}
                    disabled={saving}
                    aria-label={`${on ? 'Quitar' : 'Asignar'} ${svc.name}`}
                    aria-pressed={on}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
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
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      {/* Acciones */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || noServicesForBarber}
          className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Creando...' : 'Crear'}
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
