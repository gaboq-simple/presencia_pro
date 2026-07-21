// ─── La fuga (Negocio · Panorama · Paso 5) — presentacional ───────────────────
// Dos sub-piezas: (1) capacidad sin usar (huecos de la semana que pasó) y (2) faltas
// repetidas. Última pieza del primer corte del rediseño del dueño.
//
// 🔴 EL TONO ES LA MITAD DEL TRABAJO — muestra DÓNDE HAY ESPACIO, no reprocha:
//   · Titular en HORAS ("18 horas-barbero sin usar"), el peso es REFERENCIA
//     ("equivalen a ~$X en servicios"), NUNCA "perdiste $X".
//   · Señala DÓNDE se concentran (día×franja) → el dueño decide.
//   · Ámbar TENUE para marcar el hueco, jamás rojo de alarma.
//   · Faltas repetidas = dato neutro, sin acción (las señas no existen → sin botón).
// Server Component. Tokens Zentriq-claro, Inter tabular-nums. Español mexicano neutro.

import type { Fuga as FugaData } from '@/lib/fugaData';
import type { FaltaRepetida } from '@/lib/fuga';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));

// ── Capacidad sin usar (huecos muertos) ──
function CapacidadSinUsar({ data }: { data: FugaData }): React.ReactElement | null {
  const c = data.capacidad;
  if (!c.hasData) return null; // sin huecos que señalar → no se renderiza (regla de robustez)

  return (
    <section className="mt-6 rounded-xl border-l-4 border-l-amber-border bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Capacidad sin usar · la semana que pasó</p>

      {/* Titular en HORAS (no en pesos-perdidos). */}
      <p className="mt-2 text-ink">
        <span className="text-3xl font-bold tabular-nums">{c.totalFreeHours}</span>
        <span className="text-lg font-semibold"> horas-barbero</span> sin usar
      </p>
      {/* Peso como REFERENCIA, no como pérdida. */}
      <p className="mt-0.5 text-sm text-ink-2">
        equivalen a <span className="tabular-nums">~{money(c.pesoRef)}</span> en servicios.
      </p>

      {/* DÓNDE se concentran → el dueño decide qué hacer. */}
      {c.concentration && (
        <p className="mt-3 rounded-xl bg-amber-tint/40 px-3 py-2 text-sm text-ink-2">
          Los huecos más grandes fueron <span className="font-medium text-ink">{c.concentration}</span>.
        </p>
      )}

      <p className="mt-2 px-1 text-[11px] text-faint">
        Horas de silla disponibles que quedaron libres en los últimos 7 días (capacidad menos citas),
        sobre los horarios actuales de tus barberos. Es dónde tienes espacio para crecer.
      </p>
    </section>
  );
}

// ── Faltas repetidas (dato, sin acción) ──
function FaltaRow({ f }: { f: FaltaRepetida }): React.ReactElement {
  return (
    <li className="flex items-baseline justify-between gap-2 py-2">
      <span className="truncate text-sm font-medium text-ink">{f.name}</span>
      <span className="shrink-0 text-sm text-ink-2">
        <span className="tabular-nums">{f.count}</span> faltas
        <span className="text-faint"> · última {f.lastLabel}</span>
      </span>
    </li>
  );
}

function FaltasRepetidas({ faltas }: { faltas: FaltaRepetida[] }): React.ReactElement | null {
  if (faltas.length === 0) return null; // nadie faltó 2+ veces → no se renderiza

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Faltas repetidas · este mes</p>
      <p className="mt-1 text-sm text-ink-2">Clientes que no llegaron más de una vez este mes.</p>

      <ul className="mt-2 divide-y divide-line">
        {faltas.map((f) => <FaltaRow key={f.customerId} f={f} />)}
      </ul>

      <p className="mt-2 px-1 text-[11px] text-faint">
        El dato, para que lo tengas presente al reservarles.
      </p>
    </section>
  );
}

export default function Fuga({ data }: { data: FugaData }): React.ReactElement | null {
  const nada = !data.capacidad.hasData && data.faltas.length === 0;
  if (nada) return null; // ninguna de las dos aporta → la fuga entera no se renderiza

  return (
    <>
      <CapacidadSinUsar data={data} />
      <FaltasRepetidas faltas={data.faltas} />
    </>
  );
}
