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

import { useState } from 'react';
import CajaMovimientos from './CajaMovimientos';
import CorteCard from './CorteCard';
import CobrosSinRiel from './CobrosSinRiel';
import { isTodayInTz } from '@/lib/dayWindow';
import type { CaboSuelto } from '@/app/staff/cabos-actions';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  date: string;
  timezone: string;
  /** `null` mientras carga. */
  cabos: { total: number; lista: CaboSuelto[] } | null;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void | Promise<void>;
  /** Cambia cuando se cierra una cita: dispara la relectura de ③. */
  reloadKey: number;
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
  date, timezone, cabos, onComplete, onNoShow, reloadKey,
}: Props): React.ReactElement {
  const esHoy = isTodayInTz(date, timezone);
  const [sinRiel, setSinRiel] = useState<number | null>(null);

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
            ? 'En este orden: lo que quedó abierto, lo que entró y salió, lo que falta declarar, y al final se cuenta.'
            : 'Lo que se registró ese día. El conteo solo se captura el mismo día.'}
        </p>
      </header>

      {/* ① Citas sin cerrar — ya NO en un acordeón cerrado rotulado "de los
          últimos 14 días". El gesto más frecuente del día estaba archivado como
          excepción (R1 punto 3); acá está abierto, y en la agenda "Terminó" ahora
          vive en el camino principal (P8, mismo paso). */}
      <section className="flex flex-col gap-2" aria-label="Citas sin cerrar">
        <PasoHeader n={1} titulo="Citas sin cerrar" pendientes={cabos?.total ?? null} />
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

      {/* ② Movimientos del día (D4) — el dinero que no pasó por la agenda. */}
      <section className="flex flex-col gap-2" aria-label="Movimientos del día">
        <PasoHeader n={2} titulo="Movimientos del día" />
        <CajaMovimientos date={date} timezone={timezone} />
      </section>

      {/* ③ Cobros sin declarar — el cubo `sinRiel` del corte, como tarea y ANTES
          de contar. Hasta hoy este número solo aparecía DESPUÉS de firmar. */}
      <section className="flex flex-col gap-2" aria-label="Cobros sin declarar">
        <PasoHeader n={3} titulo="Cobros sin declarar" pendientes={sinRiel} />
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
    </div>
  );
}
