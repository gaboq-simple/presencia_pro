// ─── Apilada — composición 100% (de qué está hecho un total) ──────────────────
// Server Component presentacional. Los segmentos se pintan con la categórica en
// ORDEN FIJO (cat-1…cat-5, luego "otros"): el orden es el mecanismo de seguridad
// para daltonismo, así que la asignación de color va por posición, nunca por
// valor ni "el que se vea mejor".
//
// SIN animación de crecimiento, a propósito y por regla del sistema: una
// proporción no se acumula en el tiempo — aparece completa o miente sobre lo que
// mide. (La única barra que crece es la de magnitud, BarraFila/Columnas.)
//
// El gap de 2px entre segmentos es lo que hace legible una composición a 375px;
// sin él, dos tonos vecinos se leen como uno solo.

const PALETA = [
  'var(--color-viz-cat-1)',
  'var(--color-viz-cat-2)',
  'var(--color-viz-cat-3)',
  'var(--color-viz-cat-4)',
  'var(--color-viz-cat-5)',
] as const;

export type SegmentoApilada = {
  label:    string;
  /** Ancho del segmento en % del total. Usar `pctWidth` de `lib/viz`. */
  pct:      number;
  esOtros?: boolean;
};

export function colorCategorico(indice: number, esOtros = false): string {
  if (esOtros) return 'var(--color-viz-otros)';
  return PALETA[indice % PALETA.length]!;
}

export function Apilada({ segmentos }: { segmentos: readonly SegmentoApilada[] }): React.ReactElement {
  return (
    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-gap">
      {segmentos.map((s, idx) => (
        <span
          key={s.label}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${s.pct}%`, backgroundColor: colorCategorico(idx, s.esOtros) }}
        />
      ))}
    </div>
  );
}
