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
      <p className="mb-3 text-xs text-faint">
        Dia libre para <span className="font-medium text-ink-2">{staffName}</span>
      </p>

      {/* Selector de fecha */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">
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
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-teal-border focus:outline-none"
          />
        </div>

        {/* Motivo opcional */}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">
            Motivo <span className="font-normal text-faint">(opcional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vacaciones, cita medica..."
            maxLength={200}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder-faint focus:border-teal-border focus:outline-none"
          />
        </div>
      </div>

      {/* Aviso de citas existentes */}
      {warning && (
        <div className="mt-3 rounded-lg border border-amber-border bg-amber-tint px-3 py-2.5">
          <p className="text-xs text-amber">{warning.message}</p>
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={saving}
            className="mt-2 rounded-lg bg-amber px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Confirmando...' : 'Confirmar de todas formas'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs text-red-ink" role="alert">{error}</p>
      )}

      {/* Acciones — ocultar si hay aviso pendiente */}
      {!warning && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={saving || !date}
            className="flex-1 rounded-lg bg-ink py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-2 hover:bg-canvas disabled:opacity-50"
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
          className="mt-2 w-full rounded-lg border border-line py-2 text-sm text-faint hover:bg-canvas"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}
