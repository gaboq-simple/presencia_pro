// ─── POST /api/staff/[id]/day-off ─────────────────────────────────────────────
// Crea un dia libre (bloqueo completo del dia) para un barbero.
// El admin/owner es la autoridad — el bloqueo se crea aprobado directamente.
//
// Body JSON:
//   {
//     date:    string,   // "YYYY-MM-DD"
//     reason?: string    // motivo opcional
//   }
//
// Nota: "dia extra" (type='extra') esta documentado como TODO.
//   Requeriria una tabla staff_availability_overrides con fecha especifica,
//   mas cambios en el scheduling engine — fuera del scope de esta sesion.
//
// Advertencia: si hay citas confirmed/pending ese dia, el response incluye
//   { warning: true, appointments_count: N } ademas de los datos del bloqueo.
//   El cliente puede mostrar el aviso y pedir confirmacion al usuario.
//   La solicitud con { force: true } en el body omite la verificacion de citas.
//
// Auth: getCurrentSession() — roles owner | admin.
//   El staff target debe pertenecer al mismo business_id de la sesion.
//   Sesiones de organizacion bloqueadas.
//
// Post: invalidateBusinessCache(businessId).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession, getBusinessTimezone } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';
import { logManagementAudit } from '@/lib/managementAudit';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const StaffIdSchema = z.string().uuid('ID de staff invalido');

const BodySchema = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha invalido — usar YYYY-MM-DD'),
  reason: z.string().max(500).optional(),
  force:  z.boolean().optional().default(false),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  const businessId = session.business_id;

  // 2. Validar staff ID del path
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: parsedId.error.issues[0]?.message ?? 'ID invalido' },
      { status: 400 },
    );
  }
  const staffId = parsedId.data;

  // 3. Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalido' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos invalidos' },
      { status: 400 },
    );
  }

  const { date, reason, force } = parsed.data;

  // 4. Verificar que la fecha no es pasada (permitir hoy y futuro).
  // "Hoy" en la tz del NEGOCIO — con el naive UTC, un admin marcando HOY libre
  // después de las 18:00 MX recibía "día pasado" (el server ya iba en mañana).
  const tz = await getBusinessTimezone(businessId);
  const today = todayStrInTz(tz);
  if (date < today) {
    return NextResponse.json(
      { error: 'No se puede marcar un dia pasado como libre' },
      { status: 400 },
    );
  }

  // 5. Verificar que el staff pertenece al negocio de la sesion
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const { data: existing } = await db
    .table('staff')
    .select('id, name')
    .eq('id', staffId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });
  }

  // Ventana del día en la tz del NEGOCIO (no UTC): sin esto, en México (UTC-6) el
  // "día" corría de las 18:00 de ayer a las 17:59 de hoy → el chequeo ignoraba las
  // citas de la tarde y el bloque cubría el día equivocado. (tz ya resuelta arriba,
  // para el guard de "no pasado".)
  const { start: dayStart, end: dayEnd } = localDayRangeUtc(date, tz);

  // 6. Verificar si hay citas confirmadas/pendientes ese dia (si no es force)
  if (!force) {
    const { data: appts } = await db
      .table('appointments')
      .select('id')
      .eq('staff_id', staffId)
      .gte('starts_at', dayStart)
      .lt('starts_at', dayEnd)
      .in('status', ['confirmed', 'pending']);

    const count = (appts ?? []).length;
    if (count > 0) {
      return NextResponse.json(
        {
          warning:            true,
          appointments_count: count,
          message:            `${(existing as { id: string; name: string }).name} tiene ${count} ${count === 1 ? 'cita' : 'citas'} el ${date}. Pasa force=true para confirmar.`,
        },
        { status: 200 },
      );
    }
  }

  // 7. Crear el bloqueo — todo el dia (en la tz del negocio), aprobado directamente.
  //    dayStart..dayEnd = [00:00, 24:00) locales como instantes UTC.
  const { data: block, error: insertError } = await supabase
    .from('staff_blocks')
    .insert({
      staff_id:  staffId,
      starts_at: dayStart,
      ends_at:   dayEnd,
      reason:    reason ?? null,
      status:    'approved',
      urgent:    false,
    })
    .select('id, staff_id, starts_at, ends_at, reason, status, created_at')
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: 'Error al crear dia libre' },
      { status: 500 },
    );
  }

  // 8. Auditoría (best-effort — mismo patrón que las demás rutas de gestión; un fallo
  //    del audit NO revierte el día libre ya creado). Firma con el staff_id del dueño.
  await logManagementAudit(supabase, {
    entity:        'staff',
    entityId:      staffId,
    action:        'updated',
    businessId,
    actorStaffId:  session.staff_id,
    oldData:       null,
    newData:       { day_off_date: date, reason: reason ?? null, block_id: (block as { id: string }).id },
    changedFields: ['day_off'],
  });

  // 9. Invalidar cache del bot
  invalidateBusinessCache(businessId);

  return NextResponse.json({ ok: true, block }, { status: 201 });
}
