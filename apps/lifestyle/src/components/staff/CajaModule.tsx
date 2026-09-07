// ─── CajaModule — el módulo de Caja del Asistente (M1 de S10-ASIS-01) ─────────
// Client Component. En M1 este archivo NO agrega nada: recibe las tres piezas de
// dinero que hasta hoy vivían apiladas encima de la mesa de control y les da un
// lugar propio. Verbatim, mismo markup, mismos tokens.
//
// POR QUÉ EXISTE. En la vista vieja el orden vertical estaba invertido respecto de
// la frecuencia de uso: la agenda —que el mostrador toca doscientas veces al día—
// quedaba DEBAJO de dos tarjetas de dinero que se tocan cinco o diez. El corte ya
// separaba lo del día de lo de siempre, los cabos ya separaban lo pasado sin
// cerrar y la caja ya separaba el dinero que no es la agenda: los módulos estaban
// ahí, mezclados en una columna. Esto no inventa una estructura, la hace visible.
//
// EL ORDEN DE ADENTRO ES EL ORDEN REAL DEL DÍA y se conserva de la vista vieja:
// primero lo pasado sin cerrar, después lo que entró y salió, al final se cuenta.
// M2 lo convierte en un flujo explícito ("Cerrar el día") y le agrega la lista
// accionable de cobros sin riel; hasta entonces, esto es una mudanza.
//
// LA CEGUERA DEL CORTE NO SE TOCA. `CorteCard` sigue sin poder mostrar el esperado
// antes de firmar (decisión de Gabriel, 2026-09-06, sin excepción en toda la ola).
// Que la caja ahora sea un módulo visible no le da a nadie un número que antes no
// tenía: con el corte a ciegas, un descuadre es un hecho del mundo y no una
// sospecha sobre quien contó.

'use client';

import CajaMovimientos from './CajaMovimientos';
import CorteCard from './CorteCard';
import type { CaboSuelto } from '@/app/staff/cabos-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  date: string;
  timezone: string;
  /** `null` mientras carga; el bloque solo aparece con total > 0 (igual que antes). */
  cabos: { total: number; lista: CaboSuelto[] } | null;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void | Promise<void>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Movido desde `AssistantControlDesk` con el bloque de cabos: su único llamador. */
function fmtFechaCabo(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CajaModule({
  date,
  timezone,
  cabos,
  onComplete,
  onNoShow,
}: Props): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {/* Cabos sueltos (D3) — lo pasado sin resolver se VE. Una cita sin cerrar
          no suma al cobrado ni cuenta como falta: se evapora del cuadre. Acá se
          resuelve inline con las mismas actions de siempre. */}
      {cabos && cabos.total > 0 && (
        <details className="rounded-card border border-amber-border bg-amber-tint px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-amber">
            {cabos.total === 1 ? '1 cita sin cerrar' : `${cabos.total} citas sin cerrar`}
            <span className="ml-2 font-normal text-ink-2">· de los últimos 14 días</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {cabos.lista.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-t border-line pt-2">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {c.cliente ?? 'Sin cliente'}
                  <span className="ml-2 text-xs tabular-nums text-ink-2">{fmtFechaCabo(c.startsAtMs, timezone)}</span>
                  {c.llego && <span className="ml-2 text-xs text-teal-ink">llegó</span>}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => onComplete(c.id)}
                    className="min-h-[36px] rounded-lg bg-teal-ink px-3 text-xs font-semibold text-card"
                  >
                    Terminó
                  </button>
                  <button
                    onClick={() => void onNoShow(c.id)}
                    className="min-h-[36px] rounded-lg border border-line bg-card px-3 text-xs font-semibold text-ink-2"
                  >
                    No vino
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Caja del día (D4) — el dinero que NO pasa por la agenda. */}
      <CajaMovimientos date={date} timezone={timezone} />

      {/* El corte (D5) — el cierre del día, debajo de los movimientos porque eso
          es lo que pasa: primero se registra lo del día, al final se cuenta. Se
          auto-oculta si el día que se mira no es hoy. */}
      <CorteCard date={date} timezone={timezone} />
    </div>
  );
}
