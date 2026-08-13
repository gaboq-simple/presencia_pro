// ─── CajaMovimientos — el dinero que no pasó por la agenda (D4) ───────────────
// Client Component compartido por la mesa del asistente y la pestaña Hoy del
// barbero. Uno solo para las dos superficies, por la misma razón que CobroFields:
// duplicarlo garantiza que se separen a la primera corrección, y este gesto tiene
// que ser IDÉNTICO en las dos — quien registra un walk-in hoy en recepción mañana
// lo registra desde la silla.
//
// Tres taps para el caso frecuente: monto → concepto → Registrar. El tipo arranca
// en "Entró" (la mayoría de los movimientos lo son) y el riel en efectivo
// (decisión 2 del plan: nunca NULL, un tap para cambiarlo). El concepto NO trae
// default a propósito: si viniera preseleccionado, el que va con prisa guardaría
// todo como "Sin cita" y el concepto dejaría de significar nada.
//
// Lo que este componente NO hace, a propósito: sumar. Nada de "neto del día" —
// netear salidas contra entradas en un mismo número está prohibido por el plan, y
// los totales por riel son del corte (D5), que los congela.

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  createCajaMovimiento,
  reverseCajaMovimiento,
  listCajaDia,
  type MovimientoDelDia,
} from '@/app/staff/caja-actions';
import {
  CONCEPTOS_POR_TIPO,
  MOV_TYPES,
  NOTA_MAX,
  etiquetaTipo,
  etiquetaConcepto,
  notaPlaceholder,
  fmtMonto,
  type MovimientoType,
} from '@/lib/caja';
import { RAILS, DEFAULT_RAIL, type Rail } from '@/lib/cobro';
import { railLabel } from './CobroFields';
import { isTodayInTz } from '@/lib/dayWindow';

type Props = {
  /** Día que mira la superficie ('YYYY-MM-DD'). */
  date:     string;
  timezone: string;
};

function fmtHora(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

export default function CajaMovimientos({ date, timezone }: Props) {
  const [movs, setMovs]       = useState<MovimientoDelDia[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Formulario de la hoja.
  const [tipo, setTipo]         = useState<MovimientoType>('entrada');
  const [concepto, setConcepto] = useState<string | null>(null);
  const [monto, setMonto]       = useState('');
  const [riel, setRiel]         = useState<Rail>(DEFAULT_RAIL);
  const [nota, setNota]         = useState('');

  // El movimiento se registra SIEMPRE en el día de hoy (la action calcula
  // `occurred_on` en la tz del negocio). Ofrecer "+ Movimiento" parado en otro día
  // sería una trampa: la fila caería en hoy igual, en una lista que no se está
  // mirando.
  const esHoy = isTodayInTz(date, timezone);

  const recargar = useCallback(async () => {
    try {
      setMovs(await listCajaDia(date));
    } catch {
      setError('No se pudo leer la caja');
    }
  }, [date]);

  useEffect(() => { void recargar(); }, [recargar]);

  function abrir() {
    setTipo('entrada');
    setConcepto(null);
    setMonto('');
    setRiel(DEFAULT_RAIL);
    setNota('');
    setError(null);
    setAbierta(true);
  }

  function cambiarTipo(t: MovimientoType) {
    setTipo(t);
    setConcepto(null); // los conceptos de entrada y salida no se cruzan
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await createCajaMovimiento({
        type: tipo, concept: concepto, amount: monto, method: riel, note: nota,
      });
      if (res.error) { setError(res.error); return; }
      setAbierta(false);
      await recargar();
    } catch {
      setError('No se pudo registrar. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function anular(id: string) {
    setError(null);
    try {
      const res = await reverseCajaMovimiento(id);
      if (res.error) { setError(res.error); return; }
      await recargar();
    } catch {
      setError('No se pudo anular. Intenta de nuevo.');
    }
  }

  // Día pasado y sin movimientos: no hay nada que decir ni nada que registrar.
  if (!esHoy && movs.length === 0) return null;

  return (
    <section
      aria-label="Caja del día"
      className="rounded-card border border-line bg-card px-4 py-3 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Caja del día</h3>
          <p className="text-xs text-faint">Lo que no pasó por la agenda</p>
        </div>
        {esHoy && (
          <button
            onClick={abrir}
            className="shrink-0 rounded-pill border border-teal-border bg-tint-1 px-3 py-1.5 text-sm font-semibold text-teal-ink transition hover:bg-tint-2 active:scale-95"
          >
            + Movimiento
          </button>
        )}
      </div>

      {movs.length === 0 ? (
        <p className="mt-3 text-xs text-faint">Todavía nada por aquí.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {movs.map((m) => {
            const anulado    = m.anuladoPorId !== null;
            const esAnulacion = m.reversesId !== null;
            const signo = m.type === 'entrada' ? '+' : '−';
            return (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 border-t border-line pt-1.5 text-sm first:border-t-0 first:pt-0"
              >
                <div className={`min-w-0 ${anulado ? 'line-through opacity-60' : ''}`}>
                  <p className="text-ink">
                    <span
                      className={`font-semibold tabular-nums ${
                        m.type === 'entrada' ? 'text-teal-ink' : 'text-ink-2'
                      }`}
                    >
                      {signo}{fmtMonto(m.amount)}
                    </span>
                    <span className="text-ink-2">
                      {' · '}{esAnulacion ? 'Anulación' : etiquetaConcepto(m.concept)}
                      {' · '}{railLabel(m.method as Rail)}
                    </span>
                  </p>
                  <p className="truncate text-xs text-faint">
                    {m.autor} · <span className="tabular-nums">{fmtHora(m.createdAt, timezone)}</span>
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>

                {/* Anular = fila nueva que apunta a esta (decisión 10: nada se
                    edita ni se borra). Una anulación no se anula. */}
                {esHoy && !anulado && !esAnulacion && (
                  <button
                    onClick={() => void anular(m.id)}
                    className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
                  >
                    Anular
                  </button>
                )}
                {anulado && <span className="shrink-0 text-xs text-faint">anulado</span>}
              </li>
            );
          })}
        </ul>
      )}

      {error && !abierta && (
        <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>
      )}

      {/* ── La hoja ──────────────────────────────────────────────────────── */}
      {abierta && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30"
          onClick={() => setAbierta(false)}
        >
          <div
            className="animate-card-in max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-card border border-line bg-card px-4 pb-8 pt-3 shadow-hero"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <p className="text-lg font-semibold text-ink">Movimiento de caja</p>
            <p className="mb-4 text-sm text-ink-2">Dinero que no pasó por la agenda</p>

            {/* Entró / Salió — el signo del dinero, primero */}
            <div className="grid grid-cols-2 gap-2">
              {MOV_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => cambiarTipo(t)}
                  aria-pressed={tipo === t}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold ${
                    tipo === t
                      ? 'border-teal-border bg-tint-1 text-teal-ink'
                      : 'border-line bg-card text-ink-2'
                  }`}
                >
                  {etiquetaTipo(t)}
                </button>
              ))}
            </div>

            {/* Monto */}
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cuánto</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
                <span className="text-sm text-faint">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0"
                  aria-label="Monto del movimiento"
                  className="w-full bg-transparent text-base tabular-nums text-ink outline-none placeholder:text-faint"
                />
              </div>
            </label>

            {/* Concepto — sin default: el tap es el dato */}
            <div className="mt-4">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">De qué</span>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {CONCEPTOS_POR_TIPO[tipo].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setConcepto(c)}
                    aria-pressed={concepto === c}
                    className={`min-h-[44px] rounded-xl border text-sm font-semibold ${
                      concepto === c
                        ? 'border-teal-border bg-tint-1 text-teal-ink'
                        : 'border-line bg-card text-ink-2'
                    }`}
                  >
                    {etiquetaConcepto(c)}
                  </button>
                ))}
              </div>
            </div>

            {/* Riel */}
            <div className="mt-4">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cómo</span>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {RAILS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRiel(r)}
                    aria-pressed={riel === r}
                    className={`min-h-[44px] rounded-xl border text-sm font-semibold ${
                      riel === r
                        ? 'border-teal-border bg-tint-1 text-teal-ink'
                        : 'border-line bg-card text-ink-2'
                    }`}
                  >
                    {railLabel(r)}
                  </button>
                ))}
              </div>
            </div>

            {/* Nota — opcional. El ejemplo habla de COSAS: esta línea la lee el
                dueño en Actividad y no es lugar para el nombre de nadie. */}
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Nota (opcional)</span>
              <input
                type="text"
                value={nota}
                maxLength={NOTA_MAX}
                onChange={(e) => setNota(e.target.value)}
                placeholder={notaPlaceholder(concepto ?? 'otro')}
                aria-label="Nota del movimiento"
                className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base text-ink outline-none placeholder:text-faint"
              />
            </label>

            {error && (
              <p className="mt-3 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setAbierta(false)}
                className="min-h-[44px] flex-1 rounded-xl border border-line bg-card text-sm font-semibold text-ink-2"
              >
                Cancelar
              </button>
              <button
                onClick={() => void guardar()}
                disabled={guardando || concepto === null || monto.trim() === ''}
                className="min-h-[44px] flex-1 rounded-xl bg-teal-ink text-sm font-semibold text-card disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
