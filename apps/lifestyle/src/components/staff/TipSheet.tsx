// ─── TipSheet ─────────────────────────────────────────────────────────────────
// La hoja de propina (Paso 7). Sube al confirmarse un "Terminó" (hero, ficha o
// swipe — en el swipe, DESPUÉS de la ventana de Deshacer: el gate del server
// action exige status 'completed', que recién existe al commitear) y al tocar un
// cabo suelto ("+ propina") en el hilo o en Cierre.
//
// Decisión de producto: NO se cierra sola ni la cierra el velo — el cliente paga
// en recepción y a veces vuelve después con la propina; la hoja espera. Cierra
// SOLO con: un monto, "Sin propina", o la ✕ (que deja el cabo suelto "+ propina").
//
// 🔴 PRIVACIDAD: la propina es del BARBERO. La línea "Esto es tuyo — el dueño no
// lo ve" es parte del producto: sin ella el barbero no la anota honesto.

'use client';

import { useState, useTransition } from 'react';
import type { BarberDayAppointment } from '@/lib/barberDay';
import { setAppointmentTip } from '@/app/staff/actions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** $1,250 — sin centavos si es entero (propina en efectivo). */
export function fmtTip(n: number): string {
  return `$${n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })}`;
}

const SUGGESTED_PCTS = [10, 15, 25] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appt: BarberDayAppointment;
  onClose: () => void;   // ✕ — sin guardar: el cabo queda suelto ("+ propina")
  onSaved: () => void;   // monto o "Sin propina" guardado → cerrar + refresh
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TipSheet({ appt, onClose, onSaved }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherValue, setOtherValue] = useState(
    appt.tipAmount !== null && appt.tipAmount > 0 ? String(appt.tipAmount) : '',
  );

  // Base de los %: el precio SELLADO al completar; el de catálogo como fallback.
  const base = appt.price_charged ?? appt.service?.price ?? 0;
  const name = appt.customer?.name ?? 'Cliente';

  function save(amount: number) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setAppointmentTip(appt.id, amount);
        if (res?.error) { setError(res.error); return; }
        onSaved();
      } catch {
        setError('No se pudo guardar. Intenta de nuevo.');
      }
    });
  }

  const otherParsed = Number(otherValue);
  const otherValid = otherValue.trim() !== '' && Number.isFinite(otherParsed) && otherParsed >= 0;

  return (
    // El velo NO cierra (sin onClick a propósito): la hoja espera al barbero.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30">
      <div className="animate-card-in max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-card border border-line bg-card px-4 pb-8 pt-3 shadow-hero">
        {/* Asa (decorativa — arrastrar no cierra) */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink">¿Te dejó propina?</p>
            <p className="truncate text-sm text-ink-2">
              {name} · {appt.service?.name ?? ''}{base > 0 ? <span className="tabular-nums"> · {fmtTip(base)}</span> : null}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar sin registrar"
            className="shrink-0 rounded-lg px-2 py-1 text-ink-2 hover:bg-past-bg"
          >
            ✕
          </button>
        </div>

        {/* Montos sugeridos — % sobre el servicio, redondeados a pesos */}
        {base > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {SUGGESTED_PCTS.map((pct) => {
              const amount = Math.round((base * pct) / 100);
              return (
                <button
                  key={pct}
                  disabled={isPending}
                  onClick={() => save(amount)}
                  className="flex min-h-[56px] flex-col items-center justify-center rounded-xl border border-teal-border bg-tint-1 py-2 hover:bg-tint-2 active:opacity-80 disabled:opacity-50"
                >
                  <span className="text-base font-semibold tabular-nums text-teal-ink">{fmtTip(amount)}</span>
                  <span className="text-[10.5px] font-medium text-teal-ink/70">{pct}%</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Otro monto */}
        {showOther ? (
          <div className="mt-2 flex gap-2">
            <div className="flex flex-1 items-center rounded-xl border border-line bg-card px-3">
              <span className="text-sm text-ink-2">$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                autoFocus
                value={otherValue}
                onChange={(e) => setOtherValue(e.target.value)}
                placeholder="0"
                className="w-full bg-transparent px-1.5 py-3 text-sm tabular-nums text-ink outline-none"
              />
            </div>
            <button
              disabled={isPending || !otherValid}
              onClick={() => save(otherParsed)}
              className="rounded-xl bg-teal-ink px-4 text-sm font-semibold text-card disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        ) : (
          <button
            disabled={isPending}
            onClick={() => setShowOther(true)}
            className="mt-2 w-full rounded-xl border border-line bg-card py-3 text-sm font-semibold text-ink-2 hover:bg-tint-1 disabled:opacity-50"
          >
            Otro monto
          </button>
        )}

        {/* Sin propina — monto 0, distinto del cabo suelto (✕) */}
        <button
          disabled={isPending}
          onClick={() => save(0)}
          className="mt-2 w-full rounded-xl py-3 text-sm font-medium text-faint hover:bg-past-bg disabled:opacity-50"
        >
          Sin propina
        </button>

        {error && <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}

        {/* 🔒 La promesa — parte del producto, no decoración */}
        <p className="mt-3 border-t border-line pt-3 text-center text-xs text-faint">
          🔒 Esto es tuyo — el dueño no lo ve.
        </p>
      </div>
    </div>
  );
}
