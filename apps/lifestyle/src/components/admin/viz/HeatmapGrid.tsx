// ─── HeatmapGrid — magnitud en dos ejes (día × franja) ────────────────────────
// Server Component presentacional. Cada celda lleva su escalón YA resuelto por
// `lib/viz` (`seqStep` para intensidad, `huecoStep` para capacidad sin usar) —
// este componente solo mapea escalón → token y pinta.
//
// Dos rampas, dos significados, nunca mezcladas en la misma grilla:
//   · 'seq'   = intensidad/ocupación (teal, más oscuro = más).
//   · 'hueco' = capacidad SIN USAR (ámbar tenue; nunca rojo — un hueco es una
//     oportunidad, no una alarma).
// "Cerrado" no es un cero: va con hatch, porque un día sin horario y un día
// vacío significan cosas distintas.
//
// Movimiento: la grilla aparece POR COLUMNAS (`--i` = índice de columna), que es
// el orden del tiempo; si el stagger fuera por celda, el ojo leería un barrido
// diagonal sin significado.

import type { CSSProperties } from 'react';

export type HeatCelda = {
  /** 1..7 con rampa 'seq'; 1..4 con rampa 'hueco'. Ya resuelto por lib/viz. */
  step:     number;
  /** Sin horario ese día/franja: hatch, no intensidad 0. */
  cerrado?: boolean;
  /** Texto accesible de la celda ("Martes 10:00 · 38%"). */
  titulo?:  string;
};

export type HeatmapGridProps = {
  /** Filas = franjas; columnas = días. `celdas[fila][columna]`. */
  celdas:    readonly (readonly HeatCelda[])[];
  columnas:  readonly string[];
  filas:     readonly string[];
  rampa?:    'seq' | 'hueco';
};

function tono(step: number, rampa: 'seq' | 'hueco'): string {
  const max = rampa === 'seq' ? 7 : 4;
  const n = Math.min(max, Math.max(1, Math.round(step)));
  return `var(--color-viz-${rampa}-${n})`;
}

export function HeatmapGrid({
  celdas, columnas, filas, rampa = 'seq',
}: HeatmapGridProps): React.ReactElement {
  return (
    <div className="inline-grid gap-1"
         style={{ gridTemplateColumns: `auto repeat(${columnas.length}, 20px)` }}>
      <span aria-hidden />
      {columnas.map((c) => (
        <span key={c} className="text-center text-[11px] text-faint">{c}</span>
      ))}

      {filas.map((f, fi) => (
        <Fila key={f} label={f} celdas={celdas[fi] ?? []} rampa={rampa} />
      ))}
    </div>
  );
}

function Fila({
  label, celdas, rampa,
}: { label: string; celdas: readonly HeatCelda[]; rampa: 'seq' | 'hueco' }): React.ReactElement {
  return (
    <>
      <span className="pr-1 text-right text-[11px] leading-5 text-faint">{label}</span>
      {celdas.map((c, ci) => (
        <span
          key={ci}
          title={c.titulo}
          className={`h-5 w-5 rounded-[3px] animate-viz-fade-in ${c.cerrado ? 'bar-break-hatch' : ''}`}
          style={{
            '--i': ci,                       // índice de COLUMNA: la grilla entra en orden temporal
            animationDelay: 'calc(var(--i) * var(--stagger))',
            ...(c.cerrado ? {} : { backgroundColor: tono(c.step, rampa) }),
          } as CSSProperties}
        />
      ))}
    </>
  );
}
