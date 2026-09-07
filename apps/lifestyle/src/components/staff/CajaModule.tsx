// ─── CajaModule — el módulo de Caja del Asistente ─────────────────────────────
// Client Component. M1 lo creó como mudanza; M2 le da su forma: el cierre del día
// deja de estar partido en tres bloques dispersos y pasa a ser UN flujo en el
// orden real, con lo que falta a la vista.
//
// EL ORDEN NO ES ESTÉTICO — CADA PASO ALIMENTA AL SIGUIENTE:
//   ① Citas sin cerrar   → resolverlas CREA cobros, y algunos nacen sin riel.
//   ② Movimientos        → lo que no pasó por la agenda entra antes de contar.
//   ③ Cobros sin declarar→ asignar el riel cambia el reparto efectivo/tarjeta.
//   ④ Contar             → recién acá tiene sentido, con todo lo anterior adentro.
// Contar primero y resolver después obliga a volver a contar. Por eso el orden.
//
// ES UNA LISTA, NO UN WIZARD. Ningún paso bloquea al siguiente: se puede contar
// con cabos pendientes y el corte sigue siendo válido (cuenta lo que hay). Los
// pasos SEÑALAN lo que falta; no le ponen una puerta a la operación del día.
//
// LOS BADGES SOLO ESTÁN EN ① Y ③, que son los únicos con noción real de
// "pendiente". ② y ④ no llevan: su tarjeta ya dice todo, y un badge ahí obligaría
// a una segunda consulta para repetir lo que se ve abajo.
//
// LA CEGUERA DEL CORTE NO SE TOCA. Ningún paso muestra un TOTAL del día: ③ dice
// cuántos cobros faltan, nunca cuánto suman. El monto de cada cobro sí se ve
// —hace falta para reconocerlo— pero la suma sería un pedazo del esperado antes
// de contarlo. `CorteCard` sigue sin poder revelar nada antes de firmar.

'use client';

import { useCallback, useEffect, useState } from 'react';
import CajaMovimientos from './CajaMovimientos';
import CorteCard from './CorteCard';
import CobrosSinRiel from './CobrosSinRiel';
import FijosDelDia from './FijosDelDia';
import FijosLista from './FijosLista';
import PeriodoCard from './PeriodoCard';
import { isTodayInTz } from '@/lib/dayWindow';
import { listarFijos } from '@/app/staff/caja-actions';
import type { EstadoFijo } from '@/lib/fijos';
import type { CaboSuelto } from '@/app/staff/cabos-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  date: string;
  timezone: string;
  /** `null` mientras carga. */
  cabos: { total: number; lista: CaboSuelto[] } | null;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void | Promise<void>;
  /** Cambia cuando se cierra una cita: dispara la relectura de ③ y de los fijos. */
  reloadKey: number;
  /** Avisa que se escribió un movimiento (confirmar un fijo escribe uno). */
  onMovimiento?: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtFechaCabo(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

function fmtFechaTitulo(date: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)));
}

/** Encabezado de un paso: número, título y —solo si aplica— lo que falta. */
function PasoHeader({
  n, titulo, pendientes,
}: { n: number; titulo: string; pendientes?: number | null }): React.ReactElement {
  const listo = pendientes === 0;
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-pill text-[11px] font-bold ${
          listo ? 'bg-tint-1 text-teal-ink' : 'bg-canvas text-ink-2'
        }`}
        aria-hidden
      >
        {n}
      </span>
      <h3 className="text-sm font-semibold text-ink">{titulo}</h3>
      {pendientes != null && (
        <span
          className={`ml-auto rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
            listo ? 'text-teal-ink' : 'bg-amber-tint text-amber'
          }`}
        >
          {listo ? 'listo' : `${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}`}
        </span>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CajaModule({
  date, timezone, cabos, onComplete, onNoShow, reloadKey, onMovimiento,
}: Props): React.ReactElement {
  const esHoy = isTodayInTz(date, timezone);
  const [sinRiel, setSinRiel] = useState<number | null>(null);

  // Los fijos (M4). El estado —qué vence, qué está pendiente, cuánto se pagó la
  // última vez— lo calcula el módulo puro en el server; acá solo se muestra.
  const [fijos, setFijos] = useState<EstadoFijo[] | null>(null);
  // Confirmar un fijo ESCRIBE un movimiento, así que la lista de caja tiene que
  // enterarse. Sin este contador se quedaba mostrando el estado anterior al gesto
  // que acababa de ocurrir — cazado en la ruta real, no por los gates.
  const [escrituras, setEscrituras] = useState(0);
  const recargarFijos = useCallback(() => {
    void listarFijos().then(setFijos).catch(() => setFijos([]));
  }, []);
  // `reloadKey` también los mueve: confirmar un fijo escribe un movimiento, y
  // registrar un movimiento puede satisfacer un fijo.
  useEffect(() => { recargarFijos(); }, [recargarFijos, reloadKey]);

  const fijosPendientes = fijos === null ? null : fijos.filter((f) => f.pendiente).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
      <header className="px-1">
        {/* `capitalize` solo en la fecha: `Intl` la rinde en minúsculas
            ("viernes, 4 de septiembre") y ahí sí hace falta. Aplicado al título
            de hoy lo rompía en "Cerrar El Día". */}
        <h2 className="text-base font-semibold text-ink">
          {esHoy
            ? 'Cerrar el día'
            : <span className="capitalize">{fmtFechaTitulo(date, timezone)}</span>}
        </h2>
        <p className="text-xs text-faint">
          {esHoy
            ? 'Cuatro cosas, en este orden. Ninguna te frena: puedes contar la caja aunque falte algo.'
            : 'Lo que se registró ese día. El conteo solo se captura el mismo día.'}
        </p>
      </header>

      {/* ① Citas sin cerrar — ya NO en un acordeón cerrado rotulado "de los
          últimos 14 días". El gesto más frecuente del día estaba archivado como
          excepción (R1 punto 3); acá está abierto, y en la agenda "Terminó" ahora
          vive en el camino principal (P8, mismo paso). */}
      <section className="flex flex-col gap-2" aria-label="Citas por resolver">
        <PasoHeader n={1} titulo="Citas por resolver" pendientes={cabos?.total ?? null} />
        {cabos && cabos.total > 0 && (
          <div className="rounded-card border border-amber-border bg-amber-tint px-4 py-3 text-sm">
            <p className="mb-2 text-xs text-ink-2">De los últimos 14 días</p>
            <ul className="space-y-2">
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
          </div>
        )}
      </section>

      {/* ② Movimientos del día (D4) — el dinero que no pasó por la agenda, más
          los fijos que vencieron. Los fijos van ADENTRO de este paso y no en uno
          propio porque confirmar un fijo ES registrar un movimiento: no es un
          ritual aparte. El badge cuenta los que están tocando la puerta. */}
      <section className="flex flex-col gap-2" aria-label="Lo que entró y salió">
        <PasoHeader n={2} titulo="Lo que entró y salió" pendientes={fijosPendientes} />
        <FijosDelDia
          estados={fijos ?? []}
          onCambio={() => { recargarFijos(); setEscrituras((n) => n + 1); onMovimiento?.(); }}
          esHoy={esHoy}
        />
        <CajaMovimientos date={date} timezone={timezone} reloadKey={escrituras} />
      </section>

      {/* ③ Cobros sin declarar — el cubo `sinRiel` del corte, como tarea y ANTES
          de contar. Hasta hoy este número solo aparecía DESPUÉS de firmar. */}
      <section className="flex flex-col gap-2" aria-label="Falta decir cómo pagaron">
        <PasoHeader n={3} titulo="Falta decir cómo pagaron" pendientes={sinRiel} />
        <CobrosSinRiel
          date={date}
          timezone={timezone}
          reloadKey={reloadKey}
          onCount={setSinRiel}
        />
      </section>

      {/* ④ Contar (D5) — a ciegas, como siempre. Se auto-oculta si no es hoy. */}
      {esHoy && (
        <section className="flex flex-col gap-2" aria-label="Contar la caja">
          <PasoHeader n={4} titulo="Contar la caja" />
          <CorteCard date={date} timezone={timezone} />
        </section>
      )}

      {/* ── Fuera del cierre ────────────────────────────────────────────────
          Lo de abajo NO es parte de las cuatro cosas: son dos cajones que se
          consultan de vez en cuando. Estaban intercalados entre el paso 3 y el
          4, y ahí rompían la cuenta —el encabezado promete cuatro pasos y se
          leían seis bloques—. Van después del flujo, plegados, para que el
          cierre se lea de una sola pasada (M5b). */}
      <div className="mt-2 flex flex-col gap-3 border-t border-line pt-3">
        {/* Las plantillas: se consultan poco pero tienen que poder consultarse —
            un fijo que no se encuentra es peor que no tenerlo. */}
        <FijosLista estados={fijos ?? []} onCambio={recargarFijos} />

        {/* La semana y el mes. Llega hasta ayer mientras el corte de hoy no esté
            firmado: incluirlo revelaría el esperado que hay que contar a ciegas. */}
        <PeriodoCard timezone={timezone} reloadKey={reloadKey + escrituras} />
      </div>
    </div>
  );
}
