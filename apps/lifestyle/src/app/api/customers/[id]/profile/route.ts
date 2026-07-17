// ─── GET /api/customers/[id]/profile ─────────────────────────────────────────
// Retorna el perfil contextual completo de un cliente.
//
// Auth: requiere sesión activa — staff del mismo business_id.
// customer_id del path — nunca del body.
//
// Datos retornados (ClientProfile):
//   - Nombre, teléfono, visit_count, last_visit
//   - favorite_service: nombre del servicio (via customers.favorite_service_id)
//   - favorite_staff:   nombre del barbero (via customers.favorite_staff_id)
//   - notes: customers.notes
//   - upcoming_appointment: la cita próxima del barbero autenticado con este cliente

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireBusinessSession } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import type { ClientProfile } from '@/lib/dashboard.types';

// ─── Validación del path param ────────────────────────────────────────────────

const ParamSchema = z.object({
  id: z.string().uuid('customer id must be a UUID'),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Shapes internos ──────────────────────────────────────────────────────────

type RawCustomerRow = {
  id: string;
  name: string;
  phone: string;
  visit_count: number;
  last_visit: string | null;
  notes: string | null;
  favorite_service: { name: string } | null;
  favorite_staff: { name: string } | null;
};

type RawUpcomingRow = {
  starts_at: string;
  ends_at: string;
  service: { name: string } | null;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Verificar sesión — cualquier miembro del negocio (token/PIN o Supabase Auth).
  //    La próxima cita se scopea al staff_id de la sesión (feature del barbero).
  const auth = await requireBusinessSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 2. Validar path param
  const resolvedParams = await params;
  const parsed = ParamSchema.safeParse(resolvedParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const customerId = parsed.data.id;

  // 3. business_id + staff_id de la sesión (server-derivados, nunca del cliente)
  const supabase = getServiceClient();
  const businessId = auth.businessId;
  const staffId = auth.staffId;
  const db = tenantDb(supabase, businessId);

  try {
    // 4. Fetch del cliente con joins de servicio y barbero favoritos
    const { data: customerData, error: customerError } = await db
      .table('customers')
      .select(`
        id,
        name,
        phone,
        visit_count,
        last_visit,
        notes,
        favorite_service:favorite_service_id(name),
        favorite_staff:favorite_staff_id(name)
      `)
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) throw new Error(`customer query failed: ${customerError.message}`);

    if (!customerData) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const customer = customerData as unknown as RawCustomerRow;

    // 5. Próxima cita del barbero autenticado con este cliente (desde ahora).
    //    Sin staff_id en la sesión (p.ej. dueño por token) no hay cita atribuible.
    if (!staffId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    const { data: upcomingData, error: upcomingError } = await db
      .table('appointments')
      .select('starts_at, ends_at, service:service_id(name)')
      .eq('staff_id', staffId)
      .eq('customer_id', customerId)
      .gte('starts_at', now)
      .in('status', ['pending', 'confirmed'])
      .order('starts_at')
      .limit(1)
      .maybeSingle();

    if (upcomingError) throw new Error(`upcoming query failed: ${upcomingError.message}`);

    if (!upcomingData) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const upcoming = upcomingData as unknown as RawUpcomingRow;

    // 6. Construir ClientProfile
    const profile: ClientProfile = {
      customer_id: customer.id,
      name: customer.name,
      phone: customer.phone,
      visit_count: customer.visit_count,
      last_visit: customer.last_visit,
      favorite_service: customer.favorite_service?.name ?? null,
      favorite_staff: customer.favorite_staff?.name ?? null,
      notes: customer.notes,
      upcoming_appointment: {
        service_name: upcoming.service?.name ?? '',
        starts_at: upcoming.starts_at,
        ends_at: upcoming.ends_at,
      },
    };

    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
