// ─── PATCH /api/staff/[id]/manage ─────────────────────────────────────────────
// Actualiza campos de gestión de un miembro del staff.
//
// Body JSON (todos opcionales, al menos uno requerido):
//   active  — boolean  — activa o desactiva el staff
//   pin     — string (4 dígitos) | null  — cambia o borra el PIN del barbero
//
// Auth: requiere sesión con role='owner' | 'admin'.
//   El staff target debe pertenecer al mismo business_id de la sesión.
//
// Retorna: { id, active, pin } — los campos actualizados.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';
import { logManagementAudit } from '@/lib/managementAudit';
import { tenantDb } from '@/lib/tenantDb';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const StaffIdSchema = z.string().uuid('ID de staff inválido');

const BodySchema = z
  .object({
    active: z.boolean().optional(),
    pin:    z.union([z.string().regex(/^\d{4}$/, 'PIN debe ser 4 dígitos'), z.null()]).optional(),
  })
  .refine(
    (b) => b.active !== undefined || b.pin !== undefined,
    { message: 'Debe incluir al menos un campo: active o pin' },
  );

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth — ls_session o Supabase Auth
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Solo owner / admin pueden gestionar staff
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  // Sesiones de organización no tienen business_id implícito en esta versión.
  // El soporte de mutaciones multi-sucursal se completa en Sesión 15.
  if (session.type === 'organization') {
    return NextResponse.json({ error: 'Usa el token de sucursal para gestionar staff' }, { status: 403 });
  }

  const businessId = session.business_id;

  // 2. Validar staff ID del path
  const { id: rawId } = await params;
  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: parsedId.error.issues[0]?.message ?? 'ID inválido' },
      { status: 400 },
    );
  }
  const staffId = parsedId.data;

  // 3. Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { active, pin } = parsed.data;

  // 4. Verificar que el staff target pertenece al mismo negocio. Vía tenantDb:
  //    el .eq('business_id') lo inyecta el helper → el `.eq('id')` acota a la fila.
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);
  const { data: existing, error: fetchError } = await db
    .table('staff')
    .select('id, active, pin')
    .eq('id', staffId)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 });
  }

  // 5. Construir el update — solo los campos presentes en el body
  const updates: Record<string, unknown> = {};
  if (active !== undefined) updates['active'] = active;
  if (pin !== undefined)    updates['pin']    = pin;  // null borra el PIN

  const { data: updated, error: updateError } = await db
    .table('staff')
    .update(updates)
    .eq('id', staffId)
    .select('id, active, pin')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Error al actualizar staff' }, { status: 500 });
  }

  // Auditoría (best-effort). El PIN NUNCA va en old/new_data (el helper lo saca igual):
  // un cambio de PIN se registra como el hecho 'pin' en changed_fields, sin el valor.
  // La acción distingue el toggle de active del cambio de PIN suelto.
  const changedFields = Object.keys(updates); // 'active' y/o 'pin'
  const action =
    active === undefined ? 'updated'          // solo cambió el PIN
    : active ? 'reactivated' : 'deactivated';
  await logManagementAudit(supabase, {
    entity:        'staff',
    entityId:      staffId,
    action,
    businessId,
    actorStaffId:  session.staff_id,
    oldData:       { active: existing.active },
    newData:       { active: updated.active },
    changedFields,
  });

  // Invalidar cache del bot — el staff activo puede haber cambiado
  invalidateBusinessCache(businessId);

  return NextResponse.json(updated);
}
