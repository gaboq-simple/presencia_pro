// ─── TipsSummary ──────────────────────────────────────────────────────────────
// El bloque "Tus propinas" de la pestaña Cierre (Paso 7): total del día, detalle
// por cita, acumulado semanal y el conteo de cabos sueltos ("N sin resolver").
// Un cabo suelto (cita terminada sin propina registrada — tipAmount null) es
// tocable: reabre la hoja para esa cita. "Sin propina" (monto 0) NO es cabo
// suelto — es una respuesta.
//
// A diferencia de EndOfDaySummary (que espera el fin de jornada), este bloque
// aparece en cuanto hay UNA cita completada: las propinas se van juntando
// durante el día, no solo al final.
//
// 🔴 PRIVACIDAD: candado "Solo vos" + la promesa por escrito abajo. El acumulado
// semanal viene de refreshBarberWeekTipTotal (gate barbero-only).

'use client';

import { useEffect, useState } from 'react';
import type { BarberDayAppointment } from '@/lib/barberDay';
import { refreshBarberWeekTipTotal } from '@/app/staff/actions';
import { fmtTip } from './TipSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  appointments: BarberDayAppointment[];
  date: string;      // 'YYYY-MM-DD' visualizado (ancla del acumulado semanal)
  timezone: string;  // IANA del negocio — horas del detalle en la tz local
  onOpenTip: (appt: BarberDayAppointment) => void;
};

function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TipsSummary({ appointments, date, timezone, onOpenTip }: Props) {
  const [weekTotal, setWeekTotal] = useState<number | null>(null);

  const completed = appointments
    .filter((a) => a.status === 'completed')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // El total del día cambia con cada propina registrada → re-fetch del semanal
  // (barato: dos selects scopeados) para que ambos números cuadren siempre.
  const dayTotal = completed.reduce((sum, a) => sum + (a.tipAmount ?? 0), 0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const total = await refreshBarberWeekTipTotal(date);
        if (!cancelled) setWeekTotal(total);
      } catch {
        if (!cancelled) setWeekTotal(null);
      }
    })();
    return () => { cancelled = true; };
  }, [date, dayTotal]);

  if (completed.length === 0) return null;

  const resolved = completed.filter((a) => a.tipAmount !== null);
  const unresolved = completed.filter((a) => a.tipAmount === null);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
      {/* Encabezado — con el candado */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-semibold text-ink">Tus propinas</span>
        <span className="rounded-pill bg-tint-1 px-2 py-0.5 text-[10.5px] font-semibold text-teal-ink">
          🔒 Solo vos
        </span>
      </div>

      {/* Total del día + resueltas/cabos */}
      <div className="px-4 pb-1 pt-4 text-center">
        <p className="text-[26px] font-semibold tabular-nums leading-none text-teal-ink">
          {fmtTip(dayTotal)}
        </p>
        <p className="mt-1.5 text-[11px] font-medium text-ink-2">
          {resolved.length} de {completed.length} {completed.length === 1 ? 'resuelta' : 'resueltas'}
          {unresolved.length > 0 && (
            <span className="text-amber"> · {unresolved.length} sin resolver</span>
          )}
        </p>
      </div>

      {/* Detalle por cita */}
      <div className="space-y-1 px-4 py-3">
        {completed.map((a) => {
          const isLoose = a.tipAmount === null;
          const row = (
            <>
              <span className="shrink-0 text-xs tabular-nums text-faint">{hhmm(a.starts_at, timezone)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{a.customer?.name ?? 'Cliente'}</span>
              {isLoose ? (
                <span className="shrink-0 rounded-pill border border-dashed border-teal-border px-2 py-0.5 text-[10.5px] font-semibold text-teal-ink">
                  + propina
                </span>
              ) : a.tipAmount === 0 ? (
                <span className="shrink-0 text-xs text-faint">Sin propina</span>
              ) : (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-ink">
                  +{fmtTip(a.tipAmount!)}
                </span>
              )}
            </>
          );
          // El cabo suelto es tocable → reabre la hoja. El resuelto no navega
          // (corregir un monto va por la cita, en el hilo).
          return isLoose ? (
            <button
              key={a.id}
              onClick={() => onOpenTip(a)}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-tint-1"
            >
              {row}
            </button>
          ) : (
            <div key={a.id} className="flex items-center gap-2 px-1 py-1.5">
              {row}
            </div>
          );
        })}
      </div>

      {/* Acumulado semanal */}
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
        <span className="text-[11px] font-medium text-ink-2">Esta semana llevas</span>
        <span className="text-sm font-semibold tabular-nums text-ink">
          {weekTotal === null ? '·' : fmtTip(weekTotal)}
        </span>
      </div>

      {/* 🔒 La promesa, por escrito */}
      <div className="border-t border-line bg-tint-1 px-4 py-3">
        <p className="text-center text-xs leading-snug text-ink-2">
          Esto es tuyo — el dueño no lo ve. No entra en sus reportes ni en su panel.
        </p>
      </div>
    </div>
  );
}
