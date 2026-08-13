// ─── Esqueletos — la FORMA de lo que va a llegar, no un spinner ───────────────
// Server Components presentacionales para los `<Suspense fallback>` de los pasos
// siguientes. La regla del sistema: el esqueleto tiene la forma del contenido que
// reemplaza (un héroe se ve como un héroe, una lista como una lista), de modo que
// al llegar el dato la página no salte. Un spinner no dice nada y además centra la
// atención en la espera.
//
// El pulso (1.2s) es lo ÚNICO animado y es el único infinito del kit; con
// reduced-motion se apaga por completo (globals.css), no se acelera.

const BLOQUE = 'bg-past-bg rounded-md animate-viz-sk-pulse';

/** Número héroe + su línea de contexto. */
export function SkStatHero(): React.ReactElement {
  return (
    <div className="space-y-2" aria-hidden>
      <span className={`${BLOQUE} block h-3 w-24`} />
      <span className={`${BLOQUE} block h-10 w-40`} />
      <span className={`${BLOQUE} block h-3 w-32`} />
    </div>
  );
}

/** N filas de barra (label + pista + valor). */
export function SkFilaBarra({ filas = 4 }: { filas?: number }): React.ReactElement {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className={`${BLOQUE} h-3 flex-1`} />
          <span className={`${BLOQUE} h-1.5 w-[42%]`} />
          <span className={`${BLOQUE} h-3 w-16`} />
        </div>
      ))}
    </div>
  );
}

/** Grilla del heatmap (mismas celdas de 20px que HeatmapGrid). */
export function SkHeatmap({
  columnas = 7, filas = 2,
}: { columnas?: number; filas?: number }): React.ReactElement {
  return (
    <div
      className="inline-grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columnas}, 20px)` }}
      aria-hidden
    >
      {Array.from({ length: columnas * filas }, (_, i) => (
        <span key={i} className={`${BLOQUE} h-5 w-5`} />
      ))}
    </div>
  );
}

/** Filas de lista (nombre + meta + valor a la derecha). */
export function SkFilaLista({ filas = 3 }: { filas?: number }): React.ReactElement {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className={`${BLOQUE} block h-3 w-2/5`} />
            <span className={`${BLOQUE} block h-2.5 w-3/5`} />
          </div>
          <span className={`${BLOQUE} h-3 w-14`} />
        </div>
      ))}
    </div>
  );
}
