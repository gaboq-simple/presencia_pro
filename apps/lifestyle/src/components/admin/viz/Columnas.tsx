// ─── Columnas — magnitud a lo largo del tiempo (días, semanas, meses) ─────────
// Server Component presentacional. Cada columna es pista + relleno desde la BASE;
// la pista da la referencia del máximo (sin ella, "poco" y "mucho" se ven igual).
//
// Movimiento: `animate-viz-grow-y` + `origin-bottom` — crece desde el eje, con el
// retraso de su índice. En una serie temporal el índice es el orden del tiempo, así
// que la entrada se lee como el paso de los días.
//
// El alto de la pista es fijo (h-16): un % sobre un ancestro sin altura definida
// renderiza 0px — bug ya atrapado en PR-Neg-1, no repetirlo.

import type { CSSProperties } from 'react';

export type ColumnaDato = {
  /** Etiqueta corta bajo la columna (L, M, X… o "ene"). */
  label:  string;
  /** Alto del relleno en % (0–100). Usar `pctWidth` de `lib/viz`. */
  pct:    number;
  /** Valor ya formateado, opcional, sobre la columna. */
  valor?: string;
  /** Marca la columna "de hoy"/en curso: anillo, no color distinto. */
  actual?: boolean;
  /** Color del anillo. `teal` (default) = "es este"; `ambar` = "acá hay lugar".
   *  Dos marcas distintas sobre la MISMA forma: el anillo señala, el relleno
   *  mide. Pintar el relleno de otro color mezclaría las dos cosas. */
  anillo?: 'teal' | 'ambar';
  /** Día sin horario (cerrado): pista rayada, no columna vacía — no es "cero ventas". */
  cerrado?: boolean;
};

export function Columnas({ datos }: { datos: readonly ColumnaDato[] }): React.ReactElement {
  return (
    <div className="flex items-end gap-1.5">
      {datos.map((d, i) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          {d.valor ? (
            <span className="text-[11px] tabular-nums text-faint">{d.valor}</span>
          ) : null}
          {/* El anillo rodea la COLUMNA (la pista), no el relleno: marcar el
              relleno funciona para "es este" cuando la barra es alta, pero con
              una barra baja el outline queda flotando como una raya suelta. El
              anillo señala la columna; el relleno mide. */}
          <span
            className={`relative flex h-16 w-full items-end overflow-hidden rounded-[4px] ${
              d.cerrado ? 'bar-break-hatch' : 'bg-gap'
            } ${
              d.actual
                ? `outline outline-2 outline-offset-1 ${d.anillo === 'ambar' ? 'outline-amber-border' : 'outline-teal-border'}`
                : ''
            }`}
          >
            {d.cerrado ? null : (
              <span
                className="block w-full origin-bottom rounded-[4px] animate-viz-grow-y"
                style={{
                  '--i': i,
                  height: `${d.pct}%`,
                  backgroundColor: 'var(--color-viz-cat-1)',
                  animationDelay: 'calc(var(--i) * var(--stagger))',
                } as CSSProperties}
              />
            )}
          </span>
          <span className="text-[11px] text-faint">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
