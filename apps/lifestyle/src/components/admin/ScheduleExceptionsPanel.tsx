// ─── ScheduleExceptionsPanel ──────────────────────────────────────────────────
// Gestiona excepciones de horario por fecha específica (días libres u horario
// especial) para un barbero. Se monta dentro de StaffScheduleEditor.
//
// Responsabilidades:
//   - Lista excepciones futuras del barbero (getScheduleExceptions).
//   - Formulario para agregar: fecha + tipo (libre/especial) + horas + razón.
//   - Botón eliminar por excepción (deleteScheduleException).

'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { todayStrInTz } from '@/lib/dayWindow';
import type { ScheduleException } from '@/app/staff/assistant-actions';
import {
  getScheduleExceptions,
  createScheduleException,
  deleteScheduleException,
} from '@/app/staff/assistant-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  staffId: string;
  /** IANA del negocio — el min del input es el hoy LOCAL, no el día UTC (que
      post-18:00 MX ya va en mañana y bloqueaba agregar una excepción para hoy). */
  timezone: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function trimTime(t: string | null | undefined): string {
  return t?.slice(0, 5) ?? '';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScheduleExceptionsPanel({ staffId, timezone }: Props) {
  const [exceptions, setExceptions]  = useState<ScheduleException[]>([]);
  const [loading, setLoading]        = useState(true);
  const [loadError, setLoadError]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Formulario ────────────────────────────────────────────────────────────
  const [formDate, setFormDate]      = useState('');
  const [formType, setFormType]      = useState<'free' | 'special'>('free');
  const [formStart, setFormStart]    = useState('09:00');
  const [formEnd, setFormEnd]        = useState('20:00');
  const [formReason, setFormReason]  = useState('');
  const [formError, setFormError]    = useState<string | null>(null);

  // ── Carga ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getScheduleExceptions(staffId);
      setExceptions(data);
    } catch {
      setLoadError('Error al cargar excepciones');
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => { void load(); }, [load]);

  // ── Eliminar ──────────────────────────────────────────────────────────────

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteScheduleException(id);
        setExceptions((prev) => prev.filter((e) => e.id !== id));
      } catch {
        // silencio
      }
    });
  }

  // ── Agregar ───────────────────────────────────────────────────────────────

  function handleAdd() {
    setFormError(null);

    if (!formDate) {
      setFormError('Selecciona una fecha');
      return;
    }
    if (formType === 'special' && formStart >= formEnd) {
      setFormError('La hora de inicio debe ser anterior a la de fin');
      return;
    }

    startTransition(async () => {
      try {
        const created = await createScheduleException({
          staffId,
          exceptionDate: formDate,
          available:     formType === 'special',
          startTime:     formType === 'special' ? formStart : null,
          endTime:       formType === 'special' ? formEnd   : null,
          reason:        formReason.trim() || null,
        });

        setExceptions((prev) => {
          // Reemplazar si ya existe la misma fecha (upsert semántico)
          const without = prev.filter((e) => e.exception_date !== created.exception_date);
          return [...without, created].sort((a, b) =>
            a.exception_date.localeCompare(b.exception_date),
          );
        });

        // Limpiar formulario
        setFormDate('');
        setFormType('free');
        setFormStart('09:00');
        setFormEnd('20:00');
        setFormReason('');
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Error al guardar excepción');
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Lista de excepciones existentes */}
      {loading ? (
        <p className="text-xs text-gray-400">Cargando excepciones…</p>
      ) : loadError ? (
        <p className="text-xs text-red-500">{loadError}</p>
      ) : exceptions.length === 0 ? (
        <p className="mb-3 text-xs text-gray-400">Sin excepciones programadas.</p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {exceptions.map((exc) => (
            <li
              key={exc.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800">{formatDate(exc.exception_date)}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {exc.available
                    ? `Horario especial: ${trimTime(exc.start_time)} – ${trimTime(exc.end_time)}`
                    : 'Día libre'}
                  {exc.reason ? ` · ${exc.reason}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(exc.id)}
                disabled={isPending}
                aria-label="Eliminar excepción"
                className="shrink-0 rounded p-1 text-gray-300 hover:text-red-500 disabled:opacity-40"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0111.595 15h-5.19a1.75 1.75 0 01-1.741-1.575l-.66-6.6a.75.75 0 011.492-.15zM6.5 8a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 016.5 8zm3 0a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 019.5 8z" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Formulario para agregar */}
      <div className="space-y-2 rounded-lg border border-dashed border-gray-200 p-3">
        <p className="text-[11px] font-medium text-gray-500">Agregar excepción</p>

        {/* Fecha */}
        <input
          type="date"
          value={formDate}
          min={todayStrInTz(timezone)}
          onChange={(e) => { setFormDate(e.target.value); setFormError(null); }}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
        />

        {/* Toggle tipo */}
        <div className="flex gap-1">
          {(['free', 'special'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setFormType(t); setFormError(null); }}
              className={`flex-1 rounded py-1.5 text-[11px] font-medium transition-colors ${
                formType === t
                  ? 'bg-gray-800 text-white'
                  : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {t === 'free' ? 'Día libre' : 'Horario especial'}
            </button>
          ))}
        </div>

        {/* Horas — solo si horario especial */}
        {formType === 'special' && (
          <div className="flex items-center gap-1.5">
            <input
              type="time"
              value={formStart}
              onChange={(e) => { setFormStart(e.target.value); setFormError(null); }}
              className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-400 focus:outline-none"
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="time"
              value={formEnd}
              onChange={(e) => { setFormEnd(e.target.value); setFormError(null); }}
              className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-800 focus:border-gray-400 focus:outline-none"
            />
          </div>
        )}

        {/* Razón (opcional) */}
        <input
          type="text"
          value={formReason}
          onChange={(e) => setFormReason(e.target.value)}
          placeholder="Razón (opcional)"
          maxLength={120}
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-800 placeholder-gray-300 focus:border-gray-400 focus:outline-none"
        />

        {formError && (
          <p className="text-[11px] text-red-600">{formError}</p>
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending || !formDate}
          className="w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {isPending ? 'Guardando…' : 'Agregar excepción'}
        </button>
      </div>
    </div>
  );
}
