// ─── FijosDelDia — los gastos fijos que tocan la puerta (M4) ──────────────────
// Client Component. Vive DENTRO del paso ② de "Cerrar el día", porque confirmar
// un fijo ES registrar un movimiento: no es un ritual aparte y no merece un paso
// propio.
//
// LA OBJECIÓN QUE ESTE COMPONENTE RESPONDE (Gabriel, 2026-09-06): un gasto
// recurrente que se configura una vez y desaparece es PEOR que anotarlo a mano —
// cuando cambie, no se encuentra y nadie se acuerda de que existía.
//
// POR ESO NADA SE REGISTRA SOLO. El fijo vence y APARECE acá; una persona lo
// confirma con un tap y ese gesto escribe el movimiento. Tres consecuencias
// buscadas:
//   · No se puede olvidar: vuelve cada período, en el camino por donde el
//     mostrador ya pasa.
//   · No se puede esconder: si nadie confirma, se queda y ENVEJECE a la vista
//     ("venció hace 3 días"). No se autoregistra y no se desvanece.
//   · El ajuste ocurre donde uno se da cuenta: el monto llega pre-llenado y
//     EDITABLE, y cambiarlo acá actualiza la plantilla — no hay que acordarse de
//     que existe un menú de configuración.
//
// La lista completa de plantillas (incluidas las que todavía no vencen) vive
// plegada abajo, en `FijosLista`.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { confirmarFijo } from '@/app/staff/caja-actions';
import type { EstadoFijo } from '@/lib/fijos';
import { textoDeVencimiento } from '@/lib/fijos';
import { etiquetaConcepto } from '@/lib/caja';
import { RAILS, type Rail } from '@/lib/cobro';

type Props = {
  /** Los estados ya calculados por el módulo (el server hace la cuenta). */
  estados: EstadoFijo[];
  /** Para releer después de confirmar. */
  onCambio: () => void;
  /** Solo se confirma parado en HOY: el movimiento se fecha hoy igual. */
  esHoy: boolean;
};

const RIEL_LABEL: Record<Rail, string> = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transfer.',
};

export default function FijosDelDia({ estados, onCambio, esHoy }: Props): React.ReactElement | null {
  const pendientes = estados.filter((e) => e.pendiente);

  const [abierto, setAbierto]   = useState<string | null>(null);
  const [monto, setMonto]       = useState('');
  const [riel, setRiel]         = useState<Rail>('efectivo');
  const [error, setError]       = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Si el que estaba abierto deja de estar pendiente (lo confirmó otra pantalla),
  // se cierra solo en vez de dejar una hoja apuntando a algo que ya no existe.
  useEffect(() => {
    if (abierto && !pendientes.some((e) => e.fijo.id === abierto)) setAbierto(null);
  }, [pendientes, abierto]);

  const abrir = useCallback((e: EstadoFijo) => {
    setMonto(String(e.fijo.amountSugerido));
    setRiel(e.fijo.methodSugerido as Rail);
    setError(null);
    setAbierto(e.fijo.id);
  }, []);

  async function confirmar(id: string) {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await confirmarFijo(id, { amount: monto, method: riel });
      if (res.error) { setError(res.error); return; }
      setAbierto(null);
      onCambio();
    } catch {
      setError('No se pudo confirmar. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  if (pendientes.length === 0) return null;

  return (
    <section
      aria-label="Gastos fijos por confirmar"
      className="rounded-card border border-amber-border bg-amber-tint px-4 py-3"
    >
      <p className="text-sm font-semibold text-amber">
        {pendientes.length === 1 ? 'Un gasto fijo por confirmar' : `${pendientes.length} gastos fijos por confirmar`}
      </p>
      <p className="mb-2 text-xs text-ink-2">
        {/* Se dice en voz alta que no se registró nada: es la diferencia entre un
            recordatorio y una automatización que escribe por vos. */}
        Nada se registró solo. Confirma lo que de verdad se pagó.
      </p>

      {error && <p className="mb-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}

      <ul className="space-y-2">
        {pendientes.map((e) => (
          <li key={e.fijo.id} className="border-t border-line pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                <b>{e.fijo.label}</b>
                <span className="ml-2 text-xs text-ink-2">{etiquetaConcepto(e.fijo.concept)}</span>
                <span className="ml-2 text-xs text-amber">{textoDeVencimiento(e)}</span>
              </span>
              {abierto !== e.fijo.id && (
                <button
                  type="button"
                  onClick={() => abrir(e)}
                  disabled={!esHoy}
                  title={esHoy ? undefined : 'El movimiento se fecha hoy: confírmalo parado en hoy'}
                  className="min-h-[36px] shrink-0 rounded-lg bg-teal-ink px-3 text-xs font-semibold text-card disabled:opacity-40"
                >
                  Confirmar
                </button>
              )}
            </div>

            {abierto === e.fijo.id && (
              <div className="mt-2 rounded-xl border border-line bg-card p-3">
                {/* Pre-llenado y EDITABLE: el ajuste ocurre donde uno se dio
                    cuenta de que subió, y de paso actualiza la plantilla. */}
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cuánto se pagó</span>
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
                    <span className="text-sm text-faint">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={monto}
                      onChange={(ev) => setMonto(ev.target.value)}
                      aria-label={`Monto pagado de ${e.fijo.label}`}
                      className="w-full bg-transparent text-base tabular-nums text-ink outline-none"
                    />
                  </div>
                </label>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {RAILS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRiel(r)}
                      aria-pressed={riel === r}
                      className={`min-h-[40px] rounded-xl border text-xs font-semibold ${
                        riel === r ? 'border-teal-border bg-tint-1 text-teal-ink' : 'border-line bg-card text-ink-2'
                      }`}
                    >
                      {RIEL_LABEL[r]}
                    </button>
                  ))}
                </div>

                {e.ultimoPago && (
                  <p className="mt-2 text-xs text-faint">
                    La vez pasada: ${e.ultimoPago.amount.toLocaleString('es-MX')} el {e.ultimoPago.occurredOn}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAbierto(null)}
                    className="min-h-[40px] flex-1 rounded-xl border border-line bg-card text-xs font-semibold text-ink-2"
                  >
                    Ahora no
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmar(e.fijo.id)}
                    disabled={guardando || monto.trim() === ''}
                    className="min-h-[40px] flex-1 rounded-xl bg-teal-ink text-xs font-semibold text-card disabled:opacity-50"
                  >
                    {guardando ? 'Guardando…' : 'Sí, se pagó'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
