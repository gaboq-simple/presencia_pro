// ─── PATCH /api/services/[id] ─────────────────────────────────────────────────
// Edita un servicio del catálogo. "Eliminar" = soft-delete (active=false); las
// FK de appointments son NO ACTION, un hard-delete fallaría si tiene citas.
// También permite reactivar (active=true).
//
// Body JSON (todos opcionales, al menos uno requerido):
//   name, price, duration_minutes, description, price_min, price_max,
//   price_note, currency, active
//
// Auth: getCurrentSession() — roles owner | admin. Sesiones de organización
//   bloqueadas (igual que /api/staff/[id]/manage). El servicio debe pertenecer
//   al business_id de la sesión → 404 si no.
//
// Post: invalida AMBAS caches del catálogo — invalidateBusinessCache (engine)
//   + revalidateTag(`catalog-${businessId}`) (Next /api/catalog).
//
// Retorna: el servicio actualizado.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';
import { ServiceUpdateSchema } from '../schema';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

const ServiceIdSchema = z.string().uuid('ID de servicio inválido');

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
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

  if (session.type === 'organization') {
    return NextResponse.json(
      { error: 'Usa el token de sucursal para gestionar el catálogo' },
      { status: 403 },
    );
  }

  const businessId = session.business_id;

  // 2. Validar ID del path
  const { id: rawId } = await params;
  const parsedId = ServiceIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: parsedId.error.issues[0]?.message ?? 'ID inválido' },
      { status: 400 },
    );
  }
  const serviceId = parsedId.data;

  // 3. Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const parsed = ServiceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // 4. Verificar que el servicio pertenece al negocio de la sesión
  const supabase = getServiceClient();
  const { data: existing, error: fetchError } = await supabase
    .from('services')
    .select('id, business_id')
    .eq('id', serviceId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });
  }

  // 5. Construir update — solo los campos presentes (undefined = no tocar;
  //    null explícito = limpiar, para description/price_min/max/note).
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) updates[key] = value;
  }

  const { data: updated, error: updateError } = await supabase
    .from('services')
    .update(updates)
    .eq('id', serviceId)
    .select('id, name, description, price, price_min, price_max, price_note, currency, duration_minutes, active')
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Error al actualizar el servicio' }, { status: 500 });
  }

  // 6. Invalidar AMBAS caches del catálogo
  invalidateBusinessCache(businessId);
  revalidateTag(`catalog-${businessId}`, 'max');

  return NextResponse.json(updated);
}
