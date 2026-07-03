// ─── BlockRequestForm ─────────────────────────────────────────────────────────
// Client Component — formulario para solicitar un bloqueo puntual.
//
// Estado del componente:
//   - Lista de solicitudes (seed desde initialBlockRequests, actualizada al crear).
//   - Campos del formulario: fecha, hora inicio, hora fin, motivo.
//   - submitting / error / successMsg para feedback visual.
//
// Validación client-side:
//   - starts_at no puede ser en el pasado.
//   - ends_at > starts_at (mismo día).
//
// Submit → POST /api/staff/block-request
// No depende de Realtime — lista solo se actualiza en esta sesión.

'use client';

import { useState } from 'react';
import type { StaffBlockRequest } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialBlockRequests: StaffBlockRequest[];
};

// ─── Config visual de status ──────────────────────────────────────────────────

const STATUS_LABEL: Record<StaffBlockRequest['status'], string> = {
  pending:  'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
};

const STATUS_BADGE: Record<StaffBlockRequest['status'], string> = {
  pending:  'bg-tint-1 text-ink',
  approved: 'bg-tint-2 text-teal-ink',
  rejected: 'bg-red-tint text-red-ink',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

/** 'YYYY-MM-DD' de hoy en hora local — para el atributo min del input[type=date]. */
function todayLocalStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlockRequestForm({ initialBlockRequests }: Props) {
  const [requests, setRequests] = useState<StaffBlockRequest[]>(initialBlockRequests);

  // Campos del formulario
  const [date, setDate]           = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime]     = useState('');
  const [reason, setReason]       = useState('');
  const [urgent, setUrgent]       = useState(false);

  // Estado de envío
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [successMsg, setSuccessMsg]   = useState<string | null>(null);

  // ── Validación client-side ────────────────────────────────────────────────

  function validate(): string | null {
    if (!date || !startTime || !endTime) {
      return 'Completa fecha, hora de inicio y hora de fin.';
    }

    const startsMs = new Date(`${date}T${startTime}:00`).getTime();
    const endsMs   = new Date(`${date}T${endTime}:00`).getTime();

    if (isNaN(startsMs) || isNaN(endsMs)) {
      return 'Fecha u hora inválida.';
    }
    if (startsMs <= Date.now()) {
      return 'La hora de inicio no puede estar en el pasado.';
    }
    if (endsMs <= startsMs) {
      return 'La hora de fin debe ser mayor a la de inicio.';
    }
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const starts_at = new Date(`${date}T${startTime}:00`).toISOString();
      const ends_at   = new Date(`${date}T${endTime}:00`).toISOString();

      const res = await fetch('/api/staff/block-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starts_at, ends_at, reason: reason.trim() || null, urgent }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Error al enviar la solicitud.');
        return;
      }

      const created = await res.json() as StaffBlockRequest;

      // Agregar al inicio de la lista
      setRequests((prev) => [created, ...prev]);

      // Limpiar formulario
      setDate('');
      setStartTime('');
      setEndTime('');
      setReason('');
      setUrgent(false);
      setSuccessMsg('Solicitud enviada. El admin la revisará pronto.');
    } catch {
      setError('Error de red. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  const today = todayLocalStr();

  return (
    <div className="space-y-4">
      {/* ── Formulario ──────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-ink-2 mb-2">
          Solicitar bloqueo
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          {/* Fecha */}
          <div>
            <label htmlFor="block-date" className="block text-xs text-ink-2 mb-1">
              Fecha
            </label>
            <input
              id="block-date"
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-line-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Hora inicio + fin en la misma fila */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="block-start" className="block text-xs text-ink-2 mb-1">
                Inicio
              </label>
              <input
                id="block-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-line-2 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="block-end" className="block text-xs text-ink-2 mb-1">
                Fin
              </label>
              <input
                id="block-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-line-2 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label htmlFor="block-reason" className="block text-xs text-ink-2 mb-1">
              Motivo <span className="text-faint">(opcional)</span>
            </label>
            <textarea
              id="block-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder="Cita médica, trámite personal…"
              className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder-faint focus:border-line-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Toggle urgente */}
          <label className="flex cursor-pointer items-start gap-3">
            <div className="relative mt-0.5 shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                disabled={submitting}
              />
              <div
                className={`h-5 w-9 rounded-full transition-colors ${
                  urgent ? 'bg-red-ink' : 'bg-past-line'
                } ${submitting ? 'opacity-50' : ''}`}
              />
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform ${
                  urgent ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-ink">
                Marcar como urgente
              </span>
              <p className="mt-0.5 text-xs text-faint">
                Marca como urgente si el bloqueo es para hoy o mañana
                y el admin debe saberlo de inmediato.
              </p>
            </div>
          </label>

          {/* Feedback */}
          {error && (
            <p role="alert" className="text-xs text-red-ink">{error}</p>
          )}
          {successMsg && (
            <p role="status" className="text-xs text-teal-ink">{successMsg}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-teal-ink bg-teal-ink py-2.5 text-sm font-medium text-card hover:bg-teal-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </form>
      </div>

      {/* ── Historial de solicitudes ─────────────────────────────────────── */}
      {requests.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink-2 mb-2">
            Solicitudes recientes
          </p>
          <div className="space-y-2">
            {requests.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-line px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs tabular-nums text-ink">
                      {formatDateTime(req.starts_at)}
                      <span className="text-faint">
                        {' '}– {new Date(req.ends_at).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </span>
                    </p>
                    {req.reason && (
                      <p className="mt-0.5 truncate text-xs text-ink-2">
                        {req.reason}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[req.status]}`}
                  >
                    {STATUS_LABEL[req.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
