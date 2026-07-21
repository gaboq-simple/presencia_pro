// ─── GET /api/reports/usage ───────────────────────────────────────────────────
// Metricas de consumo de un negocio para un mes dado.
// Uso: facturacion basada en uso real.
//
// Query params:
//   month       — 'YYYY-MM' (requerido)
//   business_id — UUID (opcional; default: business_id de la sesion activa)
//
// Auth: requiere sesion activa con role owner o admin.
// business_id siempre se valida contra la sesion — nunca se acepta sin verificacion.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type UsageReport = {
  period: string;
  business_id: string;
  business_name: string;
  generated_at: string;
  // Citas
  total_appointments: number;
  completed_appointments: number;
  cancelled_appointments: number;
  no_show_appointments: number;
  // Mensajes WhatsApp
  whatsapp_messages_sent: number;
  whatsapp_messages_failed: number;
  // Clientes
  unique_customers: number;
  new_customers: number;
  // Conversaciones
  bot_conversations: number;
  human_takeovers: number;
};

// ─── Validacion ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month debe ser YYYY-MM')
    .refine((s) => {
      const [year, month] = s.split('-').map(Number);
      return (year ?? 0) >= 2024 && (month ?? 0) >= 1 && (month ?? 0) <= 12;
    }, 'month no es una fecha valida'),
  business_id: z.string().regex(UUID_RE).optional(),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Verificar sesion
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Solo owner / admin pueden consultar metricas de uso
  const ALLOWED = ['owner', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Validar query params
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    month: searchParams.get('month') ?? undefined,
    business_id: searchParams.get('business_id') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (!parsed.data.month) {
    return NextResponse.json(
      { error: 'Bad request', details: { month: ['month es requerido (YYYY-MM)'] } },
      { status: 400 },
    );
  }

  const { month, business_id: requestedId } = parsed.data;

  // 3. business_id de la sesión (siempre una sucursal). Si el query pasa uno, debe
  //    coincidir con el propio.
  if (requestedId && requestedId !== session.business_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const businessId = session.business_id;

  try {
    const supabase = getServiceClient();
    const db = tenantDb(supabase, businessId);

    // Rango del mes: [inicio, fin_exclusivo)
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year!, mon! - 1, 1);
    const end = new Date(year!, mon!, 1); // primer dia del mes siguiente
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // 4. Nombre del negocio
    const { data: bizData, error: bizError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    if (bizError || !bizData) {
      return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
    }

    const businessName = (bizData as { name: string }).name;

    // 5. Metricas de citas
    const { data: apptData, error: apptError } = await db
      .table('appointments')
      .select('status, customer_id')
      .gte('starts_at', startISO)
      .lt('starts_at', endISO);

    if (apptError) throw new Error(`appointments query failed: ${apptError.message}`);

    const appts = (apptData ?? []) as { status: string; customer_id: string | null }[];
    const totalAppointments = appts.length;
    const completedAppointments = appts.filter((a) => a.status === 'completed').length;
    const cancelledAppointments = appts.filter((a) => a.status === 'cancelled').length;
    const noShowAppointments = appts.filter((a) => a.status === 'no_show').length;

    // Clientes unicos con cita en el mes
    const uniqueCustomerIds = new Set(
      appts.map((a) => a.customer_id).filter((id): id is string => id !== null),
    );

    // 6. Clientes nuevos creados en el mes
    const { count: newCustomers, error: newCustError } = await db
      .table('customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startISO)
      .lt('created_at', endISO);

    if (newCustError) throw new Error(`new_customers query failed: ${newCustError.message}`);

    // 7. Mensajes WhatsApp enviados/fallidos (scheduled_notifications)
    const { count: msgSent, error: msgSentError } = await db
      .table('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', startISO)
      .lt('sent_at', endISO);

    if (msgSentError) throw new Error(`whatsapp_sent query failed: ${msgSentError.message}`);

    const { count: msgFailed, error: msgFailedError } = await db
      .table('scheduled_notifications')
      .select('id', { count: 'exact', head: true })
      .gte('failed_at', startISO)
      .lt('failed_at', endISO);

    if (msgFailedError) throw new Error(`whatsapp_failed query failed: ${msgFailedError.message}`);

    // 8. Conversaciones con actividad en el mes (bot_conversations)
    const { count: botConvs, error: botConvsError } = await db
      .table('bot_conversations')
      .select('id', { count: 'exact', head: true })
      .gte('last_message', startISO)
      .lt('last_message', endISO);

    if (botConvsError) throw new Error(`bot_conversations query failed: ${botConvsError.message}`);

    // 9. Takeovers humanos: mensajes con sent_by='human' en el mes
    const { count: humanTakeovers, error: humanError } = await db
      .table('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('sent_by', 'human')
      .gte('created_at', startISO)
      .lt('created_at', endISO);

    if (humanError) throw new Error(`human_takeovers query failed: ${humanError.message}`);

    const report: UsageReport = {
      period: month,
      business_id: businessId,
      business_name: businessName,
      generated_at: new Date().toISOString(),
      total_appointments: totalAppointments,
      completed_appointments: completedAppointments,
      cancelled_appointments: cancelledAppointments,
      no_show_appointments: noShowAppointments,
      whatsapp_messages_sent: msgSent ?? 0,
      whatsapp_messages_failed: msgFailed ?? 0,
      unique_customers: uniqueCustomerIds.size,
      new_customers: newCustomers ?? 0,
      bot_conversations: botConvs ?? 0,
      human_takeovers: humanTakeovers ?? 0,
    };

    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[reports/usage]', message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
