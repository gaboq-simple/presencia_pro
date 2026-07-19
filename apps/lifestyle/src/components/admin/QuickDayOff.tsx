// ─── QuickDayOff ──────────────────────────────────────────────────────────────
// Client Component — marca un dia libre para un barbero.
//
// Flujo:
//   1. Seleccionar fecha (input type="date" nativo — funciona bien en movil).
//   2. Motivo opcional.
//   3. Confirmar → POST /api/staff/[id]/day-off
//   4. Si hay citas ese dia: muestra aviso con count y boton "Confirmar de todas formas".
//   5. Al confirmar (con o sin aviso): onSaved().
//
// Nota: "Dia extra" (dia que normalmente no trabaja) esta documentado como TODO.
//   Requeriria una tabla staff_availability_overrides — fuera de scope de Sesion 16.

'use client';

import { useState } from 'react';
import { todayStrInTz } from '@/lib/dayWindow';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  staffId:   string;
  staffName: string;
  /** IANA del negocio — "hoy"/"mañana" son los del negocio, no el día UTC (que
      post-18:00 MX ya va en mañana y bloqueaba marcar HOY como día libre). */
  timezone:  string;
  onSaved:   () => void;
  onCancel:  () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** dateStr + n días — aritmética pura sobre el string (ancla Z, sin tz de nadie). */
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuickDayOff({ staffId, staffName, timezone, onSaved, onCancel }: Props) {
  // "Hoy" del NEGOCIO (min del input: hoy sí se puede marcar libre) y default mañana.
  const todayStr = todayStrInTz(timezone);
  const tomorrowStr = addDaysStr(todayStr, 1);

  const [date, setDate]               = useState(tomorrowStr);
  const [reason, setReason]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [warning, setWarning]         = useState<{ count: number; message: string } | null>(null);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit(force = false) {
    setError(null);

    if (!date) {
      setError('Selecciona una fecha');
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(`/api/staff/${staffId}/day-off`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({
          date,
          reason: reason.trim() || undefined,
          force,
        }),
      });

      const body = await res.json().catch(() => ({})) as {
        ok?: boolean;
        warning?: boolean;
        appointments_count?: number;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(body.error ?? 'Error al crear dia libre');
        return;
      }

      // Si hay citas ese dia: mostrar aviso (solo si no es force)
      if (body.warning && !force) {
        setWarning({
          count:   body.appointments_count ?? 0,
          message: body.message ?? `${staffName} tiene citas ese dia.`,
        });
        return;
      }

      onSaved();
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Dia libre para <span className="font-medium text-gray-700">{staffName}</span>
      </p>

      {/* Selector de fecha */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Fecha
          </label>
          <input
            type="date"
            value={date}
            min={todayStr}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
              setWarning(null);
            }}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none"
          />
        </div>

        {/* Motivo opcional */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Motivo <span className="font-normal text-gray-400">(opcional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vacaciones, cita medica..."
            maxLength={200}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-300 focus:border-gray-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Aviso de citas existentes */}
      {warning && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-800">{warning.message}</p>
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={saving}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? 'Confirmando...' : 'Confirmar de todas formas'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>
      )}

      {/* Acciones — ocultar si hay aviso pendiente */}
      {!warning && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={saving || !date}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Confirmar'}
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
      )}

      {/* Boton cancelar siempre visible cuando hay aviso */}
      {warning && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}
