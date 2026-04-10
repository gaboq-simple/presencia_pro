// ─── API Route: GET /api/analytics ────────────────────────────────────────────
// Retorna métricas de analytics para el período solicitado.
// Usado por AnalyticsDashboard (Client Component) cuando cambia el PeriodSelector.
//
// Auth:    sesión activa de Supabase Auth (doctor-facing).
// Params:  ?period=hoy|semana|mes
// Returns: AnalyticsResponse — tipos serializados con Dates como ISO strings.

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import {
  getAnalyticsMetrics,
  getAtRiskPatients,
  generateAlerts,
} from '@presenciapro/engine/dashboard';
import { clientConfig } from '@/config/client.config';

// ─── Constantes ────────────────────────────────────────────────────────────────

const RISK_THRESHOLD_DAYS = 55;
const AT_RISK_LIMIT       = 10;

// ─── Schemas de validación ────────────────────────────────────────────────────

const PeriodSchema = z.enum(['hoy', 'semana', 'mes']);

// ─── Helpers ───────────────────────────────────────────────────────────────────

type Period = z.infer<typeof PeriodSchema>;

function periodToDateRange(period: Period): { from: Date; to: Date } {
  const now    = new Date();
  const toDate = new Date(now);
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

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  // ── Guard: env vars ────────────────────────────────────────────────────────
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // ── Guard: sesión activa del doctor ───────────────────────────────────────
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser();

  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Validar parámetros ────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const rawPeriod = url.searchParams.get('period') ?? 'semana';
  const periodResult = PeriodSchema.safeParse(rawPeriod);

  if (!periodResult.success) {
    return json({ error: 'Invalid period. Must be hoy | semana | mes' }, 400);
  }

  const period       = periodResult.data;
  const { from, to } = periodToDateRange(period);
  const clientId     = clientConfig.client.id;

  const serviceNameMap = new Map(clientConfig.services.map((s) => [s.id, s.name]));
  const servicePriceMap = new Map(
    clientConfig.services.map((s) => [
      s.id,
      'price' in s && typeof s.price === 'number' ? s.price : 0,
    ]),
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  let metrics;
  let atRiskPatients;

  try {
    [metrics, atRiskPatients] = await Promise.all([
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }

  const alerts = generateAlerts(metrics, {
    riskThresholdDays: RISK_THRESHOLD_DAYS,
    botAssistantName: clientConfig.bot.assistantName,
  });

  // ── Serializar y responder ────────────────────────────────────────────────
  const responseBody = {
    period,
    metrics: {
      ...metrics,
      from: metrics.from.toISOString(),
      to:   metrics.to.toISOString(),
      topServices: metrics.topServices.map((s) => ({ ...s })),
      completedSparkline: [...metrics.completedSparkline],
      sparklines: {
        completed:   [...metrics.sparklines.completed],
        newPatients: [...metrics.sparklines.newPatients],
        noShows:     [...metrics.sparklines.noShows],
        botChats:    [...metrics.sparklines.botChats],
      },
      heatmap: metrics.heatmap.map((c) => ({ ...c })),
    },
    alerts,
    atRiskPatients: atRiskPatients.map((p) => ({
      ...p,
      lastVisit: p.lastVisit?.toISOString() ?? null,
    })),
  };

  return json(responseBody, 200);
}
