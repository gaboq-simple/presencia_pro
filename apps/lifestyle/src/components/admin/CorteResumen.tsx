// ─── CorteResumen — el cuadre, del lado del dueño (D5) ────────────────────────
// SOLO LECTURA. El dueño del cliente #1 no está en el local: no cuenta el cajón,
// no firma nada. Lo que necesita es enterarse — y el aviso de WhatsApp que manda
// la action ya se lo dice el mismo día. Esta card es donde lo mira después,
// junto a los otros números del negocio, y donde ve la SERIE: un descuadre
// suelto no dice nada, siete días seguidos sí.
//
// Server Component: recibe los cortes ya resueltos desde la página (el contrato
// de DashboardLayout — "NO fetcha datos propios"). Sin estado, sin efectos.
//
// El signo manda (decisión 4). Negativo = falta efectivo: salidas sin registrar
// o fuga. Positivo = entró dinero que nadie capturó, típicamente walk-ins. En
// valor absoluto los dos se ven iguales y son problemas opuestos, así que el
// valor absoluto está prohibido acá y en todos lados.

import { fmtMonto, fmtSigned, resolverCortes, type CorteResoluble } from '@/lib/corte';

export type CorteParaDueno = CorteResoluble & {
  cashCounted:  number;
  cardCounted:  number;
  expectedCash: number;
  expectedCard: number;
  cashDiff:     number;
  cardDiff:     number;
  firmadoPor:   string;
  notifiedAt:   string | null;
};

/** Día local ya formateado por la página (que conoce la tz del negocio). */
function diaCorto(fecha: string): string {
  // 'YYYY-MM-DD' → "mié 12". Sin `new Date(fecha)` a secas: eso lo interpreta
  // UTC y en México adelanta un día.
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
    .format(dt)
    .replace(/\./g, '');
}

/** Rojo si falta, ámbar si sobra: atención, no alarma (misma regla que la fuga). */
function tono(diff: number): string {
  if (diff === 0) return 'text-ink-2';
  return diff < 0 ? 'text-red-ink' : 'text-amber';
}

export default function CorteResumen({
  cortes, hoy,
}: {
  /** Cortes de los últimos días, sin resolver (puede haber varios por día). */
  cortes: CorteParaDueno[];
  /** Hoy en la tz del NEGOCIO ('YYYY-MM-DD'). */
  hoy: string;
}) {
  const resueltos = resolverCortes(cortes);
  const deHoy = resueltos.find((r) => r.corte.corteDate === hoy) ?? null;
  const serie = resueltos.slice(0, 7);

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">El cuadre</p>

      {deHoy === null ? (
        <p className="mt-0.5 text-sm text-gray-900">Hoy todavía no hubo corte</p>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
            <span className="text-gray-900">
              Efectivo {fmtMonto(deHoy.corte.cashCounted)}{' '}
              <span className={`font-semibold ${tono(deHoy.corte.cashDiff)}`}>
                {fmtSigned(deHoy.corte.cashDiff)}
              </span>
            </span>
            <span className="text-gray-900">
              Terminal {fmtMonto(deHoy.corte.cardCounted)}{' '}
              <span className={`font-semibold ${tono(deHoy.corte.cardDiff)}`}>
                {fmtSigned(deHoy.corte.cardDiff)}
              </span>
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            Firmado por {deHoy.corte.firmadoPor}
            {deHoy.correcciones > 0 &&
              ` · corregido ${deHoy.correcciones === 1 ? '1 vez' : `${deHoy.correcciones} veces`}`}
          </p>
        </>
      )}

      {/* La serie: un descuadre suelto no dice nada; la seguidilla sí. Los días
          sin corte no se rellenan con ceros — un día sin contar no es un día
          cuadrado, y confundirlos sería el peor error posible acá. */}
      {serie.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 pt-2 text-xs tabular-nums">
          {serie.map(({ corte }) => (
            <li key={corte.id} className="flex items-baseline gap-1.5">
              <span className="text-gray-500">{diaCorto(corte.corteDate)}</span>
              <span className={`font-semibold ${tono(corte.cashDiff)}`}>{fmtSigned(corte.cashDiff)}</span>
              <span className={tono(corte.cardDiff)}>{fmtSigned(corte.cardDiff)}</span>
            </li>
          ))}
        </ul>
      )}
      {serie.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">Efectivo · terminal, con signo</p>
      )}
    </div>
  );
}
