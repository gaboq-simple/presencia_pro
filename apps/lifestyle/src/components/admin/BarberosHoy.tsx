// ─── Barberos de hoy — extraído de PulsoHoy por P1 (S10-DUE-01) ───────────────
// Server Component presentacional. Vivía dentro de `PulsoHoy`, en Panorama, y
// era su bloque más alto: 3 filas con barra más un `<details>` con el resto.
//
// Se muda a **Administrar** por la regla de la ola —Panorama se queda con la
// conclusión, el detalle va donde ya se opera— y por una razón de narrativa: en
// Administrar la pestaña se lee de arriba abajo como se opera un día, y este
// bloque cae justo en su lugar:
//
//   el día como riel (DiaRail) → QUIÉN lo está atendiendo hoy (acá) → el equipo
//   en la semana (EquipoSemana)
//
// No duplica a `EquipoSemana`: aquel mide PARTICIPACIÓN en el dinero de la
// semana; este mide OCUPACIÓN de hoy. Mismo eje (el barbero), preguntas
// distintas y períodos distintos.
//
// Reglas de robustez heredadas de PulsoHoy, intactas:
//   1. Desaparece con ≤1 barbero (comparar uno contra sí mismo = ruido).
//   3. >3 barberos → 3 visibles + el resto colapsado en un <details> nativo.
// INFORMA, no opina. Tokens Zentriq-claro, Inter tabular-nums.

import type { PulsoHoy as PulsoHoyData, PulsoBarbero } from '@/lib/pulsoHoy';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));
const pctInt = (p: number | null): number => Math.round((p ?? 0) * 100);

// ── Barra de ocupación de un barbero ──
function BarberoRow({ b }: { b: PulsoBarbero }): React.ReactElement {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{b.staffName}</span>
        <span className="shrink-0 text-sm text-ink-2">
          {b.pct === null
            ? <span className="text-faint">no trabaja hoy</span>
            : <><span className="font-semibold tabular-nums text-ink">{pctInt(b.pct)}%</span> · <span className="tabular-nums">{money(b.revenue)}</span></>}
        </span>
      </div>
      {b.pct !== null && (
        <div className="mt-1 h-2 w-full overflow-hidden rounded bg-tint-1">
          <div className="h-full rounded bg-teal-border" style={{ width: `${Math.max(pctInt(b.pct), 2)}%` }} />
        </div>
      )}
    </li>
  );
}

// Promedio de ocupación (solo barberos que trabajan hoy) para la fila colapsada.
function avgPct(list: PulsoBarbero[]): number | null {
  const vals = list.map((b) => b.pct).filter((p): p is number => p !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const VISIBLE_BARBEROS = 3;

export default function BarberosHoy({ data }: { data: PulsoHoyData }): React.ReactElement | null {
  // Regla 1: con un solo barbero no hay nada que comparar.
  if (data.barberos.length <= 1) return null;

  // Regla 3: 3 visibles + resto colapsado.
  const shown = data.barberos.slice(0, VISIBLE_BARBEROS);
  const rest = data.barberos.slice(VISIBLE_BARBEROS);
  const restAvg = avgPct(rest);

  return (
    <section className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Barberos hoy</p>
      <ul className="mt-1 divide-y divide-line">
        {shown.map((b) => <BarberoRow key={b.staffId} b={b} />)}
      </ul>
      {/* Regla 3: el resto colapsa en un <details> nativo (sin JS de cliente). */}
      {rest.length > 0 && (
        <details className="group mt-1 border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-sm text-ink-2 marker:content-none">
            <span>+{rest.length} barbero{rest.length === 1 ? '' : 's'} más</span>
            <span className="text-faint">{restAvg !== null ? `~${pctInt(restAvg)}% ocupación` : 'no trabajan hoy'}</span>
          </summary>
          <ul className="divide-y divide-line">
            {rest.map((b) => <BarberoRow key={b.staffId} b={b} />)}
          </ul>
        </details>
      )}
    </section>
  );
}
