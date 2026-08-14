// ─── Pestaña "Hoy" — feed de rescate (detector de fugas) ──────────────────────
// Server Component presentacional. Recibe el feed ya computado (lib/cadence via
// lib/retentionFeed) y el pulso. Sin interactividad: el botón "Enviar mensaje" es
// PLACEHOLDER (el bottom-sheet que escribe es PR2); "volvieron" no se trackea aún.
// Tokens Zentriq-claro (globals.css @theme): teal=bueno, ámbar=atención, rojo=crítico.

import type { RetentionFeed, CadenceResult, FeedUrgency } from '@/lib/cadence';

type UrgencyStyle = { pill: string; label: string; card: string };

// Color por urgencia (grupo del feed): crítico=rojo, se-están-yendo=ámbar, perdido=gris.
const URGENCY: Record<Exclude<FeedUrgency, 'none'>, UrgencyStyle> = {
  critical: {
    label: 'Campeón enfriándose',
    pill:  'bg-red-tint text-red-ink border border-red-border',
    card:  'border-l-4 border-l-red-border',
  },
  leaving: {
    label: 'Se está yendo',
    pill:  'bg-amber-tint text-amber border border-amber-border',
    card:  'border-l-4 border-l-amber-border',
  },
  lost: {
    label: 'Perdido',
    pill:  'bg-past-bg text-past-ink border border-past-line',
    card:  'border-l-4 border-l-past-line',
  },
};

function yearOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear());
}

function Row({ r }: { r: CadenceResult }): React.ReactElement {
  const u = URGENCY[r.urgency === 'none' ? 'leaving' : r.urgency];
  const since = yearOf(r.createdAt);
  return (
    <li className={`rounded-xl bg-card shadow-card ${u.card}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          {/* El NOMBRE manda: con `truncate` + un pill `shrink-0` al lado, un
              nombre normal se cortaba a "A…" y la fila dejaba de decir a quién
              hay que recuperar, que es su único trabajo. Sin truncate y con
              wrap, nombre y pill comparten línea cuando caben y el pill baja
              solo cuando no — sin costarle una línea a cada fila. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold text-ink">{r.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.pill}`}>
              {u.label}
            </span>
            {r.confidence === 'tentative' && (
              <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-faint">
                cadencia tentativa
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-2">{r.explanation}</p>
          <p className="mt-0.5 text-xs text-faint tabular-nums">
            {r.visitCount} {r.visitCount === 1 ? 'visita' : 'visitas'}
            {since && ` · cliente desde ${since}`}
          </p>
        </div>
        {/* Variante `gated` (regla de producción de dv3-3', no negociable): la
            WABA del negocio NO está verificada, así que el control se rinde en
            GRIS y deshabilitado. En teal parecía disponible — y un botón que
            promete enviar y no envía es peor que uno que dice que todavía no.
            PROHIBIDO rendir "✓ Enviado": el endpoint devuelve {sent:false} en
            silencio y cablearlo es otro trabajo. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="shrink-0 cursor-default rounded-lg border border-past-line bg-past-bg px-3 py-1.5 text-sm font-medium text-past-ink"
        >
          Enviar mensaje
        </button>
      </div>
    </li>
  );
}

/** Cuántos se ven sin plegar. Tres: la cantidad que se decide de un vistazo. */
const VISIBLES = 3;

/** El resumen cuenta gente, así que concuerda. "39 campeón enfriándose" es el
 *  detalle que hace que nadie confíe en el resto del número. */
const PLURAL: Record<'critical' | 'leaving' | 'lost', (n: number) => string> = {
  critical: (n) => (n === 1 ? 'campeón enfriándose' : 'campeones enfriándose'),
  leaving:  (n) => (n === 1 ? 'se está yendo' : 'se están yendo'),
  lost:     (n) => (n === 1 ? 'perdido' : 'perdidos'),
};

export default function HoyFeed({
  feed,
  contactados,
  embedded = false,
}: {
  feed: RetentionFeed;
  contactados: number;
  /** Montado dentro de otra vista (Panorama) → sin el wrapper de página propio. */
  embedded?: boolean;
}): React.ReactElement {
  const hasRows = feed.rows.length > 0;
  const visibles = feed.rows.slice(0, VISIBLES);
  const resto = feed.rows.slice(VISIBLES);

  // Conteo por urgencia sobre TODAS las filas (no solo las visibles): el resumen
  // tiene que describir el total, o plegar el resto lo escondería.
  const porUrgencia = feed.rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.urgency === 'none' ? 'leaving' : r.urgency;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const resumen = (['critical', 'leaving', 'lost'] as const)
    .filter((k) => (porUrgencia[k] ?? 0) > 0)
    .map((k) => `${porUrgencia[k]} ${PLURAL[k](porUrgencia[k]!)}`);

  return (
    <div className={embedded ? '' : 'mx-auto w-full max-w-2xl px-4 py-5'}>
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <h2 className="text-sm font-semibold text-ink">Para recuperar</h2>
        {/* Resumen por urgencia: el TAMAÑO del problema en una línea, para que
            plegar el resto no esconda cuánto hay. */}
        <p className="text-[13px] text-ink-2 tabular-nums">
          {resumen.length > 0 ? resumen.join(' · ') : 'nadie por ahora'}
          {contactados > 0 && <span className="text-faint"> · {contactados} contactados</span>}
        </p>
      </div>

      {hasRows ? (
        <>
          <ul className="mt-2 space-y-2">
            {visibles.map((r) => (
              <Row key={r.customerId} r={r} />
            ))}
          </ul>

          {/* El resto NO desaparece: se pliega. Una lista de 20 clientes es un
              muro; una de 3 con "ver todos" es una decisión. */}
          {resto.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-card px-4 py-2.5 text-sm text-ink-2 shadow-card marker:content-none">
                <span>Ver todos ({feed.rows.length})</span>
                <span className="text-faint transition-transform group-open:rotate-90" aria-hidden="true">›</span>
              </summary>
              <ul className="mt-2 space-y-2">
                {resto.map((r) => (
                  <Row key={r.customerId} r={r} />
                ))}
              </ul>
            </details>
          )}

          <p className="mt-2 px-1 text-[11px] text-faint">
            El envío se activa cuando WhatsApp esté conectado.
          </p>
        </>
      ) : (
        // Degradado con gracia: sin historial suficiente, no un feed roto.
        <div className="mt-2 rounded-xl border border-dashed border-line-2 bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">Aún no hay patrones que detectar</p>
          <p className="mt-1 text-sm text-ink-2">
            Cuando tus clientes acumulen algunas visitas, aquí verás a quién se está enfriando
            y podrás traerlo de vuelta con un tap.
          </p>
        </div>
      )}
    </div>
  );
}
