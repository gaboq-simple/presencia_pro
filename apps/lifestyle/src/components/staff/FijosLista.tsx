// ─── FijosLista — las plantillas, con su próxima fecha y su último pago real ──
// Client Component. Plegada al fondo del módulo de Caja: se consulta poco, pero
// **tiene que poder consultarse**. Ese es el otro medio de la objeción que originó
// M4 — un fijo que se configura una vez y no se encuentra después es peor que no
// tenerlo, porque nadie se acuerda de que existe.
//
// EL "ÚLTIMO PAGO" NO ES UN CAMPO GUARDADO: sale de los movimientos que apuntan a
// la plantilla (`caja_movimientos.fijo_id`). Una columna cacheada exige a alguien
// que la mueva, y el día que nadie la mueva miente en silencio; el movimiento, en
// cambio, es el hecho.
//
// DESACTIVAR Y NO BORRAR: los movimientos que ya apuntan a un fijo tienen que
// poder seguir explicando de dónde salieron.

'use client';

import { useState } from 'react';
import { crearFijo, desactivarFijo } from '@/app/staff/caja-actions';
import type { EstadoFijo } from '@/lib/fijos';
import { textoDeVencimiento } from '@/lib/fijos';
import { CONCEPTOS_POR_TIPO, etiquetaConcepto } from '@/lib/caja';
import { RAILS, type Rail } from '@/lib/cobro';

type Props = { estados: EstadoFijo[]; onCambio: () => void };

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const RIEL_LABEL: Record<Rail, string> = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transfer.',
};

function cuando(e: EstadoFijo): string {
  const f = e.fijo;
  return f.cadencia === 'mensual'
    ? `cada día ${f.diaDelMes} del mes`
    : `cada ${DIAS_SEMANA[f.diaDeSemana ?? 1]}`;
}

export default function FijosLista({ estados, onCambio }: Props): React.ReactElement {
  const [nuevo, setNuevo] = useState(false);
  const [label, setLabel] = useState('');
  const [concepto, setConcepto] = useState('renta');
  const [monto, setMonto] = useState('');
  const [riel, setRiel] = useState<Rail>('transferencia');
  const [cadencia, setCadencia] = useState<'mensual' | 'semanal'>('mensual');
  const [dia, setDia] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await crearFijo({
        concept: concepto, label, amount: monto, method: riel, cadencia,
        diaDelMes:   cadencia === 'mensual' ? Number(dia) : null,
        diaDeSemana: cadencia === 'semanal' ? Number(dia) : null,
      });
      if (res.error) { setError(res.error); return; }
      setNuevo(false); setLabel(''); setMonto('');
      onCambio();
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(id: string) {
    setError(null);
    try {
      const res = await desactivarFijo(id);
      if (res.error) { setError(res.error); return; }
      onCambio();
    } catch {
      setError('No se pudo quitar. Intenta de nuevo.');
    }
  }

  return (
    <details className="rounded-card border border-line bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        Gastos fijos
        <span className="ml-2 font-normal text-faint">
          {estados.length === 0 ? 'ninguno todavía' : `${estados.length} declarados`}
        </span>
      </summary>

      {error && <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}

      <p className="mt-2 text-xs text-faint">
        {/* Se dice explícito para que nadie espere un cobro automático. */}
        Un fijo es un recordatorio, no un cobro automático: cada período aparece para
        que alguien confirme lo que de verdad se pagó.
      </p>

      {estados.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {estados.map((e) => (
            <li key={e.fijo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                <b>{e.fijo.label}</b>
                <span className="ml-2 text-xs text-ink-2">
                  {etiquetaConcepto(e.fijo.concept)} · {cuando(e)}
                </span>
                <span className={`ml-2 text-xs ${e.pendiente ? 'text-amber' : 'text-faint'}`}>
                  {textoDeVencimiento(e)}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-2">
                {e.ultimoPago
                  ? `última vez $${e.ultimoPago.amount.toLocaleString('es-MX')}`
                  : `sugerido $${e.fijo.amountSugerido.toLocaleString('es-MX')}`}
              </span>
              <button
                type="button"
                onClick={() => void quitar(e.fijo.id)}
                className="shrink-0 text-xs font-semibold text-faint transition hover:text-red-ink"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {!nuevo ? (
        <button
          type="button"
          onClick={() => setNuevo(true)}
          className="mt-3 min-h-[36px] rounded-pill border border-teal-border bg-tint-1 px-3 text-xs font-semibold text-teal-ink"
        >
          + Gasto fijo
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-line p-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cómo se llama</span>
            <input
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej. renta del local"
              aria-label="Nombre del gasto fijo"
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-base text-ink outline-none placeholder:text-faint"
            />
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {CONCEPTOS_POR_TIPO.salida.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConcepto(c)}
                aria-pressed={concepto === c}
                className={`min-h-[40px] rounded-xl border text-xs font-semibold ${
                  concepto === c ? 'border-teal-border bg-tint-1 text-teal-ink' : 'border-line bg-card text-ink-2'
                }`}
              >
                {etiquetaConcepto(c)}
              </button>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">Cuánto suele ser</span>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
              <span className="text-sm text-faint">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0"
                aria-label="Monto sugerido"
                className="w-full bg-transparent text-base tabular-nums text-ink outline-none placeholder:text-faint"
              />
            </div>
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['mensual', 'semanal'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setCadencia(c); setDia(c === 'mensual' ? '1' : '1'); }}
                aria-pressed={cadencia === c}
                className={`min-h-[40px] rounded-xl border text-xs font-semibold capitalize ${
                  cadencia === c ? 'border-teal-border bg-tint-1 text-teal-ink' : 'border-line bg-card text-ink-2'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">
              {cadencia === 'mensual' ? 'Qué día del mes' : 'Qué día de la semana'}
            </span>
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              aria-label={cadencia === 'mensual' ? 'Día del mes' : 'Día de la semana'}
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-base text-ink outline-none"
            >
              {cadencia === 'mensual'
                ? Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))
                : DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            {cadencia === 'mensual' && Number(dia) > 28 && (
              <span className="mt-1 block text-xs text-faint">
                En los meses más cortos vence el último día.
              </span>
            )}
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setNuevo(false)}
              className="min-h-[40px] flex-1 rounded-xl border border-line bg-card text-xs font-semibold text-ink-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || label.trim() === '' || monto.trim() === ''}
              className="min-h-[40px] flex-1 rounded-xl bg-teal-ink text-xs font-semibold text-card disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
