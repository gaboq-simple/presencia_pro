// ─── GET /api/reports/staff-metrics ───────────────────────────────────────────
// Retorna métricas por barbero para un período dado.
//
// Query params:
//   period      — 'week' | 'month'
//   date        — 'YYYY-MM-DD' (día ancla del período; default: hoy)
//   business_id — UUID de la sucursal (requerido para sesiones de organización)
//
// Auth: requiere sesión activa (ls_session o Supabase Auth) con role owner/admin.
// El business_id se valida contra la sesión — nunca se acepta sin verificación.
//
// Por cada staff activo del negocio calcula:
//   · appointments completadas / no_show / canceladas en el período
//   · SUM de services.price WHERE status='completed'
//   · De los customer_ids únicos atendidos por ese staff en el período:
//       recurring_clients = cuántos tienen visit_count >= 2 en el negocio
//       new_clients       = cuántos tienen visit_count = 1 en el negocio
//
// Retorna StaffMetrics[] ordenado por total_revenue DESC.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { getPeriodRange, toDateStr } from '@/lib/dashboard.types';
import type { StaffMetrics, StaffMetricsPeriod } from '@/lib/dashboard.types';

// ─── Validación de input ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((s) => !isNaN(Date.parse(`${s}T12:00:00`)), 'date is not valid')
    .default(() => toDateStr(new Date())),
  business_id: z.string().regex(UUID_RE).optional(),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Shapes internos ──────────────────────────────────────────────────────────

type RawStaffRow = {
  id: string;
  name: string;
  photo_url: string | null;
};

type RawAppointmentMetricsRow = {
  staff_id: string;
  status: string;
  customer_id: string | null;
  service: { price: number } | null;
};

type RawCustomerVisitRow = {
  id: string;
  visit_count: number;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Verificar sesión (ls_session o Supabase Auth)
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Solo owner / admin pueden ver métricas de staff
  const ALLOWED = ['owner', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceClient();

  // 2. Validar query params con Zod
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    period: searchParams.get('period') ?? undefined,
    date: searchParams.get('date') ?? undefined,
    business_id: searchParams.get('business_id') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { period, date, business_id: requestedId } = parsed.data;

  // 3. Resolver business_id autorizado
  let businessId: string;

  if (session.type === 'organization') {
    if (!requestedId) {
      return NextResponse.json(
        { error: 'business_id requerido para sesiones de organizacion' },
        { status: 400 },
      );
    }
    if (!session.business_ids.includes(requestedId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    businessId = requestedId;
  } else {
    businessId = session.business_id;
  }

  try {
    // 4. Rango del período — reutiliza el helper existente
    const { start, end } = getPeriodRange(period, date);

    // 5. Staff activo del negocio
    const { data: staffData, error: staffDataError } = await supabase
      .from('staff')
      .select('id, name, photo_url')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('name');

    if (staffDataError) throw new Error(`staff query failed: ${staffDataError.message}`);

    const staffList = (staffData ?? []) as RawStaffRow[];
    if (staffList.length === 0) {
      return NextResponse.json([] as StaffMetrics[]);
    }

    const staffIds = staffList.map((s) => s.id);

    // 6. Appointments del período para todos los staff activos
    const { data: apptData, error: apptError } = await supabase
      .from('appointments')
      .select('staff_id, status, customer_id, service:service_id(price)')
      .eq('business_id', businessId)
      .in('staff_id', staffIds)
      .gte('starts_at', start)
      .lte('starts_at', end)
      .in('status', ['completed', 'no_show', 'cancelled']);

    if (apptError) throw new Error(`appointments query failed: ${apptError.message}`);

    const apptRows = (apptData ?? []) as unknown as RawAppointmentMetricsRow[];

    // 7. Agrupar appointments por staff_id
    type StaffAccumulator = {
      completed: number;
      no_show: number;
      cancelled: number;
      revenue: number;
      customerIds: Set<string>;
    };

    const byStaff = new Map<string, StaffAccumulator>();
    for (const staffId of staffIds) {
      byStaff.set(staffId, {
        completed: 0,
        no_show: 0,
        cancelled: 0,
        revenue: 0,
        customerIds: new Set(),
      });
    }

    for (const row of apptRows) {
      const acc = byStaff.get(row.staff_id);
      if (!acc) continue;

      if (row.status === 'completed') {
        acc.completed++;
        if (row.service) acc.revenue += row.service.price;
      } else if (row.status === 'no_show') {
        acc.no_show++;
      } else if (row.status === 'cancelled') {
        acc.cancelled++;
      }

      if (row.customer_id) acc.customerIds.add(row.customer_id);
    }

    // 8. Obtener visit_count de todos los customers únicos involucrados
    const allCustomerIds = [...new Set(apptRows.map((r) => r.customer_id).filter(Boolean))] as string[];

    const customerVisitMap = new Map<string, number>();

    if (allCustomerIds.length > 0) {
      const { data: custData, error: custError } = await supabase
        .from('customers')
        .select('id, visit_count')
        .in('id', allCustomerIds);

      if (custError) throw new Error(`customers query failed: ${custError.message}`);

      for (const c of (custData ?? []) as RawCustomerVisitRow[]) {
        customerVisitMap.set(c.id, c.visit_count);
      }
    }

    // 9. Construir StaffMetrics[]
    const result: StaffMetrics[] = staffList.map((staff) => {
      const acc = byStaff.get(staff.id) ?? {
        completed: 0,
        no_show: 0,
        cancelled: 0,
        revenue: 0,
        customerIds: new Set<string>(),
      };

      let recurring = 0;
      let newClients = 0;

      for (const customerId of acc.customerIds) {
        const visits = customerVisitMap.get(customerId) ?? 0;
        if (visits >= 2) {
          recurring++;
        } else {
          newClients++;
        }
      }

      return {
        staff_id: staff.id,
        staff_name: staff.name,
        photo_url: staff.photo_url,
        appointments_completed: acc.completed,
        appointments_no_show: acc.no_show,
        appointments_cancelled: acc.cancelled,
        total_revenue: acc.revenue,
        recurring_clients: recurring,
        new_clients: newClients,
        period: period as StaffMetricsPeriod,
      };
    });

    // Ordenar por ingresos DESC
    result.sort((a, b) => b.total_revenue - a.total_revenue);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
