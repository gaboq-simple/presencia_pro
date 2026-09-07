// ─── PeriodoCard — la semana y el mes de lo que se registró (M5) ──────────────
// Client Component. Vive al fondo del módulo de Caja, DESPUÉS del cierre del día:
// primero se resuelve hoy, después se mira para atrás.
//
// SU VALOR MAYOR NO ES EL TOTAL, es que un día sin registro se VEA. Mirando un
// día por vez eso es imposible: hay que estar parado en la fecha correcta para
// notar que está vacía. Acá el hueco salta solo.
//
// PERO UN DÍA CERRADO NO ES UN HUECO. El sistema SÍ sabe qué días abre el
// negocio (`staff_availability`), así que un domingo de cierre se pinta distinto y
// NO cuenta como "sin registro". Sin esa distinción, cualquier barbería que cierra
// los domingos vería cuatro huecos falsos por mes — y un aviso que grita en falso
// enseña a ignorarlo. Lo que queda marcado es lo que de verdad lo merece: un día
// ABIERTO sin un solo registro. Aun así no se acusa: pudo ser un día sin clientes.
//
// LO QUE ESTA TARJETA NO MUESTRA, y es deliberado:
//   · **Hoy**, mientras el corte no esté firmado. Su total sería el esperado que
//     la persona todavía tiene que contar a ciegas.
//   · **Margen, rentabilidad y reparto por barbero.** No son herramientas de
//     mostrador: nadie del mostrador decide con eso, y la raya es del dueño (P11).
//   · **Las salidas restadas del total.** Nunca. Son dos hechos distintos.

'use client';

import { useEffect, useState } from 'react';
import { getPeriodo } from '@/app/staff/caja-actions';
import type { ResumenPeriodo, RangoId } from '@/lib/periodo';

type Resumen = ResumenPeriodo & { incluyeHoy: boolean };

type Props = { timezone: string; reloadKey: number };

function fmtMonto(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** 'YYYY-MM-DD' → 'lun 1'. Fecha de calendario: no se toca ninguna tz. */
function fmtDiaCorto(fecha: string, timeZone: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { timeZone, weekday: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)));
}

export default function PeriodoCard({ timezone, reloadKey }: Props): React.ReactElement {
  const [rango, setRango]   = useState<RangoId>('semana');
  const [datos, setDatos]   = useState<Resumen | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // El guard `vivo` no es ceremonia: cambiar de semana a mes dispara una lectura
  // nueva antes de que vuelva la anterior, y sin él la respuesta vieja pisaría a
  // la nueva. De paso satisface a `react-hooks/set-state-in-effect`, que marcaba
  // el `setError(null)` de la versión anterior por no colgar de un `await`.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await getPeriodo(rango);
        if (vivo) { setDatos(r); setError(null); }
      } catch {
        if (vivo) setError('No se pudo leer el período');
      }
    })();
    return () => { vivo = false; };
  }, [rango, reloadKey]);

  // La barra más alta define la escala. Si todo es cero, no se dibuja nada — una
  // escala sobre cero pintaría barras iguales que sugieren actividad que no hubo.
  const techo = Math.max(1, ...(datos?.dias ?? []).map((d) => d.cobrado.total));

  return (
    <details className="rounded-card border border-line bg-card px-4 py-3">
      {/* "Período" era jerga: el rótulo dice directamente de qué semana o mes se
          está hablando, que es lo que la persona quiere saber al mirarlo. */}
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {rango === 'semana' ? 'Esta semana' : 'Este mes'}
        <span className="ml-2 font-normal text-faint">
          {datos ? `entró ${fmtMonto(datos.total)}` : '…'}
        </span>
      </summary>

      {error && <p className="mt-2 rounded-lg bg-red-tint px-3 py-2 text-xs text-red-ink">{error}</p>}

      <div className="mt-3 flex gap-2">
        {(['semana', 'mes'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRango(r)}
            aria-pressed={rango === r}
            className={`min-h-[36px] flex-1 rounded-xl border text-xs font-semibold capitalize ${
              rango === r ? 'border-teal-border bg-tint-1 text-teal-ink' : 'border-line bg-card text-ink-2'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {datos && (
        <>
          {/* El titular y sus dos mitades. Las salidas, línea aparte: una semana
              de $12,000 con $2,000 de gastos NO es una semana de $10,000. */}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <b className="text-xl tabular-nums text-ink">{fmtMonto(datos.total)}</b>
              <span className="ml-2 text-xs text-faint">entró</span>
            </div>
            <div className="text-xs text-ink-2">
              <span className="tabular-nums">{fmtMonto(datos.deAgenda)}</span> de citas ·{' '}
              <span className="tabular-nums">{fmtMonto(datos.entradas)}</span> sin cita
            </div>
            <div className="text-xs text-ink-2">
              salió <span className="tabular-nums font-semibold text-ink">{fmtMonto(datos.salidas)}</span>
            </div>
          </div>

          <p className="mt-1 text-xs text-faint">
            {/* Se dice por qué falta hoy, en vez de dejar que parezca un error. */}
            {datos.incluyeHoy
              ? 'Incluye hoy, que ya tiene su corte firmado.'
              : 'Hasta ayer: hoy entra cuando se firme su corte.'}
          </p>

          {/* Las barras. El hueco se ve porque el día está y su barra no. */}
          <ul className="mt-3 flex items-end gap-1" aria-label="Lo que entró cada día">
            {datos.dias.map((d) => (
              <li key={d.fecha} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span
                  className={`w-full rounded-t ${
                    d.cerrado ? 'bg-past-line' : d.enBlanco ? 'bg-line' : 'bg-teal'
                  }`}
                  style={{ height: `${d.enBlanco || d.cerrado ? 2 : Math.max(3, (d.cobrado.total / techo) * 56)}px` }}
                  title={
                    d.cerrado   ? `${d.fecha} · cerrado`
                    : d.enBlanco ? `${d.fecha} · sin registros`
                    : `${d.fecha} · ${fmtMonto(d.cobrado.total)}`
                  }
                  aria-hidden
                />
                <span className={`truncate text-[10px] ${d.cerrado ? 'text-past-ink' : 'text-faint'}`}>
                  {fmtDiaCorto(d.fecha, timezone)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-faint">
            {datos.diasEnBlanco === 0
              ? 'Todos los días abiertos del período tienen registro.'
              : `${datos.diasEnBlanco} ${datos.diasEnBlanco === 1 ? 'día abierto' : 'días abiertos'} sin un solo registro.`}
            {datos.diasCerrados > 0 && ` ${datos.diasCerrados} de cierre.`}
            {datos.mejorDia && (
              <> El mejor fue {fmtDiaCorto(datos.mejorDia.fecha, timezone)} con{' '}
              <span className="tabular-nums">{fmtMonto(datos.mejorDia.cobrado.total)}</span>.</>
            )}
          </p>
        </>
      )}
    </details>
  );
}
