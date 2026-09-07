// ─── La fuga — partida en tres por P1 (S10-DUE-01) ────────────────────────────
// Antes era UN bloque en Panorama con las dos sub-piezas juntas (capacidad sin
// usar + faltas repetidas). P1 la reparte según a qué pregunta contesta cada
// pedazo, que es la regla de la ola: Panorama se queda con la CONCLUSIÓN y el
// DETALLE se va a la pestaña que ya existe para eso.
//
//   · `FugaResumen`    → Panorama. El titular en horas y DÓNDE se concentran.
//                        Es lo único accionable: dice dónde hay espacio.
//   · `FugaHeatmap`    → Análisis. El reparto día×franja de la semana y el peso
//                        de referencia. Es diagnóstico: se mira cuando se quiere
//                        entender el patrón, no cuando se abre la app.
//   · `FaltasRepetidas`→ Clientela. Es una lista de personas, y las listas de
//                        personas viven en la pestaña de la clientela.
//
// 🔴 EL TONO SOBREVIVE INTACTO — muestra DÓNDE HAY ESPACIO, no reprocha:
//   · Titular en HORAS ("18 horas-barbero sin usar"), el peso es REFERENCIA
//     ("equivalen a ~$X en servicios"), NUNCA "perdiste $X".
//   · Señala DÓNDE se concentran (día×franja) → el dueño decide.
//   · Ámbar TENUE para marcar el hueco, jamás rojo de alarma.
//   · Faltas repetidas = dato neutro, sin acción (las señas no existen → sin botón).
// Server Components. Tokens Zentriq-claro, Inter tabular-nums. Español mexicano neutro.

import type { Fuga as FugaData } from '@/lib/fugaData';
import type { FaltaRepetida } from '@/lib/fuga';
import { HeatmapGrid } from '@/components/admin/viz/HeatmapGrid';
import { huecoStep } from '@/lib/viz';

const DOW_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money = (n: number): string => MXN.format(Math.round(n));

// ─── Panorama: la conclusión ──────────────────────────────────────────────────
// Dos frases: cuánto espacio hay y dónde está. El heatmap que las acompañaba se
// fue a Análisis — respondía "¿cómo se reparte la semana?", que es una pregunta
// de estudio y no de operación, y era la pieza más alta del bloque.
export function FugaResumen({ data }: { data: FugaData }): React.ReactElement | null {
  const c = data.capacidad;
  if (!c.hasData) return null; // sin huecos que señalar → no se renderiza (regla de robustez)

  return (
    <section className="mt-6 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Capacidad sin usar · la semana que pasó</p>

      {/* Titular en HORAS (no en pesos-perdidos), a 26px w300. */}
      <p className="mt-2 text-ink">
        <span className="text-[26px] font-light tabular-nums leading-none">{c.totalFreeHours}</span>
        <span className="text-sm text-ink-2"> horas-barbero sin usar</span>
      </p>

      {/* DÓNDE se concentran → el dueño decide qué hacer. */}
      {c.concentration && (
        <p className="mt-1 text-[13px] text-ink-2">
          Los huecos más grandes fueron <span className="font-medium text-ink">{c.concentration}</span>.
        </p>
      )}

      <p className="mt-2 px-1 text-[11px] text-faint">
        Horas de silla que quedaron libres en los últimos 7 días. El reparto de la semana está en{' '}
        <a href="#analisis" className="underline decoration-line-2 underline-offset-2">Análisis</a>.
      </p>
    </section>
  );
}

// ─── Análisis: el diagnóstico ─────────────────────────────────────────────────
// El heatmap 7×2 con la rampa `hueco` y el peso de referencia. La frase de
// concentración sola dice "el martes por la tarde" pero no si el resto de la
// semana está igual de vacío; la grilla muestra el reparto entero de un vistazo.
export function FugaHeatmap({ data }: { data: FugaData }): React.ReactElement | null {
  const c = data.capacidad;
  if (!c.hasData) return null;

  // 7 columnas (lun→dom) × 2 filas (mañana, tarde). Se arma en el orden del
  // local, no en el de Date (que arranca en domingo).
  const DOWS = [1, 2, 3, 4, 5, 6, 0];
  const maxFree = Math.max(0, ...c.cells.map((x) => x.freeSlots));
  const celdas = (['manana', 'tarde'] as const).map((franja) =>
    DOWS.map((dow) => {
      const cell = c.cells.find((x) => x.dow === dow && x.franja === franja);
      const libres = cell?.freeSlots ?? 0;
      return {
        step: huecoStep(libres, maxFree),
        // Sin ninguna celda para ese día/franja no hubo horario: hatch, no un
        // hueco de tamaño cero (que se leería como "estuvo lleno").
        cerrado: cell === undefined,
        titulo: `${DOW_LARGO[dow]} ${franja === 'manana' ? 'por la mañana' : 'por la tarde'} · ${libres} lugares libres`,
      };
    }),
  );

  return (
    <section aria-label="Capacidad sin usar de la semana" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Dónde quedó el espacio · la semana que pasó</p>

      <p className="mt-2 text-ink">
        <span className="text-[26px] font-light tabular-nums leading-none">{c.totalFreeHours}</span>
        <span className="text-sm text-ink-2"> horas-barbero sin usar</span>
      </p>
      {/* Peso como REFERENCIA, no como pérdida. */}
      <p className="mt-0.5 text-[13px] text-ink-2">
        equivalen a <span className="tabular-nums">~{money(c.pesoRef)}</span> en servicios.
      </p>

      <div className="mt-3 overflow-x-auto">
        <HeatmapGrid
          celdas={celdas}
          columnas={['L', 'M', 'X', 'J', 'V', 'S', 'D']}
          filas={['AM', 'PM']}
          rampa="hueco"
        />
      </div>

      {c.concentration && (
        <p className="mt-3 text-[13px] text-ink-2">
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

// ─── Clientela: las faltas repetidas (dato, sin acción) ───────────────────────
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

export function FaltasRepetidas({ faltas }: { faltas: FaltaRepetida[] }): React.ReactElement | null {
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
