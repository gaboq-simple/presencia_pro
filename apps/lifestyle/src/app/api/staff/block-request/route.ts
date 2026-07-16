// ─── API: Staff Block Request ──────────────────────────────────────────────────
// POST /api/staff/block-request
//   Crea solicitud de bloqueo con status='pending'.
//   staff_id siempre del servidor — nunca del cuerpo del request.
//   Si urgent===true Y starts_at es hoy o mañana: WhatsApp al admin (best-effort).
//   Si no: solo crea la fila, sin WhatsApp.
//
// GET /api/staff/block-request
//   Barber: solicitudes propias (últimos 30 días).
//   Admin: todas las solicitudes pendientes del negocio (para la bandeja).

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { tenantDb } from '@/lib/tenantDb';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';
import type { MetaWhatsAppCredentials } from '@presenciapro/engine/notifications';

// ─── Service client ────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createServiceClient(url, key);
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const PostBodySchema = z.object({
  starts_at: z.string().datetime({ offset: true }),
  ends_at:   z.string().datetime({ offset: true }),
  reason:    z.string().max(500).nullable().optional(),
  urgent:    z.boolean().optional().default(false),
});

// ─── Row types ─────────────────────────────────────────────────────────────────

type BlockRequestRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  status: string;
  urgent: boolean;
  created_at: string;
};

// ─── Helper: leer staff autenticado ──────────────────────────────────────────

async function getAuthenticatedStaff(userId: string) {
  const supabase = getAdminClient();
  // eslint-disable-next-line no-restricted-syntax -- resolución de identidad del actor por auth_id (único global); el business_id sale de acá, no se conoce antes
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, business_id, role')
    .eq('auth_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as { id: string; name: string; business_id: string; role: string };
}

// ─── Helper: ¿starts_at es hoy o mañana? ─────────────────────────────────────

function isUrgentTiming(startsAt: string): boolean {
  const start = new Date(startsAt);
  const now = new Date();

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today    = new Date(now.getFullYear(),   now.getMonth(),   now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return startDay.getTime() === today.getTime() ||
         startDay.getTime() === tomorrow.getTime();
}

// ─── Row types locales ────────────────────────────────────────────────────────

type AdminStaffRow    = { whatsapp_id: string | null };
type BusinessPhoneRow = { whatsapp_phone_number_id: string | null };

// ─── Helper: notificación WhatsApp urgente al admin (best-effort) ─────────────

async function notifyAdminUrgent(
  staffName: string,
  businessId: string,
  startsAt: string,
  endsAt: string,
  reason: string | null | undefined,
): Promise<void> {
  const supabase = getAdminClient();

  const { data: adminStaffData } = await tenantDb(supabase, businessId)
    .table('staff')
    .select('whatsapp_id')
    .eq('role', 'admin')
    .eq('active', true)
    .not('whatsapp_id', 'is', null)
    .maybeSingle();

  const adminStaff = adminStaffData as AdminStaffRow | null;
  if (!adminStaff?.whatsapp_id) return;

  const { data: bizData } = await supabase
    .from('businesses')
    .select('whatsapp_phone_number_id')
    .eq('id', businessId)
    .maybeSingle();

  const biz = bizData as BusinessPhoneRow | null;
  if (!biz?.whatsapp_phone_number_id) return;

  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  if (!accessToken) return;

  const startDate = new Date(startsAt);
  const endDate   = new Date(endsAt);

  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const whenLabel = startDay.getTime() === today.getTime() ? 'hoy' : 'mañana';

  const startTime = startDate.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endTime = endDate.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const reasonText = reason ? ` Motivo: ${reason}.` : '';
  const body =
    `${staffName} marcó como URGENTE su solicitud de bloqueo para ` +
    `${whenLabel} ${startTime}–${endTime}.${reasonText} Revisa el dashboard.`;

  const creds: MetaWhatsAppCredentials = {
    accessToken,
    phoneNumberId: biz.whatsapp_phone_number_id,
  };
  await sendWhatsAppMeta({ to: adminStaff.whatsapp_id, body }, creds);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // 2. Obtener staff — staffId siempre del servidor
  const staff = await getAuthenticatedStaff(user.id);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (staff.role !== 'barber' && staff.role !== 'assistant') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  // 3. Validar body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 422 },
    );
  }

  const { starts_at, ends_at, reason, urgent } = parsed.data;

  // 4. Insertar solicitud con status='pending'
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('staff_blocks')
    .insert({
      staff_id:  staff.id,
      starts_at,
      ends_at,
      reason:    reason ?? null,
      status:    'pending',
      urgent,
    })
    .select('id, starts_at, ends_at, reason, status, urgent, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Error al crear solicitud' }, { status: 500 });
  }

  // 5. Notificación urgente: solo si urgent===true Y hoy/mañana — best-effort
  if (urgent && isUrgentTiming(starts_at)) {
    try {
      await notifyAdminUrgent(
        staff.name,
        staff.business_id,
        starts_at,
        ends_at,
        reason,
      );
    } catch {
      // Fallo silencioso — no interrumpe el flujo
    }
  }

  return NextResponse.json(data as BlockRequestRow, { status: 201 });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  void request;

  // 1. Auth
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // 2. Obtener staff
  const staff = await getAuthenticatedStaff(user.id);
  if (!staff) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = getAdminClient();

  // Admin: todas las solicitudes pendientes del negocio (bandeja de aprobaciones)
  if (staff.role === 'admin') {
    // Obtener staff_ids del negocio
    const { data: staffData, error: staffError } = await tenantDb(supabase, staff.business_id)
      .table('staff')
      .select('id')
      .eq('active', true);

    if (staffError) {
      return NextResponse.json({ error: 'Error al obtener solicitudes' }, { status: 500 });
    }

    const staffIds = ((staffData ?? []) as { id: string }[]).map((s) => s.id);

    if (staffIds.length === 0) {
      return NextResponse.json([] as BlockRequestRow[]);
    }

    const { data, error } = await supabase
      .from('staff_blocks')
      .select('id, staff_id, starts_at, ends_at, reason, status, urgent, created_at')
      .eq('status', 'pending')
      .in('staff_id', staffIds)
      .order('urgent', { ascending: false })
      .order('starts_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Error al obtener solicitudes' }, { status: 500 });
    }

    return NextResponse.json(data as BlockRequestRow[]);
  }

  // Barber / assistant: solicitudes propias de los últimos 30 días
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await supabase
    .from('staff_blocks')
    .select('id, starts_at, ends_at, reason, status, urgent, created_at')
    .eq('staff_id', staff.id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Error al obtener solicitudes' }, { status: 500 });
  }

  return NextResponse.json(data as BlockRequestRow[]);
}
