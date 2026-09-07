// ─── Pestaña "Panorama" — el centro de control ────────────────────────────────
// Server Component presentacional. Lectura pura (no muta nada).
//
// La regla de la pestaña, fijada en P1 (S10-DUE-01): **Panorama se queda con la
// CONCLUSIÓN; el DETALLE vive en la pestaña que ya existe para eso.** Cinco
// bloques que contestaban tres preguntas distintas (cómo va / qué viene / qué
// pasó) se leían como un muro aunque cada pieza estuviera bien.
//
// Se lee de arriba abajo como se abre el día:
//   1. LA SEMANA COBRADA — el héroe, único 44px y único gesto de marca.
//   2. El pulso de hoy — cuatro stats y dos líneas de contexto.
//   3. La semana que viene — la pieza accionable: dónde hay lugar.
//   4. Para recuperar — el TAMAÑO del problema, con su enlace a Clientela.
//   5. Capacidad sin usar — cuántas horas y dónde se concentran.
//
// Lo que se fue en P1, y a dónde (nada se borró, todo se mudó):
//   · el bloque "Barberos hoy"           → Administrar (`BarberosHoy.tsx`)
//   · el heatmap 7×2 de la fuga + peso   → Análisis (`FugaHeatmap`)
//   · las faltas repetidas               → Clientela (`FaltasRepetidas`)
//   · la lista del feed de rescate       → Clientela (`HoyFeed`)
//
// Y **el funeral que P1 vino a hacer**: esta vista recibía `revenue`, `occupancy`
// y `barberos` y no renderizaba ninguno desde dv3-6, cuando el `<details>` "La
// historia" se mudó a Análisis por COPIA y nadie enterró el original. Quedaron
// ~290 de 349 líneas muertas (`Comparison`, `MonthlyBars`, `Heatmap`,
// `OcupacionBlock`, `BarberoRow`, `avgRecompra`, `BarberosBlock`) y con ellas el
// voseo "Definí los horarios", que sobrevivió al barrido de dv3-5' precisamente
// porque el código ya no se renderizaba. Las tres consultas SIGUEN corriendo:
// las necesita `AnalisisView`, y solo dejaron de pasar por acá.
//
// Copy sin promesas, sin juicios. Tokens Zentriq-claro. Español mexicano neutro.

import type { PulsoHoy as PulsoHoyData } from '@/lib/pulsoHoy';
import type { SemanaProxima as SemanaData } from '@/lib/pulsoSemana';
import type { RetentionFeed } from '@/lib/cadence';
import type { Fuga as FugaData } from '@/lib/fugaData';
import type { SemanaHeroData } from '@/lib/semanaHero';
import PulsoHoy from '@/components/admin/PulsoHoy';
import SemanaProxima from '@/components/admin/SemanaProxima';
import SemanaHeroCard from '@/components/admin/SemanaHeroCard';
import { RecuperarResumen } from '@/components/admin/HoyFeed';
import { FugaResumen } from '@/components/admin/Fuga';

export default function NegocioView({
  pulso,
  semana,
  feed,
  contactados,
  fuga,
  semanaHero,
}: {
  pulso: PulsoHoyData;
  semana: SemanaData;
  feed: RetentionFeed;
  contactados: number;
  fuga: FugaData;
  semanaHero: SemanaHeroData;
}): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      {/* ── EL HÉROE: la semana cobrada (dv3-3'). Único 44px de la pestaña y
           único con el gesto de marca. El titular es Cobrado —eventos firmados,
           no agenda × lista— y el chip del corte lo pone en contraste. ── */}
      <SemanaHeroCard hero={semanaHero.hero} corteHoy={semanaHero.corteHoy} />

      {/* ── Pulso de hoy (Paso 1) — debajo del héroe: hoy es un detalle de la
           semana, no la pregunta principal. ── */}
      <PulsoHoy data={pulso} />

      {/* ── La semana que viene (Paso 2) — la pieza accionable ── */}
      <SemanaProxima data={semana} />

      {/* ── El rescate, en su tamaño: cuántos y de qué urgencia. Los nombres
           están en Clientela, a un tap de acá. ── */}
      <RecuperarResumen feed={feed} contactados={contactados} />

      {/* ── La capacidad sin usar, en su conclusión: cuántas horas y dónde. El
           reparto de la semana está en Análisis. Ámbar tenue, nunca rojo. ── */}
      <FugaResumen data={fuga} />
    </div>
  );
}
