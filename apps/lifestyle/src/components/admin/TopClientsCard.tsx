// ─── TopClientsCard ───────────────────────────────────────────────────────────
// Lista de los 5 clientes con más visitas en el período actual.
// Los datos llegan como prop calculada en MetricsSummary (ya disponibles).
// Sin fetch propio.
//
// TODO — Tasa de retención (pendiente, requiere query de cohortes):
//   Con clientes que vinieron entre 30–60 días atrás, calcular qué porcentaje
//   regresó en los últimos 30 días.
//   Query propuesta:
//     WITH cohort AS (
//       SELECT DISTINCT customer_id FROM appointments
//       WHERE business_id = $1
//         AND starts_at >= NOW() - INTERVAL '60 days'
//         AND starts_at < NOW() - INTERVAL '30 days'
//         AND status = 'completed'
//     ),
//     retained AS (
//       SELECT DISTINCT a.customer_id FROM appointments a
//       JOIN cohort c ON a.customer_id = c.customer_id
//       WHERE a.business_id = $1
//         AND a.starts_at >= NOW() - INTERVAL '30 days'
//         AND a.status = 'completed'
//     )
//     SELECT
//       (SELECT COUNT(*) FROM cohort)   AS cohort_size,
//       (SELECT COUNT(*) FROM retained) AS retained_count

import type { TopClientEntry } from '@/lib/dashboard.types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  clients: TopClientEntry[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TopClientsCard({ clients }: Props) {
  if (clients.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs text-gray-400">Top clientes del periodo</p>
      <div className="space-y-1.5">
        {clients.map((client, idx) => (
          <div
            key={client.customer_id}
            className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
          >
            {/* Posición */}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600">
              {idx + 1}
            </span>

            {/* Nombre */}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
              {client.name}
            </span>

            {/* Visitas */}
            <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-500">
              {client.visit_count}{' '}
              <span className="font-normal">{client.visit_count === 1 ? 'visita' : 'visitas'}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
