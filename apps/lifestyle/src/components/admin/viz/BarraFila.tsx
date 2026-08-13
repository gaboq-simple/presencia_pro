// ─── BarraFila — una fila de barra horizontal (identidad × magnitud) ──────────
// Server Component presentacional puro: recibe el ancho YA calculado por
// `lib/viz.pctWidth` y lo pinta. No hace matemática ni conoce la fuente del dato.
//
// Anatomía (maqueta dueño-v3): label a la izquierda · pista de fondo con el
// relleno encima · valor tabular pegado a la derecha. La PISTA existe siempre:
// es la que comunica "esto es una proporción de algo", y sin ella una barra
// corta y una barra larga no se comparan.
//
// Movimiento: el relleno crece desde su eje izquierdo (`animate-viz-grow-x` +
// `origin-left`) con el retraso de su índice — la magnitud se CONSTRUYE, no
// aparece dibujada. `--i` llega por prop; el delay lo compone el CSS.

import type { CSSProperties } from 'react';

export type BarraFilaProps = {
  label:   string;
  /** Ancho del relleno en % (0–100). Usar `pctWidth` de `lib/viz`. */
  pct:     number;
  /** Texto ya formateado del valor ($1,240 · 45 · 12%). Nunca lo formatea este componente. */
  valor:   string;
  /** Índice en la serie: define el retraso de entrada. 0 = primero. */
  i?:      number;
  /** Color del relleno. Por defecto el teal de marca (magnitud = UN matiz). */
  color?:  string;
  /** Fila de pliegue ("Otros k"): mismo peso visual, color neutro. */
  esOtros?: boolean;
};

export function BarraFila({
  label, pct, valor, i = 0, color, esOtros = false,
}: BarraFilaProps): React.ReactElement {
  const relleno = color ?? (esOtros ? 'var(--color-viz-otros)' : 'var(--color-viz-cat-1)');
  const style = {
    '--i': i,
    width: `${pct}%`,
    backgroundColor: relleno,
    animationDelay: 'calc(var(--i) * var(--stagger))',
  } as CSSProperties;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{label}</span>
      <span className="h-1.5 w-[42%] shrink-0 overflow-hidden rounded-full bg-gap">
        <span
          className="block h-full origin-left rounded-full animate-viz-grow-x"
          style={style}
        />
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-ink">{valor}</span>
    </div>
  );
}
