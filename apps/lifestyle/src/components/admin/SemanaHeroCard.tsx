// ─── SemanaHeroCard — el héroe de Panorama (dv3-3') ───────────────────────────
// Server Component. LA pieza heroica de la pestaña: el único número a 44px y el
// único con el gesto de marca (border-left teal 2px). Si mañana otra card lo
// lleva, deja de ser un gesto y pasa a ser decoración.
//
// Qué dice y qué NO:
//   · el titular es **Cobrado** de lunes a hoy — eventos firmados, no agenda ×
//     precio de lista (capa de dinero, D6). Por eso la etiqueta dice "Cobrado" y
//     no "Ingresos": es la palabra del estado CONFIRMADO, el único que puede ser
//     héroe.
//   · el strip pinta SOLO el pasado. El futuro es pista vacía porque lo que hay
//     ahí es agenda, que es otra métrica; la proyección vive en "Los próximos 7
//     días" (ocupación). Una métrica por strip, nunca eje doble.
//   · el chip del corte pone el titular en contraste: cuánto se cobró vs si eso
//     cuadró contra el cajón. Con signo y sin adjetivos.
//
// Primer consumidor real del kit de dv3-2: el strip es `Columnas`, que ya trae
// los dos estados que este héroe necesita (`actual` = anillo, `cerrado` = hatch).

import { Columnas, type ColumnaDato } from './viz/Columnas';
import { pctWidth } from '@/lib/viz';
import { DIAS_CORTOS, etiquetaTramo, type SemanaHero } from '@/lib/semanaCalc';
import { fmtMonto, fmtSigned } from '@/lib/corte';
import type { CorteRow } from '@/lib/corteData';

/** Chip del corte del día. Sin corte todavía es un estado, no un vacío. */
function ChipCorte({ corte }: { corte: CorteRow | null }): React.ReactElement {
  if (corte === null) {
    return (
      <span className="rounded-full border border-line-2 px-2.5 py-1 text-[11px] text-faint">
        Hoy sin corte todavía
      </span>
    );
  }
  // Rojo si falta, ámbar si sobra, neutro si cuadró: atención, no alarma — la
  // misma regla de la card del corte y de la fuga.
  const peor = Math.abs(corte.cashDiff) >= Math.abs(corte.cardDiff) ? corte.cashDiff : corte.cardDiff;
  const tono = peor === 0
    ? 'border-line-2 text-ink-2'
    : peor < 0 ? 'border-red-border text-red-ink' : 'border-amber-border text-amber';
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums ${tono}`}>
      Corte de hoy · ef {fmtSigned(corte.cashDiff)} · tj {fmtSigned(corte.cardDiff)}
    </span>
  );
}

export default function SemanaHeroCard({
  hero, corteHoy,
}: {
  hero: SemanaHero;
  corteHoy: CorteRow | null;
}): React.ReactElement {
  const max = Math.max(0, ...hero.celdas.map((c) => (c.cerrado ? 0 : c.cobrado)));

  const datos: ColumnaDato[] = hero.celdas.map((c, i) => ({
    label:   DIAS_CORTOS[i]!,
    // El futuro no se pinta: pista vacía. No es un cero, es "todavía no".
    pct:     c.esFuturo ? 0 : pctWidth(c.cobrado, max),
    actual:  c.esHoy,
    cerrado: c.cerrado,
  }));

  const tramo = etiquetaTramo(hero);

  return (
    <section
      aria-label="Cobrado de la semana"
      className="mt-2 rounded-xl border-l-2 border-l-teal bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
          Cobrado{tramo ? ` · ${tramo}` : ''}
        </p>
        <ChipCorte corte={corteHoy} />
      </div>

      <p className="mt-1 text-[44px] font-light leading-none tabular-nums text-ink">
        {fmtMonto(hero.titular)}
      </p>

      {hero.delta === null ? (
        <p className="mt-1.5 text-[13px] text-faint">
          {hero.diasConCobro === 0
            ? 'Sin cobros esta semana todavía'
            : 'Sin semana pasada con qué comparar'}
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-2">
          <span className={`tabular-nums font-medium ${hero.delta >= 0 ? 'text-teal-ink' : 'text-ink'}`}>
            {fmtSigned(hero.delta)}
          </span>{' '}
          vs el mismo tramo de la semana pasada
        </p>
      )}

      <div className="mt-3">
        <Columnas datos={datos} />
      </div>
    </section>
  );
}
