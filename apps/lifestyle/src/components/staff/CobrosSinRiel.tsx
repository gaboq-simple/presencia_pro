// ─── CobrosSinRiel — el cubo del corte, convertido en tarea (M2 de S10-ASIS-01) ─
// Client Component. Lista los cobros del día que nadie declaró cómo se pagaron y
// deja resolverlos con un tap, ANTES de contar.
//
// POR QUÉ EXISTE. `payment_method` en NULL significa "nadie declaró cómo pagaron"
// (S9-OPS-06), que es un dato honesto y distinto de "efectivo". Pero a la hora de
// contar, un cobro sin riel es plata que el conteo no puede atribuir ni a la caja
// ni a la terminal: sale como descuadre en los DOS lados sin que nada haya salido
// mal. Hasta hoy eso solo se veía DESPUÉS de firmar, como un número en el corte
// (`CorteCard.tsx`, `caja_cortes.sin_riel_snapshot`) — o sea, cuando ya no se
// podía hacer nada. Acá se ve antes, con nombre y hora, y se arregla en su ORIGEN.
//
// EL CORTE SIGUE CIEGO. Se muestra el monto de CADA cobro —hace falta para
// reconocerlo, y ya está a la vista en la ficha de la cita y en la lista de
// caja— pero NUNCA su suma: un subtotal sería un pedazo del esperado del día
// antes de contarlo. Por eso el encabezado dice cuántos son, no cuánto suman.
//
// LA LISTA SE ARMA CON EL PREDICADO DEL CORTE, no con el de la agenda: por
// `completed_at` dentro del día local, que es la atribución del dinero (D6). Una
// cita de ayer cobrada hoy pertenece a este cierre aunque no esté en la agenda de
// hoy — ver `lib/corteData.ts:getCobrosSinRiel`.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { listarCobrosSinRiel, asignarRiel } from '@/app/staff/assistant-actions';
import type { CobroSinRiel } from '@/lib/corteData';
import { RAILS, type Rail } from '@/lib/cobro';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  date: string;
  timezone: string;
  /** Cambia cuando el día se movió (cerrar una cita crea cobros nuevos). */
  reloadKey: number;
  /** Reporta el pendiente al encabezado del paso. `null` = todavía no se sabe. */
  onCount?: (n: number | null) => void;
};

const RIEL_LABEL: Record<Rail, string> = {
  efectivo:      'Efectivo',
  tarjeta:       'Tarjeta',
  transferencia: 'Transfer.',
};

function fmtMonto(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtHora(iso: string | null, tz: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CobrosSinRiel({
  date, timezone, reloadKey, onCount,
}: Props): React.ReactElement | null {
  const [items, setItems]   = useState<CobroSinRiel[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setItems(await listarCobrosSinRiel(date));
    } catch {
      setError('No se pudieron leer los cobros sin declarar');
    }
  }, [date]);

  useEffect(() => { void recargar(); }, [recargar, reloadKey]);

  // `null` mientras se lee, y NO 0: un "listo" antes de saber es una afirmación
  // sobre algo que todavía no se consultó. El encabezado prefiere no decir nada.
  useEffect(() => { onCount?.(items === null ? null : items.length); }, [items, onCount]);

  async function declarar(id: string, riel: Rail) {
    if (guardando) return;
    setGuardando(id);
    setError(null);
    try {
      const res = await asignarRiel(id, riel);
      if (res?.error) {
        setError(res.error);
        // El motivo típico del rechazo es que otra persona lo declaró primero, así
        // que la lista se re-lee: quedarse con la fila vieja mostraría trabajo
        // pendiente que ya no existe.
        await recargar();
        return;
      }
      setItems((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch {
      setError('No se pudo declarar. Intenta de nuevo.');
    } finally {
      setGuardando(null);
    }
  }

  // Nada pendiente: el paso no ocupa lugar. El encabezado ya dijo "listo".
  if (items !== null && items.length === 0 && !error) return null;

  return (
    <section
      aria-label="Cobros sin riel declarado"
      className="rounded-card border border-line bg-card px-4 py-3 shadow-card"
    >
      {error && (
        <p className="mb-2 rounded-lg bg-amber-tint px-3 py-2 text-xs text-amber">{error}</p>
      )}

      {items === null ? (
        <p className="text-xs text-faint">Leyendo…</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                <b className="tabular-nums">{fmtMonto(c.monto)}</b>
                <span className="ml-2 text-ink-2">{c.cliente ?? 'Sin cliente'}</span>
                <span className="ml-2 text-xs tabular-nums text-faint">
                  {fmtHora(c.completadoAt, timezone)}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                {RAILS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void declarar(c.id, r)}
                    disabled={guardando !== null}
                    className="min-h-[36px] rounded-pill border border-line bg-card px-3 text-xs font-semibold text-ink-2 transition hover:border-teal-border hover:bg-tint-1 hover:text-teal-ink enabled:active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-ink"
                  >
                    {RIEL_LABEL[r]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
