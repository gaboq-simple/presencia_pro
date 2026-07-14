'use client';

// ─── BusinessHoursPanel ───────────────────────────────────────────────────────
// Client Component — edita el horario de atención del negocio (office_hours).
//
// Molde: ReportsConfigPanel (GET al montar, PATCH, espera respuesta, no optimista).
// Referencia visual: StaffScheduleEditor (filas por día con toggle + horas), pero
// más simple: un rango por día, sin breaks, sin barbero.
//
// SEMÁNTICA (comunicada en el texto de ayuda): este horario es "de cara al
// público" (landing + away-message del bot). NO controla qué se puede reservar.

import { useState, useEffect } from 'react';

// ─── Días — orden humano Lun→Dom, con su clave "0".."6" (0=domingo) ───────────

const DAYS: Array<{ key: string; label: string }> = [
  { key: '1', label: 'Lunes' },
  { key: '2', label: 'Martes' },
  { key: '3', label: 'Miércoles' },
  { key: '4', label: 'Jueves' },
  { key: '5', label: 'Viernes' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
];

type DayState = { open: boolean; start: string; end: string };
type DaySchedule = { start: string; end: string };
type OfficeHours = Record<string, DaySchedule | null>;

function buildInitialState(oh: OfficeHours | null): Record<string, DayState> {
  const state: Record<string, DayState> = {};
  for (const { key } of DAYS) {
    const slot = oh?.[key];
    state[key] = slot
      ? { open: true, start: slot.start.slice(0, 5), end: slot.end.slice(0, 5) }
      : { open: false, start: '09:00', end: '18:00' };
  }
  return state;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BusinessHoursPanel() {
  const [days, setDays]       = useState<Record<string, DayState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/business/hours', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as { office_hours: OfficeHours | null };
        if (!cancelled) setDays(buildInitialState(data.office_hours));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function toggleDay(key: string) {
    setDays((prev) => prev && { ...prev, [key]: { ...prev[key]!, open: !prev[key]!.open } });
    setSaveMsg(null);
    setError(null);
  }

  function setTime(key: string, field: 'start' | 'end', value: string) {
    setDays((prev) => prev && { ...prev, [key]: { ...prev[key]!, [field]: value } });
    setSaveMsg(null);
    setError(null);
  }

  async function handleSave() {
    if (!days || saving) return;

    // Validación client-side (espeja la Zod del server): apertura < cierre.
    for (const { key, label } of DAYS) {
      const d = days[key]!;
      if (d.open && d.start >= d.end) {
        setError(`${label}: la apertura debe ser anterior al cierre`);
        return;
      }
    }

    // Construir el objeto completo (7 claves): abierto → {start,end}, cerrado → null.
    const office_hours: OfficeHours = {};
    for (const { key } of DAYS) {
      const d = days[key]!;
      office_hours[key] = d.open ? { start: d.start, end: d.end } : null;
    }

    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/business/hours', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ office_hours }),
      });
      if (res.ok) {
        setSaveMsg('Guardado');
        setTimeout(() => setSaveMsg(null), 2500);
      } else {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'Error al guardar');
      }
    } catch {
      setError('Error de red — intentá de nuevo');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-xs font-medium text-gray-500">Horario del negocio</p>
        <p className="mt-2 text-xs text-gray-400">Cargando...</p>
      </div>
    );
  }

  if (!days) return null;

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">Horario del negocio</p>

      {/* Texto que comunica la semántica: esto es "de cara al público" */}
      <p className="mt-1 text-xs leading-relaxed text-gray-400">
        Este es el horario que ven tus clientes en tu página y el que usa el asistente para
        saber cuándo estás abierto. Para controlar en qué horarios se pueden agendar citas,
        ajustá la disponibilidad de cada barbero.
      </p>

      <div className="mt-3 space-y-2">
        {DAYS.map(({ key, label }) => {
          const d = days[key]!;
          return (
            <div
              key={key}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                d.open ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
              }`}
            >
              {/* Toggle abierto/cerrado */}
              <button
                type="button"
                onClick={() => toggleDay(key)}
                disabled={saving}
                role="switch"
                aria-checked={d.open}
                aria-label={`${label}: ${d.open ? 'abierto' : 'cerrado'}`}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
                  d.open ? 'bg-gray-800' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    d.open ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>

              {/* Nombre del día */}
              <span className={`w-20 shrink-0 text-xs font-medium ${d.open ? 'text-gray-800' : 'text-gray-400'}`}>
                {label}
              </span>

              {/* Horas o "Cerrado" */}
              {d.open ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    type="time"
                    value={d.start}
                    onChange={(e) => setTime(key, 'start', e.target.value)}
                    disabled={saving}
                    className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50"
                  />
                  <span className="shrink-0 text-xs text-gray-400">–</span>
                  <input
                    type="time"
                    value={d.end}
                    onChange={(e) => setTime(key, 'end', e.target.value)}
                    disabled={saving}
                    className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
              ) : (
                <span className="flex-1 text-xs text-gray-300">Cerrado</span>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {saving ? '…' : 'Guardar horario'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg === 'Guardado' ? 'text-green-600' : 'text-red-500'}`}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}
