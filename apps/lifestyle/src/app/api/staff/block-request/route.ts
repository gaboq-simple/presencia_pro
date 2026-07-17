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
import { requireBusinessSession } from '@/lib/auth';
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
  // 1. Auth — sesión de negocio (ls_session PIN/token o Supabase Auth).
  //    Soporta al barbero por PIN, que antes quedaba fuera (auth.getUser() null → 401).
  const auth = await requireBusinessSession();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 2. Solo barber/assistant CREAN solicitudes (owner/admin las aprueban en [id]).
  //    staffId siempre del servidor.
  if (auth.role !== 'barber' && auth.role !== 'assistant') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }
  const staffId    = auth.staffId;
  if (!staffId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const businessId = auth.businessId;

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

  // 4. Insertar solicitud con status='pending'.
  //    staff_blocks no tiene business_id (se scopea por staff_id) → .from() legítimo,
  //    fuera del tenant guard; el staff_id es del servidor.
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('staff_blocks')
    .insert({
      staff_id:  staffId,
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

  // 5. Notificación urgente: solo si urgent===true Y hoy/mañana — best-effort.
  //    El nombre del solicitante se resuelve acá (la sesión por PIN no lo trae).
  if (urgent && isUrgentTiming(starts_at)) {
    try {
      const { data: meData } = await tenantDb(supabase, businessId)
        .table('staff')
        .select('name')
        .eq('id', staffId)
        .maybeSingle();
      const staffName = (meData as { name: string } | null)?.name ?? 'Un miembro del equipo';
      await notifyAdminUrgent(
        staffName,
        businessId,
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

  // 1. Auth — sesión de negocio (ls_session PIN/token o Supabase Auth)
  const auth = await requireBusinessSession();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = getAdminClient();

  // Owner/Admin: todas las solicitudes pendientes del negocio (bandeja de aprobaciones)
  if (auth.role === 'admin' || auth.role === 'owner') {
    // Obtener staff_ids del negocio
    const { data: staffData, error: staffError } = await tenantDb(supabase, auth.businessId)
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

  // Barber / assistant: solicitudes PROPIAS de los últimos 30 días.
  //    El scope por staff_id garantiza que un barbero solo ve las suyas.
  const staffId = auth.staffId;
  if (!staffId) return NextResponse.json([] as BlockRequestRow[]);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await supabase
    .from('staff_blocks')
    .select('id, starts_at, ends_at, reason, status, urgent, created_at')
    .eq('staff_id', staffId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Error al obtener solicitudes' }, { status: 500 });
  }

  return NextResponse.json(data as BlockRequestRow[]);
}
