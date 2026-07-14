// ─── POST /api/services ───────────────────────────────────────────────────────
// Crea un servicio nuevo en el catálogo del negocio.
//
// Body JSON:
//   name              — string (requerido)
//   price             — number >= 0 (requerido)
//   duration_minutes  — int > 0 (requerido)
//   description       — string | null (opcional)
//   price_min         — number >= 0 | null (opcional; rango)
//   price_max         — number >= 0 | null (opcional; rango)
//   price_note        — string | null (opcional)
//   currency          — string (opcional; default 'MXN')
//
// Auth: getCurrentSession() — roles owner | admin. Sesiones de organización
//   bloqueadas (igual que /api/staff/[id]/manage). El asistente/barbero NO
//   gestionan el catálogo. business_id sale de la sesión (nunca del cliente).
//
// Post: invalida AMBAS caches del catálogo — invalidateBusinessCache (engine)
//   + revalidateTag(`catalog-${businessId}`) (Next /api/catalog).
//
// Retorna: el servicio creado.

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';
import { ServiceCreateSchema } from './schema';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth — ls_session o Supabase Auth
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Solo owner / admin gestionan el catálogo
  if (session.role !== 'owner' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  // Sesiones de organización no tienen business_id implícito (igual que /manage).
  if (session.type === 'organization') {
    return NextResponse.json(
      { error: 'Usa el token de sucursal para gestionar el catálogo' },
      { status: 403 },
    );
  }

  const businessId = session.business_id;

  // 2. Validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const parsed = ServiceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // 3. Insertar
  const supabase = getServiceClient();
  const { data: created, error: insertError } = await supabase
    .from('services')
    .insert({
      business_id:      businessId,
      name:             d.name,
      description:      d.description ?? null,
      price:            d.price,
      price_min:        d.price_min ?? null,
      price_max:        d.price_max ?? null,
      price_note:       d.price_note ?? null,
      currency:         d.currency ?? 'MXN',
      duration_minutes: d.duration_minutes,
      active:           true,
    })
    .select('id, name, description, price, price_min, price_max, price_note, currency, duration_minutes, active')
    .single();

  if (insertError || !created) {
    return NextResponse.json({ error: 'Error al crear el servicio' }, { status: 500 });
  }

  // 4. Invalidar AMBAS caches del catálogo
  invalidateBusinessCache(businessId);
  revalidateTag(`catalog-${businessId}`, 'max');

  return NextResponse.json(created, { status: 201 });
}
