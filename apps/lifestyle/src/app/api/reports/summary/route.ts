// ─── GET /api/reports/summary ─────────────────────────────────────────────────
// Retorna métricas agregadas para un período dado.
//
// Query params:
//   period      — 'day' | 'week' | 'month'
//   date        — 'YYYY-MM-DD' (día ancla del período)
//   business_id — UUID de la sucursal, o varios UUIDs separados por coma.
//                 Para sesiones de negocio directo se ignora y se usa la sesión.
//
// Respuesta con un solo business_id → PeriodMetrics (retrocompatible).
// Respuesta con múltiples business_ids → ConsolidatedSummaryResponse.
//
// Auth: requiere sesión activa (ls_session o Supabase Auth) con role owner/admin.
// Todos los business_ids se validan contra la sesión — nunca se aceptan sin verificación.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import {
  getPeriodMetrics,
  type PeriodMetrics,
  type MetricsPeriod,
  type SourceBreakdownMetrics,
  type NoShowByDayEntry,
  type TopClientEntry,
} from '@/lib/dashboard.types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type BranchSummary = {
  business_id: string;
  business_name: string;
  metrics: PeriodMetrics;
};

export type ConsolidatedSummaryResponse = {
  consolidated: PeriodMetrics;
  branches: BranchSummary[];
};

// ─── Validación de input ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((s) => !isNaN(Date.parse(`${s}T12:00:00`)), 'date is not valid'),
  // Acepta un UUID o varios separados por coma
  business_id: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * Agrega un array de PeriodMetrics en uno solo.
 * Los campos numéricos se suman. hourly, source y noshow_by_day se mergean.
 * top_clients se consolida tomando los 5 con más visitas entre todos.
 */
function aggregatePeriodMetrics(
  metricsArray: PeriodMetrics[],
  period: MetricsPeriod,
  date: string,
): PeriodMetrics {
  const hourly: Record<number, number> = {};
  const source: SourceBreakdownMetrics = { bot: 0, walkin: 0, llamada: 0, manual: 0 };
  const noshowByDay: Record<number, NoShowByDayEntry> = {};

  let revenue = 0;
  let total = 0;
  let completed = 0;
  let cancelled = 0;
  let no_show = 0;
  let pending = 0;
  let confirmed = 0;
  let walkin = 0;
  let recurring_clients = 0;
  let new_clients = 0;
  const allTopClients: TopClientEntry[] = [];

  for (const m of metricsArray) {
    revenue += m.revenue;
    total += m.total;
    completed += m.completed;
    cancelled += m.cancelled;
    no_show += m.no_show;
    pending += m.pending;
    confirmed += m.confirmed;
    walkin += m.walkin;
    recurring_clients += m.recurring_clients;
    new_clients += m.new_clients;

    for (const [h, count] of Object.entries(m.hourly)) {
      const hour = Number(h);
      hourly[hour] = (hourly[hour] ?? 0) + count;
    }

    source.bot += m.source.bot;
    source.walkin += m.source.walkin;
    source.llamada += m.source.llamada;
    source.manual += m.source.manual;

    for (const [d, entry] of Object.entries(m.noshow_by_day)) {
      const day = Number(d);
      const existing = noshowByDay[day] ?? { no_show: 0, completed: 0 };
      existing.no_show += entry.no_show;
      existing.completed += entry.completed;
      noshowByDay[day] = existing;
    }

    allTopClients.push(...m.top_clients);
  }

  // Top 5 entre todas las sucursales (un cliente puede aparecer con IDs distintos por sucursal)
  const top_clients = allTopClients
    .sort((a, b) => b.visit_count - a.visit_count)
    .slice(0, 5);

  return {
    period,
    date,
    revenue,
    currency: 'MXN',
    total,
    completed,
    cancelled,
    no_show,
    pending,
    confirmed,
    walkin,
    hourly,
    source,
    recurring_clients,
    new_clients,
    noshow_by_day: noshowByDay,
    top_clients,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Verificar sesión (ls_session o Supabase Auth)
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Solo owner / admin pueden ver métricas (incluyen revenue del negocio).
  // El asistente y el barbero NO ven el dinero — igual que staff-metrics/usage.
  const ALLOWED = ['owner', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Validar query params con Zod
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    period: searchParams.get('period'),
    date: searchParams.get('date'),
    business_id: searchParams.get('business_id') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { period, date, business_id: rawBusinessId } = parsed.data;

  // 3. Resolver business_ids autorizados
  try {
    if (session.type === 'organization') {
      if (!rawBusinessId) {
        return NextResponse.json(
          { error: 'business_id requerido para sesiones de organizacion' },
          { status: 400 },
        );
      }

      const requestedIds = rawBusinessId.split(',').map((s) => s.trim());

      // Validar formato UUID de todos los IDs
      for (const id of requestedIds) {
        if (!UUID_RE.test(id)) {
          return NextResponse.json({ error: `ID invalido: ${id}` }, { status: 400 });
        }
      }

      // Validar que todos pertenecen a la organización
      for (const id of requestedIds) {
        if (!session.business_ids.includes(id)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      if (requestedIds.length === 1) {
        // Un solo ID — respuesta retrocompatible (PeriodMetrics)
        const metrics = await getPeriodMetrics(requestedIds[0]!, period, date);
        return NextResponse.json(metrics);
      }

      // Múltiples IDs — respuesta consolidada
      const [allMetrics, branchNames] = await Promise.all([
        Promise.all(requestedIds.map((id) => getPeriodMetrics(id, period, date))),
        getBusinessNames(requestedIds),
      ]);

      const branches: BranchSummary[] = requestedIds.map((id, idx) => ({
        business_id: id,
        business_name: branchNames.get(id) ?? id,
        metrics: allMetrics[idx]!,
      }));

      const consolidated = aggregatePeriodMetrics(allMetrics, period, date);

      const response: ConsolidatedSummaryResponse = { consolidated, branches };
      return NextResponse.json(response);
    } else {
      // Sesión de negocio directo — usar siempre la sesión, ignorar cliente
      const metrics = await getPeriodMetrics(session.business_id, period, date);
      return NextResponse.json(metrics);
    }
  } catch (err) {
    // TODO (M-3 — fuga de mensajes de error): err.message puede revelar nombres
    // de tablas o columnas de Supabase. En producción, loguear internamente y
    // retornar mensaje genérico: return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[reports/summary]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Helper: nombres de negocios ─────────────────────────────────────────────

async function getBusinessNames(ids: string[]): Promise<Map<string, string>> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('businesses')
    .select('id, name')
    .in('id', ids);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    map.set(row.id, row.name);
  }
  return map;
}
