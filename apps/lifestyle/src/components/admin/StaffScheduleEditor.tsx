// ─── StaffScheduleEditor ──────────────────────────────────────────────────────
// Client Component — edita el horario semanal recurrente de un barbero.
//
// Datos: recibe availability actual como prop (pre-cargado por StaffManagementPanel).
// Al guardar: PATCH /api/staff/[id]/schedule con el nuevo array de dias activos.
// Solo los dias con toggle ON se incluyen en el payload.
//
// Mobile-first: cada dia es una fila compacta con toggle + inputs de hora.

'use client';

import { useState } from 'react';
import type { StaffAvailabilitySlot } from '@/lib/dashboard.types';
import ScheduleExceptionsPanel from './ScheduleExceptionsPanel';

// ─── Config de dias ───────────────────────────────────────────────────────────

const DAYS: { index: number; label: string }[] = [
  { index: 1, label: 'Lunes' },
  { index: 2, label: 'Martes' },
  { index: 3, label: 'Miercoles' },
  { index: 4, label: 'Jueves' },
  { index: 5, label: 'Viernes' },
  { index: 6, label: 'Sabado' },
  { index: 0, label: 'Domingo' },
];

// ─── Tipos internos ───────────────────────────────────────────────────────────

type DayState = {
  active:      boolean;
  start_time:  string;   // "HH:MM"
  end_time:    string;   // "HH:MM"
  has_break:   boolean;
  break_start: string;   // "HH:MM"
  break_end:   string;   // "HH:MM"
};

type Props = {
  staffId:      string;
  staffName:    string;
  availability: StaffAvailabilitySlot[];
  /** IANA del negocio — baja a ScheduleExceptionsPanel para el min del input. */
  timezone:     string;
  onSaved:      () => void;
  onCancel:     () => void;
};

// ─── Helper: inicializar estado desde availability ────────────────────────────

function buildInitialState(availability: StaffAvailabilitySlot[]): Record<number, DayState> {
  const slotByDay = new Map(availability.map((s) => [s.day_of_week, s]));
  const state: Record<number, DayState> = {};

  for (const { index } of DAYS) {
    const slot = slotByDay.get(index);
    if (slot) {
      const hasBreak = !!(slot.break_start && slot.break_end);
      state[index] = {
        active:      true,
        start_time:  slot.start_time.slice(0, 5),
        end_time:    slot.end_time.slice(0, 5),
        has_break:   hasBreak,
        break_start: slot.break_start?.slice(0, 5) ?? '13:00',
        break_end:   slot.break_end?.slice(0, 5)   ?? '14:00',
      };
    } else {
      state[index] = {
        active:      false,
        start_time:  '09:00',
        end_time:    '20:00',
        has_break:   false,
        break_start: '13:00',
        break_end:   '14:00',
      };
    }
  }

  return state;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaffScheduleEditor({
  staffId,
  staffName,
  availability,
  timezone,
  onSaved,
  onCancel,
}: Props) {
  const [days, setDays]     = useState<Record<number, DayState>>(() => buildInitialState(availability));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── Helpers de mutacion ──────────────────────────────────────────────────

  function toggleDay(index: number) {
    setDays((prev) => ({
      ...prev,
      [index]: { ...prev[index]!, active: !prev[index]!.active },
    }));
    setError(null);
  }

  function setTime(index: number, field: 'start_time' | 'end_time' | 'break_start' | 'break_end', value: string) {
    setDays((prev) => ({
      ...prev,
      [index]: { ...prev[index]!, [field]: value },
    }));
    setError(null);
  }

  function toggleBreak(index: number) {
    setDays((prev) => ({
      ...prev,
      [index]: { ...prev[index]!, has_break: !prev[index]!.has_break },
    }));
    setError(null);
  }

  // ── Guardar ──────────────────────────────────────────────────────────────

  async function handleSave() {
    // Validar horas para todos los dias activos
    for (const { index, label } of DAYS) {
      const day = days[index]!;
      if (!day.active) continue;
      if (day.start_time >= day.end_time) {
        setError(`${label}: la hora de entrada debe ser anterior a la de salida`);
        return;
      }
      if (day.has_break && day.break_start >= day.break_end) {
        setError(`${label}: el inicio del descanso debe ser anterior al fin`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    const payload = DAYS
      .filter(({ index }) => days[index]!.active)
      .map(({ index }) => {
        const day = days[index]!;
        return {
          day_of_week: index,
          start_time:  day.start_time,
          end_time:    day.end_time,
          break_start: day.has_break ? day.break_start : null,
          break_end:   day.has_break ? day.break_end   : null,
          is_active:   true,
        };
      });

    try {
      const res = await fetch(`/api/staff/${staffId}/schedule`, {
        method:      'PATCH',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify({ availability: payload }),
      });

      if (res.ok) {
        onSaved();
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Error al guardar horario');
      }
    } catch {
      setError('Error de red — intenta de nuevo');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Horario semanal de <span className="font-medium text-gray-700">{staffName}</span>
      </p>

      <div className="space-y-2">
        {DAYS.map(({ index, label }) => {
          const day = days[index]!;

          return (
            <div
              key={index}
              className={`rounded-lg border px-3 py-2.5 transition-colors ${
                day.active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
              }`}
            >
              {/* Fila principal: toggle + nombre + horas */}
              <div className="flex items-center gap-3">
                {/* Toggle dia activo */}
                <button
                  type="button"
                  onClick={() => toggleDay(index)}
                  aria-label={`${day.active ? 'Desactivar' : 'Activar'} ${label}`}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                    day.active ? 'bg-gray-800' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      day.active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>

                {/* Nombre del dia */}
                <span className={`w-20 shrink-0 text-xs font-medium ${day.active ? 'text-gray-800' : 'text-gray-400'}`}>
                  {label}
                </span>

                {/* Inputs de hora */}
                {day.active ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      type="time"
                      value={day.start_time}
                      onChange={(e) => setTime(index, 'start_time', e.target.value)}
                      className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-500 focus:outline-none"
                    />
                    <span className="shrink-0 text-xs text-gray-400">–</span>
                    <input
                      type="time"
                      value={day.end_time}
                      onChange={(e) => setTime(index, 'end_time', e.target.value)}
                      className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-gray-300">Descanso</span>
                )}
              </div>

              {/* Fila de descanso — solo si el dia está activo */}
              {day.active && (
                <div className="mt-2 flex items-center gap-3 pl-12">
                  {/* Checkbox "Descanso" */}
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={day.has_break}
                      onChange={() => toggleBreak(index)}
                      className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-800"
                    />
                    <span className="text-[11px] text-gray-500">Descanso</span>
                  </label>

                  {/* Inputs de break — visibles solo si has_break */}
                  {day.has_break && (
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        type="time"
                        value={day.break_start}
                        onChange={(e) => setTime(index, 'break_start', e.target.value)}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-700 focus:border-gray-500 focus:outline-none"
                      />
                      <span className="shrink-0 text-xs text-gray-400">–</span>
                      <input
                        type="time"
                        value={day.break_end}
                        onChange={(e) => setTime(index, 'break_end', e.target.value)}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-700 focus:border-gray-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>
      )}

      {/* Acciones */}
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

      {/* ── Excepciones de horario ────────────────────────────────────────── */}
      <div className="mt-6 border-t border-gray-100 pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Excepciones de horario
        </p>
        <ScheduleExceptionsPanel staffId={staffId} timezone={timezone} />
      </div>
    </div>
  );
}
