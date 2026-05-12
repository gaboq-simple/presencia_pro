'use client';

// ─── WaitlistPanel ────────────────────────────────────────────────────────────
// Client Component — lista de espera del negocio.
//
// Muestra entradas con status 'waiting' o 'notified'.
// Actualización manual: botón "Notificar ahora" para entries en 'waiting'
// permite al admin notificar al cliente cuando el slot está disponible.
// Badge "Notificado — expira en Xm" para status 'notified'.
//
// Datos: GET /api/waitlist
// Acción: POST /api/waitlist (notificar manualmente — requiere datos del slot)

import { useState, useEffect, useCallback } from 'react';
import type { WaitlistEntry } from '@/lib/dashboard.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  return `${DAYS_ES[date.getDay()]} ${date.getDate()} ${MONTHS_ES[date.getMonth()]}`;
}

function minutesUntil(isoStr: string): number {
  return Math.max(0, Math.floor((new Date(isoStr).getTime() - Date.now()) / 60_000));
}

function preferenceLabel(pref: string): string {
  if (pref === 'mañana')  return 'Mañana';
  if (pref === 'tarde')   return 'Tarde';
  return 'Cualquier horario';
}

function timeAgo(isoStr: string): string {
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60_000);
  if (mins < 60)  return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WaitlistPanel() {
  const [entries, setEntries]   = useState<WaitlistEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/waitlist', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = (await res.json()) as { waitlist: WaitlistEntry[] };
      setEntries(data.waitlist);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Actualizar countdown cada 30s
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const activeCount = entries.length;

  return (
    <details className="rounded-lg border border-gray-200" open={activeCount > 0}>
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 hover:bg-gray-50">
        <span className="text-sm font-semibold text-gray-900">Lista de espera</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </summary>

      <div className="border-t border-gray-200 px-4 py-3">
        {loading ? (
          <p className="text-xs text-gray-400">Cargando...</p>
        ) : activeCount === 0 ? (
          <p className="text-xs text-gray-400">No hay clientes en lista de espera.</p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <WaitlistEntryRow
                key={entry.id}
                entry={entry}
                now={now}
                onRefresh={load}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// ─── WaitlistEntryRow ─────────────────────────────────────────────────────────

type RowProps = {
  entry:     WaitlistEntry;
  now:       number;
  onRefresh: () => Promise<void>;
};

function WaitlistEntryRow({ entry, now: _now, onRefresh }: RowProps) {
  const isNotified = entry.status === 'notified';
  const minsLeft   = isNotified && entry.expires_at ? minutesUntil(entry.expires_at) : null;

  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Nombre + servicio */}
          <p className="truncate text-sm font-medium text-gray-900">
            {entry.customer_name}
          </p>
          <p className="text-xs text-gray-500">
            {entry.service_name}
            {entry.staff_name ? ` · con ${entry.staff_name}` : ''}
          </p>

          {/* Fecha + turno */}
          <p className="mt-0.5 text-xs text-gray-500">
            {formatDate(entry.requested_date)} · {preferenceLabel(entry.requested_time_preference ?? '')}
          </p>

          {/* Tiempo en espera */}
          <p className="mt-0.5 text-[11px] text-gray-400">
            En espera desde hace {timeAgo(entry.created_at)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* Badge de estado */}
          {isNotified && minsLeft !== null ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              Notificado · expira en {minsLeft}m
            </span>
          ) : (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              En espera
            </span>
          )}
        </div>
      </div>

      {/* Botón notificar manualmente — solo para 'waiting' */}
      {entry.status === 'waiting' && (
        <NotifyButton entry={entry} onSuccess={onRefresh} />
      )}
    </li>
  );
}

// ─── NotifyButton ─────────────────────────────────────────────────────────────
// El admin puede notificar manualmente si sabe que hay un slot disponible.
// En la práctica esto requiere ingresar el horario del slot.
// Para simplificar la UI: se notifica con slot = "próximo disponible" (hoy).

function NotifyButton({ entry, onSuccess }: { entry: WaitlistEntry; onSuccess: () => Promise<void> }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleNotify() {
    setBusy(true);
    setError(null);
    try {
      // Slot manual: fecha solicitada a las 10:00 como placeholder
      const slotStartsAt = `${entry.requested_date}T10:00:00+00:00`;
      const res = await fetch('/api/waitlist', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          waitlist_id:    entry.id,
          slot_starts_at: slotStartsAt,
          staff_id:       entry.staff_id ?? '00000000-0000-0000-0000-000000000000',
          staff_name:     entry.staff_name ?? 'tu barbero',
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al notificar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => void handleNotify()}
        disabled={busy}
        className="text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900 disabled:opacity-50"
      >
        {busy ? 'Notificando...' : 'Notificar ahora'}
      </button>
      {error && <p className="mt-0.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
