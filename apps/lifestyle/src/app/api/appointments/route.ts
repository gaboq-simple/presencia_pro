// ─── Appointments API ─────────────────────────────────────────────────────────
// GET  /api/appointments?date=YYYY-MM-DD[&staffId=UUID][&businessId=UUID]
//   → Devuelve citas del día para el negocio de la sesión activa.
//   → Requiere sesión autenticada (ls_session o Supabase Auth).
//   → businessId del query param solo se usa en sesiones de organización
//     y se valida contra session.business_ids. En sesiones de negocio directo
//     se ignora — el businessId siempre viene del servidor.
//   → Sesiones de barbero fuerzan staffId a su propio staff_id.
//
// POST /api/appointments
//   → Crea una nueva cita.
//   → Requiere sesión autenticada.
//   → businessId del body solo aplica en sesiones de organización
//     (se valida contra session.business_ids). En sesiones de negocio
//     directo se ignora — el businessId siempre viene del servidor.
//   → Input validado con Zod.
//
// PATCH /api/appointments
//   body: { id: UUID, status: 'completed' | 'cancelled' | 'confirmed' | 'no_show' }
//   → Actualiza el estado de la cita.
//   → businessId siempre del servidor — nunca del cliente.
//   → Si status='completed' y el negocio tiene review_requests_enabled=true:
//     programa scheduled_notification type='review_request' para 24h después.

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { notifyWaitlistOnCancel } from '@/lib/notifyWaitlistOnCancel';

// ─── UUID regex ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Input schemas ────────────────────────────────────────────────────────────

const GetQuerySchema = z.object({
  staffId:    z.string().uuid('staffId debe ser UUID').optional(),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
  // businessId solo se valida en sesiones de organización — ver handler
  businessId: z.string().optional(),
});

const PatchAppointmentSchema = z.object({
  id:     z.string().uuid('id debe ser UUID'),
  status: z.enum(['completed', 'cancelled', 'confirmed', 'no_show']),
});

const CreateAppointmentSchema = z.object({
  // businessId solo aplica en sesiones de organización — se ignora en sesiones
  // de negocio directo (el businessId viene del servidor, no del cliente).
  businessId:  z.string().uuid().optional(),
  staffId:     z.string().uuid(),
  serviceId:   z.string().uuid(),
  customerId:  z.string().uuid().optional(),
  startsAt:    z.string().datetime({ offset: true }),
  endsAt:      z.string().datetime({ offset: true }),
  source:      z.enum(['bot', 'manual', 'walkin']).default('manual'),
  notes:       z.string().max(500).optional(),
});

// ─── DB row type ──────────────────────────────────────────────────────────────

type AppointmentRow = {
  id: string;
  business_id: string;
  staff_id: string;
  service_id: string;
  customer_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  created_at: string;
};

// ─── Admin Supabase client ────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createServiceClient(url, key);
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth check — ls_session o Supabase Auth ─────────────────────────────────
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // ── Validate query params ───────────────────────────────────────────────────
  const parsed = GetQuerySchema.safeParse({
    staffId:    request.nextUrl.searchParams.get('staffId') ?? undefined,
    date:       request.nextUrl.searchParams.get('date'),
    businessId: request.nextUrl.searchParams.get('businessId') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Parámetros inválidos' },
      { status: 400 },
    );
  }

  const { staffId: rawStaffId, date, businessId: rawBusinessId } = parsed.data;

  // ── Resolver businessId desde la sesión — nunca del cliente ────────────────
  let businessId: string;

  if (session.type === 'organization') {
    // Sesiones de organización: el caller debe especificar qué sucursal consultar.
    if (!rawBusinessId || !UUID_RE.test(rawBusinessId)) {
      return NextResponse.json(
        { error: 'businessId requerido para sesiones de organización' },
        { status: 400 },
      );
    }
    if (!session.business_ids.includes(rawBusinessId)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    businessId = rawBusinessId;
  } else {
    // Sesiones de negocio directo (owner, assistant, barber):
    // siempre usamos el business_id de la sesión — ignoramos cualquier parámetro del cliente.
    businessId = session.business_id;
  }

  // ── Barbero: solo puede ver su propia agenda ────────────────────────────────
  let staffId = rawStaffId;
  if (session.role === 'barber' && session.staff_id) {
    staffId = session.staff_id;
  }

  // ── Date range for the requested day ────────────────────────────────────────
  const dayStart = `${date}T00:00:00+00:00`;
  const dayEnd   = `${date}T23:59:59+00:00`;

  const admin = getAdminClient();
  let query = admin
    .from('appointments')
    .select('*')
    .eq('business_id', businessId)
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at');

  if (staffId) {
    query = query.eq('staff_id', staffId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Error al obtener citas' }, { status: 500 });
  }

  return NextResponse.json({ appointments: (data ?? []) as AppointmentRow[] });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth check — ls_session o Supabase Auth ─────────────────────────────────
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // ── Parse and validate body ─────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = CreateAppointmentSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 422 },
    );
  }

  const { staffId, serviceId, customerId, startsAt, endsAt, source, notes } = parsed.data;

  // ── Resolver businessId desde la sesión — nunca del cliente ────────────────
  let businessId: string;

  if (session.type === 'organization') {
    // Sesiones de organización: el caller debe especificar la sucursal destino.
    const rawBizId = parsed.data.businessId;
    if (!rawBizId || !UUID_RE.test(rawBizId)) {
      return NextResponse.json(
        { error: 'businessId requerido para sesiones de organización' },
        { status: 400 },
      );
    }
    if (!session.business_ids.includes(rawBizId)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    businessId = rawBizId;
  } else {
    // Sesiones de negocio directo: siempre usamos el business_id de la sesión.
    businessId = session.business_id;
  }

  // ── Insert ──────────────────────────────────────────────────────────────────
  const admin = getAdminClient();

  const { data, error } = await admin
    .from('appointments')
    .insert({
      business_id: businessId,
      staff_id:    staffId,
      service_id:  serviceId,
      customer_id: customerId ?? null,
      starts_at:   startsAt,
      ends_at:     endsAt,
      status:      'pending',
      source,
      notes:       notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'Error al crear cita' }, { status: 500 });
  }

  return NextResponse.json({ appointment: data as AppointmentRow }, { status: 201 });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  // ── Auth check — ls_session o Supabase Auth ─────────────────────────────────
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Sesiones de organización no tienen business_id implícito para mutaciones.
  if (session.type === 'organization') {
    return NextResponse.json(
      { error: 'Usa el token de sucursal para gestionar citas' },
      { status: 403 },
    );
  }

  const businessId = session.business_id;

  // ── Parse and validate body ─────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = PatchAppointmentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 422 },
    );
  }

  const { id, status } = parsed.data;

  const admin = getAdminClient();

  // ── Gate: barbero solo puede mutar SUS citas ────────────────────────────────
  // Mismo predicado que el GET (route.ts ~139): role 'barber' + staff_id presente.
  // Recepcionista/dueño/admin y sesiones por token (staff_id null) → SIN
  // restricción, comportamiento intacto. El RLS "solo mis citas" existe pero es
  // INERTE bajo service_role: el enforcement vive aquí, no en la DB.
  if (session.role === 'barber' && session.staff_id) {
    const { data: target, error: targetError } = await admin
      .from('appointments')
      .select('staff_id')
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: 'Error al actualizar cita' }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 });
    }
    if ((target as { staff_id: string | null }).staff_id !== session.staff_id) {
      return NextResponse.json(
        { error: 'Solo puedes modificar tus propias citas' },
        { status: 403 },
      );
    }
  }

  // ── Update — solo si pertenece a este negocio ───────────────────────────────
  // Atribución: registramos quién tocó la cita (mismo patrón que el panel del
  // asistente — migración 023). staff_id puede ser null en sesiones por token
  // (owner/admin): se guarda null, no rompe el FK (columna nullable).
  const { data: updatedAppt, error: updateError } = await admin
    .from('appointments')
    .update({
      status,
      modified_by_staff_id: session.staff_id ?? null,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', id)
    .eq('business_id', businessId)
    .select('id, customer_id, business_id, starts_at, staff_id')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: 'Error al actualizar cita' }, { status: 500 });
  }
  if (!updatedAppt) {
    return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 });
  }

  // ── Cancelar recordatorios pendientes si la cita se cancela o no se presenta
  if (status === 'cancelled' || status === 'no_show') {
    await admin
      .from('scheduled_notifications')
      .update({ failed_at: new Date().toISOString() })
      .eq('appointment_id', id)
      .is('sent_at', null)
      .is('failed_at', null);

    // Notificar waitlist si hay clientes en espera para ese slot — best-effort
    try {
      const appt = updatedAppt as unknown as { starts_at: string; staff_id: string | null };
      await notifyWaitlistOnCancel(admin, businessId, appt.starts_at, appt.staff_id ?? null);
    } catch {
      // best-effort — el cambio de estado ya fue exitoso
    }
  }

  // ── Disparar solicitud de reseña si status=completed ───────────────────────
  if (status === 'completed') {
    await scheduleReviewRequest(
      updatedAppt as { id: string; customer_id: string | null; business_id: string },
      admin,
    );
  }

  return NextResponse.json({ appointment: updatedAppt as AppointmentRow });
}

// ─── scheduleReviewRequest ────────────────────────────────────────────────────
// Best-effort — nunca lanza. Si falla, la cita sigue como 'completed'.

type AdminClient = ReturnType<typeof getAdminClient>;

async function scheduleReviewRequest(
  appt:  { id: string; customer_id: string | null; business_id: string },
  admin: AdminClient,
): Promise<void> {
  try {
    if (!appt.customer_id) return;

    // Verificar configuración del negocio
    const { data: bizData } = await admin
      .from('businesses')
      .select('review_requests_enabled, review_url, name, whatsapp_phone_number_id')
      .eq('id', appt.business_id)
      .maybeSingle();

    const biz = bizData as {
      review_requests_enabled: boolean;
      review_url:              string | null;
      name:                    string;
      whatsapp_phone_number_id: string;
    } | null;

    if (!biz?.review_requests_enabled || !biz.review_url) return;

    // Obtener datos del cliente
    const { data: custData } = await admin
      .from('customers')
      .select('id, name, phone')
      .eq('id', appt.customer_id)
      .maybeSingle();

    if (!custData) return;

    const cust = custData as { id: string; name: string; phone: string };
    const firstName    = cust.name.split(' ')[0] ?? cust.name;
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const messageBody  =
      `Hola ${firstName}, ¿qué tal tu experiencia hoy en ${biz.name}? 💈 ` +
      `Si tienes un momento, tu opinión nos ayuda mucho → ${biz.review_url}`;

    await admin.from('scheduled_notifications').insert({
      business_id:    appt.business_id,
      appointment_id: appt.id,
      type:           'review_request',
      scheduled_for:  scheduledFor,
      customer_phone: cust.phone,
      customer_id:    cust.id,
      message_body:   messageBody,
    });
  } catch {
    // best-effort — no bloquear el flujo de completado
  }
}
