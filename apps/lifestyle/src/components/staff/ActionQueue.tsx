// ─── ActionQueue ──────────────────────────────────────────────────────────────
// Client Component — la cola de acción de la mesa de control (S6-UI-02 PR-5).
//
// "Lo que necesita tu atención AHORA." En este PR la señal que EXISTE en el schema
// son las CITAS ATRASADAS (confirmada cuya hora efectiva ya pasó por más de la
// tolerancia del negocio, sin cerrar). Cada atrasado = una tarjeta con la jugada
// sugerida (primer hueco compatible) + acciones.
//
// Disciplina de enganche:
//   · "Mover" NO reimplementa el reacomodo — entra al MISMO gesto click-to-place del
//     panorama (onMove → el desk levanta la cita allá). La sugerencia es un HINT.
//   · "Marcar no llegó" libera el hueco (onNoShow → noShowAppointment).
//   · Hover en la tarjeta resalta la cita en el panorama (onHover → conexión viva).
//
// Presentacional: el desk calcula atrasados/sugerencias/próxima-cita (fuente única
// panoramaEngine) y pasa datos ya listos. Solo tokens Zentriq; microcopy CDMX.
//
// Walk-ins: en modo B se encajan al registrarlos (no hay estado "esperando") → NO
// aparecen en la cola. La sala de espera (modo A: orden, tiempos) es mejora futura.

'use client';

import { fmtMin } from './panoramaEngine';

// ─── Tipos (calculados por el desk) ────────────────────────────────────────────

export type QueueSuggestion = { staffName: string; min: number };

export type LateItem = {
  apptId: string;
  customerName: string;
  serviceName: string;
  staffName: string;    // barbero actual (dónde está apartado el lugar)
  startMin: number;     // hora efectiva mostrada ("Cita 5:15")
  lateMin: number;      // minutos de atraso (ahora − hora efectiva)
  suggestion: QueueSuggestion | null; // primer hueco compatible, o null si no hay
};

export type NextUpItem = {
  customerName: string;
  serviceName: string;
  staffName: string;
  startMin: number;
};

type ActionQueueProps = {
  lateItems: LateItem[];
  nextUp: NextUpItem | null;      // próxima cita (estado tranquilo)
  onMove: (apptId: string) => void;   // → entra al gesto click-to-place
  onNoShow: (apptId: string) => void; // → marca no_show (libera el hueco)
  onHover: (apptId: string | null) => void; // conexión viva cola↔panorama
};

// Hora sin sufijo AM/PM para las cifras compactas de la tarjeta.
function hora(min: number): string {
  return fmtMin(min).replace(' AM', '').replace(' PM', '');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActionQueue({ lateItems, nextUp, onMove, onNoShow, onHover }: ActionQueueProps) {
  const count = lateItems.length;

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col bg-canvas lg:w-[348px]"
      aria-label="Cola de acción"
    >
      {/* Cabecera — título + contador (rojo si hay cola, teal "0" en tranquilo);
          subtítulo apilado debajo, como la maqueta congelada. */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <b className="text-sm">Cola de acción</b>
          <span
            className={`rounded-pill px-2 py-0.5 text-xs font-bold tabular-nums ${
              count > 0 ? 'bg-red-tint text-red-ink' : 'bg-tint-1 text-teal-ink'
            }`}
          >
            {count}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-faint">Lo que necesita tu atención ahora</p>
      </div>

      {count === 0 ? (
        // ── Estado tranquilo ──
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-tint-1 text-teal-ink" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <b className="text-sm">Todo bajo control</b>
            <p className="max-w-[26ch] text-xs text-ink-2">
              Nadie atrasado. Cuando una cita pase de su hora sin llegar, aparece aquí.
            </p>
          </div>
          {nextUp && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
                Próxima cita
              </div>
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-avatar bg-ink text-[11px] font-semibold text-card" aria-hidden>
                  {initials(nextUp.customerName)}
                </span>
                <div className="min-w-0 leading-tight">
                  <b className="block truncate text-[13px]">{nextUp.customerName}</b>
                  <span className="text-[11px] text-faint">
                    {nextUp.serviceName || 'Cita'} · {nextUp.staffName}
                  </span>
                </div>
                <span className="ml-auto tabular-nums text-sm font-semibold">{hora(nextUp.startMin)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ── Tarjetas de atrasados ──
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
          {lateItems.map((item) => (
            <div
              key={item.apptId}
              onMouseEnter={() => onHover(item.apptId)}
              onMouseLeave={() => onHover(null)}
              className="overflow-hidden rounded-card border border-line bg-card shadow-card transition"
              style={{ borderLeft: '3px solid var(--color-red-border)' }}
            >
              {/* Top: quién + atraso */}
              <div className="flex items-center gap-2.5 px-3 pb-2 pt-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-avatar bg-red-tint text-[11px] font-semibold text-red-ink" aria-hidden>
                  {initials(item.customerName)}
                </span>
                <div className="min-w-0 leading-tight">
                  <b className="block truncate text-[13.5px]">{item.customerName}</b>
                  <span className="text-[11px] tabular-nums text-faint">
                    Cita {hora(item.startMin)} · {item.staffName}
                  </span>
                </div>
                <span className="ml-auto shrink-0 rounded-[6px] bg-red-tint px-2 py-0.5 text-[10px] font-bold tabular-nums text-red-ink">
                  Atrasado {item.lateMin} min
                </span>
              </div>

              {/* Por qué */}
              <p className="px-3 pb-2.5 text-[11.5px] leading-snug text-ink-2">
                <b className="font-semibold text-ink">Aún no llega.</b> Su lugar sigue apartado.
                Recórrelo con otro barbero o libera el hueco.
              </p>

              {/* Jugada sugerida (hint del primer hueco) */}
              <div className="mx-2.5 mb-2.5 flex items-center gap-2.5 rounded-card border border-teal-border bg-tint-1 px-2.5 py-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-teal text-card" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-teal-ink opacity-80">
                    {item.suggestion ? 'Primer hueco compatible' : 'Sin hueco libre'}
                  </div>
                  <b className="text-[12.5px] font-semibold tabular-nums text-teal-ink">
                    {item.suggestion
                      ? `${item.suggestion.staffName} · ${hora(item.suggestion.min)}`
                      : 'Hoy no queda espacio limpio'}
                  </b>
                </div>
              </div>

              {/* Acciones — "Mover" entra al gesto; "No llegó" libera */}
              <div className="flex gap-2 px-2.5 pb-2.5">
                <button
                  onClick={() => onMove(item.apptId)}
                  className="flex-1 rounded-pill bg-teal px-3 py-1.5 text-center text-sm font-bold text-card shadow-card transition hover:opacity-90"
                >
                  Mover
                </button>
                <button
                  onClick={() => onNoShow(item.apptId)}
                  className="flex-1 rounded-pill border border-line px-3 py-1.5 text-center text-sm font-semibold text-ink-2 transition hover:bg-canvas"
                >
                  Marcar no llegó
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
