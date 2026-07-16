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
import { revalidateTag } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

// ─── Schema Zod ───────────────────────────────────────────────────────────────

const BodySchema = z.object({
  name:        z.string().trim().min(1, 'El nombre es requerido').max(80, 'Máximo 80 caracteres'),
  role:        z.enum(['barber', 'assistant', 'admin']).optional().default('barber'),
  phone:       z.string().trim().max(40, 'Teléfono demasiado largo').nullable().optional(),
  whatsapp_id: z.string().trim().max(40).nullable().optional(),
  photo_url:   z.string().url('photo_url debe ser una URL válida').nullable().optional(),
  // Servicios que hace (staff_services). Obligatorio ≥1 para 'barber' (el alta ya no
  // deja barberos huérfanos sin servicios — invisibles en mesa/landing por el nuevo
  // discriminador). Opcional para assistant/admin (un asistente no atiende; un admin
  // que corta puede recibir servicios acá para aparecer como agendable desde el alta).
  service_ids: z.array(z.string().uuid('service_id inválido')).max(100, 'Demasiados servicios').optional(),
});

// ─── PIN único por negocio ──────────────────────────────────────────────────

/** Genera un PIN de 4 dígitos que no colisione con los PINs existentes del negocio. */
async function generateCandidatePin(
  supabase: SupabaseClient,
  businessId: string,
): Promise<string> {
  const { data } = await tenantDb(supabase, businessId)
    .table('staff')
    .select('pin')
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
  const db = tenantDb(supabase, businessId);

  // 2b. Servicios que hará el staff. Validamos ANTES de insertar el staff para que,
  //     una vez creada la fila, el único motivo de fallo del mapeo sea un error
  //     transitorio de DB (no un dato inválido) → el rollback compensatorio es raro.
  const requestedServiceIds = [...new Set(d.service_ids ?? [])]; // dedup (PK compuesta)

  // Regla: 'barber' DEBE tener ≥1 servicio (no se crean barberos sin servicios).
  if (d.role === 'barber' && requestedServiceIds.length === 0) {
    return NextResponse.json(
      { error: 'Un barbero necesita al menos un servicio. Seleccioná uno o creá un servicio primero.' },
      { status: 400 },
    );
  }

  // Pertenencia: cada service_id debe ser un servicio ACTIVO de ESTE negocio
  // (mismo criterio que PATCH /api/staff/[id]/services).
  if (requestedServiceIds.length > 0) {
    const { data: activeRows, error: svcError } = await db
      .table('services')
      .select('id')
      .eq('active', true);

    if (svcError) {
      return NextResponse.json({ error: 'Error al validar servicios' }, { status: 500 });
    }

    const activeIds = new Set(((activeRows ?? []) as Array<{ id: string }>).map((r) => r.id));
    for (const sid of requestedServiceIds) {
      if (!activeIds.has(sid)) {
        return NextResponse.json(
          { error: 'Uno o más servicios no pertenecen al negocio' },
          { status: 400 },
        );
      }
    }
  }

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

    const { data: row, error } = await db
      .table('staff')
      .insert({
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

  // 3b. Mapear servicios (staff_services). Ya validados arriba, así que un fallo acá
  //     es transitorio. Atomicidad: sin transacción cross-tabla en el cliente JS →
  //     rollback compensatorio. Si el mapeo falla, BORRAMOS el staff recién creado
  //     (no tiene dependientes aún) para no dejar un barbero huérfano sin servicios,
  //     que es exactamente el estado que este alta elimina por construcción.
  if (requestedServiceIds.length > 0) {
    const { error: mapError } = await supabase
      .from('staff_services')
      .insert(requestedServiceIds.map((sid) => ({ staff_id: created.id, service_id: sid })));

    if (mapError) {
      const { error: cleanupError } = await db.table('staff').delete().eq('id', created.id);
      if (cleanupError) {
        // Doble fallo (mapeo + limpieza): queda un staff huérfano. Log fuerte para
        // reconciliación manual — no debería ocurrir salvo caída de DB entre pasos.
        console.error(JSON.stringify({
          ts:          new Date().toISOString(),
          route:       'POST /api/staff',
          event:       'orphan_staff_cleanup_failed',
          business_id: businessId,
          staff_id:    created.id,
          map_error:   mapError.message,
          cleanup_err: cleanupError.message,
        }));
      }
      return NextResponse.json({ error: 'Error al asignar los servicios, intenta de nuevo' }, { status: 500 });
    }
  }

  // 3c. Auditoría (best-effort). El alta = staff + mapeo es UNA acción del dueño →
  //     UNA fila 'created' con los servicios mapeados en new_data (el PIN lo saca el
  //     helper). No dos filas: el dueño lo piensa como un solo gesto.
  await logManagementAudit(supabase, {
    entity:       'staff',
    entityId:     created.id,
    action:       'created',
    businessId,
    actorStaffId: session.staff_id,
    newData: {
      name:        created.name,
      role:        created.role,
      phone:       created.phone,
      whatsapp_id: created.whatsapp_id,
      photo_url:   created.photo_url,
      active:      created.active,
      service_ids: requestedServiceIds,
    },
  });

  // 4. Invalidar AMBAS caches — el alta ahora toca el catálogo (staff_services alimenta
  //    getStaffForService del engine + el /api/catalog cacheado por tag).
  invalidateBusinessCache(businessId);
  revalidateTag(`catalog-${businessId}`, 'max');

  return NextResponse.json(created, { status: 201 });
}
