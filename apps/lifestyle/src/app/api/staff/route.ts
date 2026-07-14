// ─── POST /api/staff ──────────────────────────────────────────────────────────
// Da de alta un miembro del staff nuevo (caso principal: barbero).
//
// Body JSON:
//   name         — string (requerido)
//   role         — 'barber' | 'assistant' | 'admin' (opcional; default 'barber')
//   phone        — string | null (opcional; default '' — la columna es NOT NULL)
//   whatsapp_id  — string | null (opcional; default '' — la columna es NOT NULL)
//   photo_url    — string(url) | null (opcional)
//
// El PIN NO viene del cliente: el servidor genera uno de 4 dígitos único dentro
// del negocio (replica la lógica del script de onboarding, chequeando colisiones
// contra los PINs existentes y reintentando ante carrera).
//
// Auth: getCurrentSession() — roles owner | admin. Sesiones de organización
//   bloqueadas (igual que /api/staff/[id]/manage y /api/services). business_id
//   sale de la sesión (nunca del cliente).
//
// Post: invalidateBusinessCache(businessId) — el cache del engine incluye staff.
//
// Retorna: el staff creado + su PIN (para mostrárselo al dueño).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCurrentSession } from '@/lib/auth';
import { invalidateBusinessCache } from '@presenciapro/engine/bot';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Schema Zod ───────────────────────────────────────────────────────────────

const BodySchema = z.object({
  name:        z.string().trim().min(1, 'El nombre es requerido').max(80, 'Máximo 80 caracteres'),
  role:        z.enum(['barber', 'assistant', 'admin']).optional().default('barber'),
  phone:       z.string().trim().max(40, 'Teléfono demasiado largo').nullable().optional(),
  whatsapp_id: z.string().trim().max(40).nullable().optional(),
  photo_url:   z.string().url('photo_url debe ser una URL válida').nullable().optional(),
});

// ─── PIN único por negocio ──────────────────────────────────────────────────

/** Genera un PIN de 4 dígitos que no colisione con los PINs existentes del negocio. */
async function generateCandidatePin(
  supabase: SupabaseClient,
  businessId: string,
): Promise<string> {
  const { data } = await supabase
    .from('staff')
    .select('pin')
    .eq('business_id', businessId)
    .not('pin', 'is', null);

  const taken = new Set(
    ((data ?? []) as Array<{ pin: string | null }>).map((r) => (r.pin ?? '').trim()),
  );

  for (let i = 0; i < 200; i++) {
    const pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!taken.has(pin)) return pin;
  }
  throw new Error('PIN_POOL_EXHAUSTED');
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
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
      { error: 'Usa el token de sucursal para gestionar el staff' },
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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const supabase = getServiceClient();

  // 3. Insertar con PIN único — reintentar si una carrera provoca colisión (23505).
  type CreatedStaff = {
    id: string; name: string; role: string; phone: string;
    whatsapp_id: string; photo_url: string | null; active: boolean; pin: string | null;
  };
  let created: CreatedStaff | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    let pin: string;
    try {
      pin = await generateCandidatePin(supabase, businessId);
    } catch {
      return NextResponse.json({ error: 'No hay PINs disponibles en el negocio' }, { status: 409 });
    }

    const { data: row, error } = await supabase
      .from('staff')
      .insert({
        business_id: businessId,
        name:        d.name,
        role:        d.role,
        phone:       d.phone ?? '',        // NOT NULL — '' como el script de onboarding
        whatsapp_id: d.whatsapp_id ?? '',  // NOT NULL — ''
        photo_url:   d.photo_url ?? null,
        pin,
        active:      true,
      })
      .select('id, name, role, phone, whatsapp_id, photo_url, active, pin')
      .single();

    if (!error && row) {
      created = row as CreatedStaff;
      break;
    }

    // 23505 = unique_violation (idx_staff_business_pin). Reintentar con otro PIN.
    if ((error as { code?: string } | null)?.code === '23505') continue;

    return NextResponse.json({ error: 'Error al crear el miembro del staff' }, { status: 500 });
  }

  if (!created) {
    return NextResponse.json({ error: 'No se pudo generar un PIN único, intenta de nuevo' }, { status: 409 });
  }

  // 4. Invalidar cache del engine (incluye staff activo)
  invalidateBusinessCache(businessId);

  return NextResponse.json(created, { status: 201 });
}
