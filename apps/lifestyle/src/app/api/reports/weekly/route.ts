// ─── GET|POST /api/reports/weekly ─────────────────────────────────────────────
// Calcula y/o envía el reporte semanal de un negocio.
//
// GET  ?date=YYYY-MM-DD [&business_id=UUID]
//   → Retorna WeeklyReportData de la semana que contiene la fecha dada.
//
// POST body: { business_id?: string }  (CRON) o sin body (admin)
//   → Genera WeeklyReportData y envía WhatsApp si report_enabled = true.
//   → Retorna { sent: boolean, data: WeeklyReportData }
//
// Auth dual:
//   1. Authorization: Bearer <CRON_SECRET>  → business_id del query/body
//   2. Sesión admin autenticada              → business_id del servidor
//
// Reglas:
//   - CRON_SECRET nunca sale al cliente
//   - sendWhatsAppMeta() siempre en try/catch
//   - Si report_enabled = false: retorna 200 sin enviar

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
import { getPeriodRange, toDateStr } from '@/lib/dashboard.types';
import type { WeeklyReportData } from '@/lib/dashboard.types';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const GetQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((s) => !isNaN(Date.parse(`${s}T12:00:00`)), 'date is not valid')
    .default(() => toDateStr(new Date())),
  business_id: z.string().uuid().optional(),
});

const PostBodySchema = z.object({
  business_id: z.string().uuid().optional(),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Shapes internos ──────────────────────────────────────────────────────────

type BusinessRow = {
  id: string;
  slug: string;
  report_whatsapp: string | null;
  report_enabled: boolean;
  whatsapp_phone_number_id: string;
};

type RawApptRow = {
  staff_id: string;
  status: string;
  customer_id: string | null;
  service: { price: number } | null;
  staff: { name: string } | null;
};

type RawCustomerRow = {
  id: string;
  visit_count: number;
};

// ─── Auth helper ──────────────────────────────────────────────────────────────

type AuthResult =
  | { ok: true; businessId: string }
  | { ok: false; status: 401 | 403; error: string };

async function resolveAuth(
  request: Request,
  explicitBusinessId: string | undefined,
): Promise<AuthResult> {
  const cronSecret = process.env['CRON_SECRET'];

  // Modo cron: Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get('authorization') ?? '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    if (!explicitBusinessId) {
      return { ok: false, status: 403, error: 'business_id required for cron auth' };
    }
    return { ok: true, businessId: explicitBusinessId };
  }

  // Modo admin: sesión activa
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabase = getServiceClient();
  const { data: staffRecord, error } = await supabase
    .from('staff')
    .select('role, business_id')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (error || !staffRecord || staffRecord.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, businessId: staffRecord.business_id as string };
}

// ─── Cálculo de WeeklyReportData ─────────────────────────────────────────────

async function computeWeeklyReport(
  businessId: string,
  date: string,
): Promise<WeeklyReportData> {
  const supabase = getServiceClient();
  const { start, end } = getPeriodRange('week', date);

  // Derivar period_start y period_end desde el rango
  const period_start = start.slice(0, 10);   // 'YYYY-MM-DD'
  const period_end   = end.slice(0, 10);

  // Appointments del período
  const { data: apptData, error: apptError } = await supabase
    .from('appointments')
    .select('staff_id, status, customer_id, service:service_id(price), staff:staff_id(name)')
    .eq('business_id', businessId)
    .gte('starts_at', start)
    .lte('starts_at', end)
    .in('status', ['completed', 'no_show']);

  if (apptError) throw new Error(`weekly report appointments query: ${apptError.message}`);

  const rows = (apptData ?? []) as unknown as RawApptRow[];

  // Acumular métricas
  let appointments_completed = 0;
  let appointments_no_show   = 0;
  let total_revenue          = 0;

  // Acumulador por staff para top_staff
  const staffRevenue = new Map<string, { name: string; revenue: number }>();

  // Customer IDs únicos de citas completadas
  const completedCustomerIds = new Set<string>();

  for (const row of rows) {
    if (row.status === 'completed') {
      appointments_completed++;
      const price = row.service?.price ?? 0;
      total_revenue += price;

      if (row.customer_id) completedCustomerIds.add(row.customer_id);

      const existing = staffRevenue.get(row.staff_id);
      if (existing) {
        existing.revenue += price;
      } else {
        staffRevenue.set(row.staff_id, {
          name: row.staff?.name ?? '',
          revenue: price,
        });
      }
    } else if (row.status === 'no_show') {
      appointments_no_show++;
    }
  }

  // Top staff
  let top_staff_name: string | null = null;
  let top_staff_revenue: number | null = null;

  for (const entry of staffRevenue.values()) {
    if (top_staff_revenue === null || entry.revenue > top_staff_revenue) {
      top_staff_name    = entry.name;
      top_staff_revenue = entry.revenue;
    }
  }

  // new_clients / recurring_clients
  let new_clients       = 0;
  let recurring_clients = 0;

  if (completedCustomerIds.size > 0) {
    const { data: custData, error: custError } = await supabase
      .from('customers')
      .select('id, visit_count')
      .in('id', [...completedCustomerIds]);

    if (custError) throw new Error(`weekly report customers query: ${custError.message}`);

    for (const c of (custData ?? []) as RawCustomerRow[]) {
      if (c.visit_count >= 2) {
        recurring_clients++;
      } else {
        new_clients++;
      }
    }
  }

  return {
    period_start,
    period_end,
    total_revenue,
    appointments_completed,
    appointments_no_show,
    top_staff_name,
    top_staff_revenue,
    new_clients,
    recurring_clients,
  };
}

// ─── Mensaje de WhatsApp ──────────────────────────────────────────────────────

function buildReportMessage(data: WeeklyReportData, slug: string): string {
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? '';
  const topStaff = data.top_staff_name ?? 'N/A';
  return (
    `📊 Semana ${data.period_start} – ${data.period_end}\n` +
    `💰 Ingresos: $${data.total_revenue} MXN\n` +
    `✂️ Citas: ${data.appointments_completed} completadas · ${data.appointments_no_show} no-shows\n` +
    `⭐ Top barbero: ${topStaff}\n` +
    `Ver detalle → ${appUrl}/${slug}/dashboard`
  );
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const parsed = GetQuerySchema.safeParse({
    date:        searchParams.get('date')        ?? undefined,
    business_id: searchParams.get('business_id') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const auth = await resolveAuth(request, parsed.data.business_id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const data = await computeWeeklyReport(auth.businessId, parsed.data.date);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // Parsear body
  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    // body vacío es válido para el modo admin
  }

  const bodyParsed = PostBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: bodyParsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const auth = await resolveAuth(request, bodyParsed.data.business_id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = getServiceClient();

    // Obtener config del negocio
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .select('id, slug, report_whatsapp, report_enabled, whatsapp_phone_number_id')
      .eq('id', auth.businessId)
      .maybeSingle();

    if (bizError || !biz) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const business = biz as BusinessRow;

    // Si reportes desactivados: retornar sin enviar
    if (!business.report_enabled) {
      const data = await computeWeeklyReport(auth.businessId, toDateStr(new Date()));
      return NextResponse.json({ sent: false, data });
    }

    if (!business.report_whatsapp) {
      return NextResponse.json(
        { error: 'report_whatsapp not configured' },
        { status: 422 },
      );
    }

    const data = await computeWeeklyReport(auth.businessId, toDateStr(new Date()));

    // Enviar WhatsApp — siempre en try/catch
    let sent = false;
    try {
      const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
      if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not set');

      const result = await sendWhatsAppMeta(
        { to: business.report_whatsapp, body: buildReportMessage(data, business.slug) },
        { accessToken, phoneNumberId: business.whatsapp_phone_number_id },
      );
      sent = result.success;
    } catch {
      // best-effort — no interrumpir el flujo
    }

    return NextResponse.json({ sent, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
