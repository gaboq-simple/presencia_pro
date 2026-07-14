// ─── StaffCreateForm ──────────────────────────────────────────────────────────
// Client Component — alta de un miembro del staff nuevo (caso principal: barbero).
//
// Molde: ServiceForm (Paso 1) — valida client-side, hace su propio POST y llama
// onCreated(staff) / onCancel(). Se monta dentro del modal del panel. El PIN NO se
// pide: lo genera el servidor y viene en la respuesta (el panel lo muestra al dueño).

'use client';

import { useState } from 'react';

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
};

type Role = 'barber' | 'assistant' | 'admin';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'barber',    label: 'Barbero' },
  { value: 'assistant', label: 'Asistente' },
  { value: 'admin',     label: 'Admin' },
];

export default function StaffCreateForm({ onCreated, onCancel }: Props) {
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole]   = useState<Role>('barber');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { setError('El nombre es requerido'); return; }
    if (trimmedName.length > 80) { setError('El nombre: máximo 80 caracteres'); return; }

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
