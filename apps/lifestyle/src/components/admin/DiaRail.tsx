// ─── DiaRail — el héroe de Administrar: el día como riel de tiempo ───────────
// Server Component presentacional. Recibe las filas YA resueltas por
// `lib/diaRail.computeDiaRail` y las pinta; no hace matemática ni conoce la BD.
//
// Es la pieza heroica de la pestaña: lleva el gesto de marca (border-left teal
// 2px), que es UNO por pantalla. Su número, en cambio, va a 26px y no a 44px —
// el único 44px de toda la vista del dueño es el titular de Panorama; si cada
// pestaña tuviera el suyo, dejaría de significar "esto es lo primero".
//
// 🔴 FRONTERA DERIVADO/CONFIRMADO (D6) — innegociable de esta pestaña. El número
//    dice **"Ingresos de agenda del día"** y no "Cobrado". Sale de
//    `computeDayRevenue` = agenda × (`price_charged` ∥ precio de lista), o sea
//    un DERIVADO. "Cobrado" es la palabra del estado confirmado (eventos que
//    alguien firmó, atribuidos por `completed_at`) y vive en el héroe de
//    Panorama. La piel nueva no puede borrar esa distinción: son dos números
//    distintos y el día que se llamen igual, el dueño va a creer que uno de los
//    dos está mal.
//
// El pasado se atenúa por COLOR (`past-ink` / `past-faint` / `past-bg`), no por
// `opacity`: opacar mezcla el elemento con el fondo y arrastra también el
// contraste del texto, que es lo único que hay que poder leer. La única
// excepción es la barrita categórica del barbero, que no tiene variante "past"
// —un color de identidad no puede tener dos— y ahí sí se baja la intensidad.

import { colorCategorico } from './viz/Apilada';
import type { DiaRail as DiaRailData, RailRow, RailEstado } from '@/lib/diaRail';

const ESTADO_LABEL: Record<RailEstado, string> = {
  completada: 'Terminó',
  no_vino:    'No vino',
  cancelada:  'Cancelada',
  confirmada: 'Confirmada',
  pendiente:  'Por confirmar',
  walkin:     'Walk-in',
};

/** Chip de estado. El pasado va en la gama `past-*`; el futuro, en tinta normal. */
function ChipEstado({ estado, pasado }: { estado: RailEstado; pasado: boolean }): React.ReactElement {
  const tono = pasado
    ? 'bg-past-bg text-past-ink'
    : estado === 'no_vino' || estado === 'cancelada'
      ? 'border border-line-2 text-ink-2'
      : 'bg-tint-1 text-teal-ink';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tono}`}>
      {ESTADO_LABEL[estado]}
    </span>
  );
}

function FilaCita({ row }: { row: Extract<RailRow, { kind: 'cita' }> }): React.ReactElement {
  const { pasado } = row;
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-t border-line first:border-t-0">
      <span
        className={`w-[38px] shrink-0 text-right text-[11px] font-medium tabular-nums ${
          pasado ? 'text-past-faint' : 'text-faint'
        }`}
      >
        {row.hora}
      </span>
      <span
        className="w-[3px] shrink-0 rounded-[2px]"
        style={{
          height: pasado ? 30 : 38,
          backgroundColor: colorCategorico(row.colorIndex),
          opacity: pasado ? 0.4 : 1,
        }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${pasado ? 'text-[13px] text-past-ink' : 'text-[15px] font-medium text-ink'}`}>
          {row.principal}
        </p>
        <p className={`truncate text-[11px] ${pasado ? 'text-past-faint' : 'text-faint'}`}>{row.secundario}</p>
      </div>
      <ChipEstado estado={row.estado} pasado={pasado} />
    </div>
  );
}

/** El hueco se DIBUJA (fila punteada), no se anuncia: es tiempo que existe. */
function FilaHueco({ row }: { row: Extract<RailRow, { kind: 'hueco' }> }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 border-t border-dashed border-line-2 py-2">
      <span className="w-[38px] shrink-0" aria-hidden />
      <p className="flex-1 text-center text-[11px] font-medium text-past-faint">
        {row.minutos} min libres{row.libres ? ` · ${row.libres}` : ''}
      </p>
    </div>
  );
}

function FilaAhora({ row }: { row: Extract<RailRow, { kind: 'ahora' }> }): React.ReactElement {
  return (
    <div className="my-0.5 flex items-center gap-3" aria-label={`Ahora, ${row.hora}`}>
      <span className="w-[38px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-red-ink">
        {row.hora}
      </span>
      <span className="h-0.5 flex-1 rounded-full bg-red-border" aria-hidden />
    </div>
  );
}

function Filas({ rows }: { rows: readonly RailRow[] }): React.ReactElement {
  return (
    <div>
      {rows.map((r) =>
        r.kind === 'cita'  ? <FilaCita  key={r.id} row={r} /> :
        r.kind === 'hueco' ? <FilaHueco key={r.id} row={r} /> :
                             <FilaAhora key={r.id} row={r} />,
      )}
    </div>
  );
}

export default function DiaRail({
  rail, revenue, currency, vacioEsHoy,
}: {
  rail: DiaRailData;
  /** Ingresos DERIVADOS de la agenda del día (`computeDayRevenue`). Ver 🔴 arriba. */
  revenue: number;
  currency: string;
  /** El día visto es hoy — cambia solo el copy del estado vacío. */
  vacioEsHoy: boolean;
}): React.ReactElement {
  const dinero = new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: currency || 'MXN', maximumFractionDigits: 0,
  }).format(revenue);

  return (
    <section
      aria-label="El día"
      className="mt-2 rounded-xl border-l-2 border-l-teal bg-card p-4 shadow-card"
    >
      {/* La etiqueta ES el dato: sin ella este número se confunde con el Cobrado
          de Panorama, que se calcula de otra manera y da otro número. */}
      <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">
        Ingresos de agenda del día
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[26px] font-light leading-8 tabular-nums text-ink">{dinero}</span>
        <span className="text-[13px] text-ink-2">
          <span className="tabular-nums">{rail.completadas}</span>{' '}
          {rail.completadas === 1 ? 'completada' : 'completadas'} ·{' '}
          <span className="tabular-nums">{rail.porAtender}</span> por atender
        </span>
      </div>

      {/* Leyenda del color — sin ella la barra de cada fila es decoración */}
      {rail.leyenda.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-b border-line pb-2">
          {rail.leyenda.map((l) => (
            <span key={l.staffId} className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorCategorico(l.colorIndex) }}
                aria-hidden
              />
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1">
        {rail.ventana.length > 0 ? (
          <Filas rows={rail.ventana} />
        ) : (
          <p className="py-6 text-center text-[13px] text-faint">
            {vacioEsHoy ? 'Sin citas hoy.' : 'Sin citas ese día.'}
          </p>
        )}
      </div>

      {/* Plegar no es esconder: el detalle trae el día COMPLETO, con sus huecos. */}
      {rail.ocultas > 0 && (
        <details className="group mt-2 border-t border-line pt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium text-teal-ink marker:content-none">
            <span>Ver las {rail.totalCitas} citas</span>
            <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
          </summary>
          <div className="mt-1">
            <Filas rows={rail.todas} />
          </div>
        </details>
      )}
    </section>
  );
}
