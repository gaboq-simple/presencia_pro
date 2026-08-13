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
          <span
            className={`relative flex h-16 w-full items-end overflow-hidden rounded-[4px] ${
              d.cerrado ? 'bar-break-hatch' : 'bg-gap'
            }`}
          >
            {d.cerrado ? null : (
              <span
                className={`block w-full origin-bottom rounded-[4px] animate-viz-grow-y ${
                  d.actual ? 'outline outline-2 outline-offset-1 outline-tint-2' : ''
                }`}
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
