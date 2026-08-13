// ─── StatFila — un número con su etiqueta y su contexto ───────────────────────
// Server Component presentacional. La forma más chica del kit: kicker + número +
// una línea de contexto. No es un héroe (el héroe es uno solo por pantalla, a
// 40px, y lo compone la vista); esto es el par de stats que acompaña.
//
// Movimiento: `animate-viz-fade-in` con el retraso de su índice — un número no
// "crece", solo aparece: animar su tamaño sugeriría que el valor está subiendo.
// Los números van SIEMPRE en tabular-nums para que no bailen entre columnas.

import type { CSSProperties } from 'react';

export type StatFilaProps = {
  /** Etiqueta corta en mayúsculas (11px w600, tracking .10em). */
  kicker:   string;
  /** Valor ya formateado ($1,240 · 38% · 5/6). Este componente no formatea. */
  valor:    string;
  /** Línea de contexto opcional bajo el número (comparación, ventana, umbral). */
  contexto?: string;
  /** Índice en el grupo: define el retraso de entrada. */
  i?:       number;
  /** Acento del número: por defecto la tinta normal (dato, no juicio). */
  tono?:    'normal' | 'teal' | 'ambar';
};

const TONO: Record<NonNullable<StatFilaProps['tono']>, string> = {
  normal: 'text-ink',
  teal:   'text-teal-ink',
  ambar:  'text-amber',
};

export function StatFila({
  kicker, valor, contexto, i = 0, tono = 'normal',
}: StatFilaProps): React.ReactElement {
  return (
    <div
      className="animate-viz-fade-in"
      style={{ '--i': i, animationDelay: 'calc(var(--i) * var(--stagger))' } as CSSProperties}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">{kicker}</p>
      <p className={`text-[26px] font-light leading-tight tabular-nums ${TONO[tono]}`}>{valor}</p>
      {contexto ? <p className="text-[13px] text-ink-2">{contexto}</p> : null}
    </div>
  );
}
