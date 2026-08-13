// ─── CorteCard — el corte a ciegas (D5) ───────────────────────────────────────
// Client Component de la mesa del asistente: quien cierra el local cuenta el
// cajón, mira el voucher de la terminal, teclea dos números y guarda. RECIÉN
// AHÍ la app dice cuánto esperaba y cuánto se desvió.
//
// 🔴 A CIEGAS, y no por disciplina de quien lo usa: este componente NO tiene de
//    dónde sacar el esperado antes de guardar. No existe una action que lo
//    devuelva sin recibir el conteo (ver `caja-actions.ts`), así que ni el
//    componente, ni el network tab, ni una consola abierta pueden adelantarlo.
//    Si el número apareciera antes, el conteo dejaría de ser independiente y el
//    descuadre —lo único que esta capa produce— se volvería teatro.
//
// El vocabulario de esta card es el MISMO del guion (`onboarding/guion-corte.md`),
// escrito junto con ella: "el efectivo del cajón", "el total de la terminal",
// "esperado", "diferencia", "corregir". Si una de las dos cambia una palabra, la
// otra queda mintiendo.

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createCorte, getCortesDeHoy, type CorteRevelado } from '@/app/staff/caja-actions';
import type { CorteRow } from '@/lib/corteData';
import { fmtMonto, fmtSigned, horaCorta } from '@/lib/corte';
import { isTodayInTz } from '@/lib/dayWindow';

type Props = { date: string; timezone: string };

export default function CorteCard({ date, timezone }: Props) {
  const [cortes, setCortes]   = useState<CorteRow[] | null>(null);
  const [efectivo, setEfectivo] = useState('');
  const [terminal, setTerminal] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  // Lo que la action devolvió recién. Trae dos líneas INFORMATIVAS que no son
  // parte del corte y por eso no se guardan: las transferencias del día (fuera
  // de la comparación — no hay artefacto físico que contar) y lo cobrado sin
  // riel registrado. Al recargar la página no vuelven, y está bien: el registro
  // del corte es contado / esperado / diferencia, y eso sí queda.
  const [recien, setRecien] = useState<CorteRevelado | null>(null);

  const esHoy = isTodayInTz(date, timezone);

  const recargar = useCallback(async () => {
    try { setCortes(await getCortesDeHoy()); } catch { setError('No se pudo leer el corte'); }
  }, []);

  useEffect(() => { if (esHoy) void recargar(); }, [esHoy, recargar]);

  // El corte es SIEMPRE del día en curso: se cuenta lo que hay en el cajón
  // ahora, no lo que hubo el martes. Parado en otro día, la card no va.
  if (!esHoy) return null;

  const vigente = cortes?.[0] ?? null;
  const capturando = vigente === null || corrigiendo;

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await createCorte({
        cashCounted: efectivo,
        cardCounted: terminal,
        replacesId: corrigiendo ? vigente?.id ?? null : null,
      });
      if (res.error) { setError(res.error); return; }
      setEfectivo('');
      setTerminal('');
      setCorrigiendo(false);
      setRecien(res.corte ?? null);
      await recargar();
    } catch {
      setError('No se pudo guardar el corte. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section
      aria-label="El corte"
      className="rounded-card border border-line bg-card px-4 py-3 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">El corte</h3>
        {vigente && !corrigiendo && (
          <button
            onClick={() => { setCorrigiendo(true); setEfectivo(''); setTerminal(''); }}
            className="shrink-0 text-xs font-semibold text-teal-ink hover:underline"
          >
            Corregir
          </button>
        )}
      </div>

      {capturando ? (
        <>
          <p className="mt-0.5 text-xs text-faint">
            Cuenta el efectivo del cajón y mira el total de la terminal. Los números salen después.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">
                Efectivo del cajón
              </span>
              <div className="mt-1 flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2.5">
                <span className="text-sm text-faint">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={efectivo}
                  onChange={(e) => setEfectivo(e.target.value)}
                  placeholder="0"
                  aria-label="Efectivo del cajón"
                  className="w-full bg-transparent text-base tabular-nums text-ink outline-none placeholder:text-faint"
                />
              </div>
              {/* El esperado incluye el fondo de cambio, así que el conteo también
                  tiene que incluirlo. Sin esta línea, quien cuenta descuenta el
                  fondo "para que dé" y TODOS los días salen faltando exactamente
                  el fondo — un descuadre sistemático que además parece real. */}
              <span className="mt-1 block text-xs text-faint">Todo lo que hay, incluido el fondo.</span>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[.10em] text-faint">
                Total de la terminal
              </span>
              <div className="mt-1 flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2.5">
                <span className="text-sm text-faint">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={terminal}
                  onChange={(e) => setTerminal(e.target.value)}
                  placeholder="0"
                  aria-label="Total de la terminal"
                  className="w-full bg-transparent text-base tabular-nums text-ink outline-none placeholder:text-faint"
                />
              </div>
            </label>
          </div>

          {error && (
            <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>
          )}

          <div className="mt-3 flex gap-2">
            {corrigiendo && (
              <button
                onClick={() => { setCorrigiendo(false); setError(null); }}
                className="min-h-[44px] flex-1 rounded-xl border border-line bg-card text-sm font-semibold text-ink-2"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={() => void guardar()}
              disabled={guardando || efectivo.trim() === '' || terminal.trim() === ''}
              className="min-h-[44px] flex-1 rounded-xl bg-teal-ink text-sm font-semibold text-card disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar el corte'}
            </button>
          </div>
        </>
      ) : (
        <ResultadoCorte
          corte={vigente!}
          timezone={timezone}
          correcciones={(cortes?.length ?? 1) - 1}
          recien={recien}
        />
      )}
    </section>
  );
}

/** El resultado, revelado DESPUÉS de guardar. Dato y signo: cero adjetivos. */
function ResultadoCorte({
  corte, timezone, correcciones, recien,
}: { corte: CorteRow; timezone: string; correcciones: number; recien: CorteRevelado | null }) {
  return (
    <>
      <p className="mt-0.5 text-xs text-faint">
        Firmado por {corte.firmadoPor} · {horaCorta(corte.createdAt, timezone)}
        {correcciones > 0 && ` · corregido ${correcciones === 1 ? '1 vez' : `${correcciones} veces`}`}
      </p>

      {/* Los tres números tienen nombre. Sin este encabezado, quien lo ve por
          primera vez no sabe cuál de los tres es "lo que contó" — y el guion
          (`onboarding/guion-corte.md`) habla de "la diferencia" con esa palabra. */}
      <p className="mt-3 text-right text-[10.5px] uppercase tracking-[.08em] text-faint">
        contado · esperado · diferencia
      </p>

      <dl className="mt-1 space-y-2">
        <Linea
          etiqueta="Efectivo"
          contado={corte.cashCounted}
          esperado={corte.expectedCash}
          diff={corte.cashDiff}
        />
        <Linea
          etiqueta="Terminal"
          contado={corte.cardCounted}
          esperado={corte.expectedCard}
          diff={corte.cardDiff}
        />
      </dl>

      {/* Informativas, solo en el momento del corte: no entran a la comparación
          y no se guardan (ver el comentario de `recien` arriba). */}
      {recien && recien.transferencias > 0 && (
        <p className="mt-2 text-xs text-faint">
          Transferencias del día {fmtMonto(recien.transferencias)} · no se cuentan acá
        </p>
      )}
      {recien && recien.sinRiel > 0 && (
        <p className="mt-1 text-xs text-faint">
          {fmtMonto(recien.sinRiel)} cobrados sin forma de pago registrada
        </p>
      )}

      {/* El aviso al dueño, con su estado HONESTO. Un "no entregado" visible es
          correcto; fingir que salió sería el bug. */}
      <p className="mt-3 border-t border-line pt-2 text-xs">
        {corte.notifiedAt ? (
          <span className="text-ink-2">
            Aviso al dueño enviado · {horaCorta(corte.notifiedAt, timezone)}
          </span>
        ) : (
          <span className="text-amber">
            Aviso no entregado{corte.notifyError ? ` · ${corte.notifyError}` : ''}
          </span>
        )}
      </p>
    </>
  );
}

/** Una fila del resultado: contado, esperado y la diferencia CON SIGNO. */
function Linea({
  etiqueta, contado, esperado, diff,
}: { etiqueta: string; contado: number; esperado: number; diff: number }) {
  // Negativo = falta efectivo. Positivo = entró dinero sin capturar: es atención,
  // no alarma, y por eso ámbar y no rojo (la misma regla que la fuga del dueño).
  const tono = diff === 0 ? 'text-ink-2' : diff < 0 ? 'text-red-ink' : 'text-amber';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-ink">{etiqueta}</dt>
      <dd className="flex items-baseline gap-3 text-sm tabular-nums">
        <span className="text-ink">{fmtMonto(contado)}</span>
        <span className="text-xs text-faint">esperado {fmtMonto(esperado)}</span>
        <span className={`font-semibold ${tono}`}>{fmtSigned(diff)}</span>
      </dd>
    </div>
  );
}
