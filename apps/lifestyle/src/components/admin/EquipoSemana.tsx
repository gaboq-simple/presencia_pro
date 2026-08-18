// ─── EquipoSemana — el equipo de la semana en 5 filas ────────────────────────
// Server Component presentacional. Reemplaza a `StaffMetricsPanel` en el nivel 1:
// 7 tarjetas de 6 tiles cada una (42 números, la mitad en cero) por una fila por
// barbero con punto de color, nombre, barra de participación y $ tabular.
//
// La barra usa `BarraFila` del kit, con UNA desviación deliberada: el relleno va
// del color CATEGÓRICO del barbero y no del teal de magnitud. Acá la barra no
// compara una serie contra sí misma —compara personas—, y el punto de color de
// cada fila tiene que ser el MISMO color que su barra en el riel de arriba; si
// las cinco barras fueran teal, la leyenda del héroe no serviría para leer esta
// card. Es la excepción que el kit contempla vía la prop `color`.
//
// 🔴 La etiqueta dice "de agenda": el $ de cada fila es el derivado
//    (`price_charged` ∥ precio de lista) que suma el panel al que reemplaza, NO
//    el Cobrado confirmado del héroe de Panorama. Misma frontera de D6 que
//    custodia `DiaRail`.

import { BarraFila } from './viz/BarraFila';
import { colorCategorico } from './viz/Apilada';
import type { EquipoSemana as EquipoSemanaData } from '@/lib/equipoSemana';

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
});

export default function EquipoSemana({ data }: { data: EquipoSemanaData }): React.ReactElement {
  return (
    <section aria-label="El equipo esta semana" className="mt-5 rounded-xl bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">
          El equipo · esta semana
        </p>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-faint">
          {MXN.format(data.total)} de agenda
        </span>
      </div>

      {data.vacio ? (
        <p className="py-6 text-center text-[13px] text-faint">
          Nadie atendió citas esta semana todavía.
        </p>
      ) : (
        <>
          <div className="mt-1">
            {data.filas.map((f, i) => (
              <div key={f.staffId} className="flex items-center gap-2">
                <span
                  className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: colorCategorico(f.colorIndex) }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <BarraFila
                    label={f.name}
                    pct={f.pct}
                    valor={MXN.format(f.revenue)}
                    i={i}
                    color={colorCategorico(f.colorIndex)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Las faltas al pie y en una línea: son la excepción, no una columna
              que ponga a los barberos a competir por quién tuvo menos. */}
          {data.faltas && <p className="mt-2 text-[11px] font-medium text-faint">{data.faltas}</p>}
        </>
      )}
    </section>
  );
}
