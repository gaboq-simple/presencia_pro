// ─── GET + PATCH /api/staff/[id]/services ─────────────────────────────────────
// Mapeo staff↔servicios: qué servicios hace un barbero (tabla staff_services).
//
// GET   → { service_ids: string[] }  — los servicios que hace hoy el barbero.
// PATCH → body { service_ids: string[] } — el SET COMPLETO (replace-all).
//
// Replace-all (molde /api/staff/[id]/schedule): borra los mapeos actuales del
// barbero e inserta el set nuevo. IMPORTANTE: solo toca mapeos a servicios
// ACTIVOS del negocio — si el barbero tenía asignado un servicio que luego se
// desactivó, ese mapeo se PRESERVA (el editor solo maneja servicios activos).
//
// Auth: getCurrentSession() — roles owner | admin. Sesiones de organización
//   bloqueadas (igual que /manage y /schedule). El barbero debe pertenecer al
//   business_id de la sesión (404). Los service_id deben ser servicios activos
//   de ese negocio (400 si alguno no pertenece).
//
// Post: invalida AMBAS caches — invalidateBusinessCache (engine, el mapeo alimenta
//   getStaffForService) + revalidateTag(`catalog-${businessId}`, 'max').

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
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

const StaffIdSchema = z.string().uuid('ID de staff inválido');

const BodySchema = z.object({
  service_ids: z.array(z.string().uuid('service_id inválido')).max(100, 'Demasiados servicios'),
});

// ─── Guard común ──────────────────────────────────────────────────────────────

type Guarded =
  | { ok: true; businessId: string; staffId: string; actorStaffId: string | null }
  | { ok: false; res: NextResponse };

async function guard(rawId: string): Promise<Guarded> {
  const session = await getCurrentSession();
  if (!session) {
    return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) };
  }
  if (session.role !== 'owner' && session.role !== 'admin') {
    return { ok: false, res: NextResponse.json({ error: 'Prohibido' }, { status: 403 }) };
  }
  if (session.type === 'organization') {
    return { ok: false, res: NextResponse.json({ error: 'Usa el token de sucursal para gestionar el staff' }, { status: 403 }) };
  }

  const parsedId = StaffIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return { ok: false, res: NextResponse.json({ error: 'ID inválido' }, { status: 400 }) };
  }

  const supabase = getServiceClient();
  const { data: existing } = await tenantDb(supabase, session.business_id)
    .table('staff')
    .select('id')
    .eq('id', parsedId.data)
    .maybeSingle();

  if (!existing) {
    return { ok: false, res: NextResponse.json({ error: 'Staff no encontrado' }, { status: 404 }) };
  }

  return { ok: true, businessId: session.business_id, staffId: parsedId.data, actorStaffId: session.staff_id };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const g = await guard(id);
  if (!g.ok) return g.res;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('staff_services')
    .select('service_id')
    .eq('staff_id', g.staffId);

  if (error) {
    return NextResponse.json({ error: 'Error al obtener servicios' }, { status: 500 });
  }

  const serviceIds = ((data ?? []) as Array<{ service_id: string }>).map((r) => r.service_id);
  return NextResponse.json({ service_ids: serviceIds });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const g = await guard(id);
  if (!g.ok) return g.res;
  const { businessId, staffId } = g;

  // Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 400 },
    );
  }

  const requestedIds = [...new Set(parsed.data.service_ids)]; // dedup (respeta PK compuesta)
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  // Servicios ACTIVOS del negocio — universo válido y ámbito del replace-all.
  const { data: activeRows, error: svcError } = await db
    .table('services')
    .select('id')
    .eq('active', true);

  if (svcError) {
    return NextResponse.json({ error: 'Error al validar servicios' }, { status: 500 });
  }

  const activeIds = new Set(((activeRows ?? []) as Array<{ id: string }>).map((r) => r.id));

  // Pertenencia: todo service_id del body debe ser un servicio activo del negocio.
  for (const sid of requestedIds) {
    if (!activeIds.has(sid)) {
      return NextResponse.json({ error: 'Uno o más servicios no pertenecen al negocio' }, { status: 400 });
    }
  }

  // `before` del audit: el mapeo actual COMPLETO del barbero (incluye mapeos a
  // servicios inactivos, que el replace-all preserva). Una query extra chica.
  const { data: beforeRows } = await supabase
    .from('staff_services')
    .select('service_id')
    .eq('staff_id', staffId);
  const beforeIds = ((beforeRows ?? []) as Array<{ service_id: string }>).map((r) => r.service_id);

  // Replace-all acotado a servicios activos: borra los mapeos del barbero a
  // servicios activos e inserta el set nuevo. Los mapeos a servicios inactivos
  // (si los hubiera) quedan intactos.
  if (activeIds.size > 0) {
    const { error: delError } = await supabase
      .from('staff_services')
      .delete()
      .eq('staff_id', staffId)
      .in('service_id', [...activeIds]);

    if (delError) {
      return NextResponse.json({ error: 'Error al limpiar el mapeo anterior' }, { status: 500 });
    }
  }

  if (requestedIds.length > 0) {
    const { error: insError } = await supabase
      .from('staff_services')
      .insert(requestedIds.map((sid) => ({ staff_id: staffId, service_id: sid })));

    if (insError) {
      return NextResponse.json({ error: 'Error al guardar el mapeo' }, { status: 500 });
    }
  }

  // Auditoría (best-effort): UNA fila con los sets before/after (no N por mapeo). El
  // `after` = mapeos inactivos preservados (before − activos) + el set nuevo pedido.
  const afterIds = [...beforeIds.filter((id) => !activeIds.has(id)), ...requestedIds];
  await logManagementAudit(supabase, {
    entity:       'staff_services',
    entityId:     staffId,               // el barbero cuyos servicios cambiaron
    action:       'services_changed',
    businessId,
    actorStaffId: g.actorStaffId,
    oldData:      { service_ids: beforeIds },
    newData:      { service_ids: afterIds },
  });

  // Invalidar AMBAS caches — el mapeo alimenta getStaffForService del bot.
  invalidateBusinessCache(businessId);
  revalidateTag(`catalog-${businessId}`, 'max');

  return NextResponse.json({ ok: true, service_ids: requestedIds });
}
