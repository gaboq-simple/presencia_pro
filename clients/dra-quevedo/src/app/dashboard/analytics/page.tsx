// ─── Analytics Page ────────────────────────────────────────────────────────────
// Server Component — fetcha datos y los pasa al Client Component AnalyticsDashboard.
//
// Estrategia de fetch:
//   1. Verificar sesión con Supabase Auth
//   2. Leer period desde searchParams (default: 'semana')
//   3. getAnalyticsMetrics() para el período seleccionado
//   4. getAtRiskPatients() para la lista de pacientes en riesgo
//   5. generateAlerts() para las alertas dinámicas
//   6. Pasar todo a <AnalyticsDashboard /> (Client Component)

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { clientConfig } from '@/config/client.config';
import {
  getAnalyticsMetrics,
  getAtRiskPatients,
  generateAlerts,
} from '@presenciapro/engine/dashboard';
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Días sin cita para considerar un paciente en riesgo */
const RISK_THRESHOLD_DAYS = 55;

/** Máximo de pacientes en riesgo a mostrar en la lista */
const AT_RISK_LIMIT = 10;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type Period = 'hoy' | 'semana' | 'mes';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Calcula el rango de fechas UTC para cada período. */
function periodToDateRange(period: Period): { from: Date; to: Date } {
  const now    = new Date();
  const toDate = new Date(now);

  // Normalizar `to` al final del día actual
  toDate.setUTCHours(23, 59, 59, 999);

  let from: Date;
  switch (period) {
    case 'hoy':
      from = new Date(now);
      from.setUTCHours(0, 0, 0, 0);
      break;
    case 'semana':
      from = new Date(now.getTime() - 6 * 24 * 60 * 60_000);
      from.setUTCHours(0, 0, 0, 0);
      break;
    case 'mes':
    default:
      from = new Date(now.getTime() - 29 * 24 * 60 * 60_000);
      from.setUTCHours(0, 0, 0, 0);
  }

  return { from, to: toDate };
}

/** Valida que el parámetro de período sea uno de los valores permitidos. */
function parsePeriod(raw: string | string[] | undefined): Period {
  if (raw === 'hoy' || raw === 'semana' || raw === 'mes') return raw;
  return 'semana';
}

function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ── Verificar sesión ──────────────────────────────────────────────────────
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) redirect('/login');

  // ── Parámetros ────────────────────────────────────────────────────────────
  const resolvedParams = await searchParams;
  const period         = parsePeriod(resolvedParams['period']);
  const { from, to }   = periodToDateRange(period);

  const clientId = clientConfig.client.id;

  // Construir mapas de servicio desde el config — el engine nunca lee config directamente
  const serviceNameMap = new Map(clientConfig.services.map((s) => [s.id, s.name]));
  const servicePriceMap = new Map(
    clientConfig.services.map((s) => [s.id, 'price' in s && typeof s.price === 'number' ? s.price : 0]),
  );

  const supabase = getServiceRoleClient();

  // ── Fetch datos en paralelo ───────────────────────────────────────────────
  const [metrics, atRiskPatients] = await Promise.all([
    getAnalyticsMetrics({
      clientId,
      from,
      to,
      serviceNameMap,
      servicePriceMap,
      riskThresholdDays: RISK_THRESHOLD_DAYS,
      supabase,
    }),
    getAtRiskPatients({
      clientId,
      daysSinceLastVisit: RISK_THRESHOLD_DAYS,
      limit: AT_RISK_LIMIT,
      supabase,
    }),
  ]);

  // ── Generar alertas ───────────────────────────────────────────────────────
  const alerts = generateAlerts(metrics, {
    riskThresholdDays: RISK_THRESHOLD_DAYS,
    botAssistantName: clientConfig.bot.assistantName,
  });

  // ── Serializar Dates para el Client Component ─────────────────────────────
  // Los Server Components pueden pasar Dates a Client Components en Next.js App Router.
  // Se serializan automáticamente como ISO strings y se hidratan en el cliente.

  return (
    <AnalyticsDashboard
      initialMetrics={{
        ...metrics,
        from: metrics.from.toISOString(),
        to: metrics.to.toISOString(),
        sparklines: {
          completed:   [...metrics.sparklines.completed],
          newPatients: [...metrics.sparklines.newPatients],
          noShows:     [...metrics.sparklines.noShows],
          botChats:    [...metrics.sparklines.botChats],
        },
        heatmap: metrics.heatmap.map((c) => ({ ...c })),
      }}
      initialAlerts={alerts}
      initialAtRiskPatients={atRiskPatients.map((p) => ({
        ...p,
        lastVisit: p.lastVisit?.toISOString() ?? null,
      }))}
      initialPeriod={period}
      clientId={clientId}
      revenueGoal={clientConfig.design.analytics?.monthlyRevenueGoal}
    />
  );
}
