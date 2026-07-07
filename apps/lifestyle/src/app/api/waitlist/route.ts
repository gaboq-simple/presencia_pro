// ─── GET /api/waitlist ────────────────────────────────────────────────────────
// Retorna entradas activas (status = 'waiting' | 'notified') de la lista
// de espera del negocio autenticado.
//
// Auth: requiere sesión de owner o admin del negocio (token o Supabase Auth).
// business_id siempre del servidor — nunca del cliente.
//
// Response: { waitlist: WaitlistEntry[] }
// JOIN: customers, services, staff

import { NextResponse } from 'next/server';
import { z }           from 'zod';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';
import type { WaitlistEntry } from '@/lib/dashboard.types';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createServiceClient(url, key);
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('waitlist')
      .select(`
        id,
        business_id,
        customer_id,
        service_id,
        staff_id,
        requested_date,
        requested_time_preference,
        status,
        notified_at,
        expires_at,
        created_at,
        customer:customer_id ( name, phone ),
        service:service_id   ( name ),
        staff:staff_id       ( name )
      `)
      .eq('business_id', auth.businessId)
      .in('status', ['waiting', 'notified'])
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Error al obtener lista de espera' }, { status: 500 });
    }

    // Mapear filas con joins a WaitlistEntry plano
    const waitlist: WaitlistEntry[] = ((data ?? []) as unknown as Array<{
      id:                        string;
      business_id:               string;
      customer_id:               string;
      service_id:                string;
      staff_id:                  string | null;
      requested_date:            string;
      requested_time_preference: string;
      status:                    'waiting' | 'notified' | 'confirmed' | 'expired';
      notified_at:               string | null;
      expires_at:                string | null;
      created_at:                string;
      customer: { name: string; phone: string } | null;
      service:  { name: string } | null;
      staff:    { name: string } | null;
    }>).map((row) => ({
      id:                        row.id,
      business_id:               row.business_id,
      customer_id:               row.customer_id,
      customer_name:             row.customer?.name ?? '—',
      customer_phone:            row.customer?.phone ?? '—',
      service_id:                row.service_id,
      service_name:              row.service?.name ?? '—',
      staff_id:                  row.staff_id,
      staff_name:                row.staff?.name ?? null,
      requested_date:            row.requested_date,
      requested_time_preference: row.requested_time_preference,
      status:                    row.status,
      notified_at:               row.notified_at,
      expires_at:                row.expires_at,
      created_at:                row.created_at,
    }));

    return NextResponse.json({ waitlist });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST — Notificar entrada manualmente ─────────────────────────────────────
// Permite al admin notificar una entrada 'waiting' sin esperar a que se libere
// una cita. Útil si hay slots disponibles y el admin quiere informar al cliente.
//
// body: { waitlist_id: UUID, slot_starts_at: ISO, staff_id: UUID, staff_name: string }

const NotifyBodySchema = z.object({
  waitlist_id:   z.string().uuid(),
  slot_starts_at: z.string().datetime({ offset: true }),
  staff_id:       z.string().uuid(),
  staff_name:     z.string().min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = NotifyBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 422 },
    );
  }

  const { waitlist_id, slot_starts_at, staff_id, staff_name } = parsed.data;

  try {
    // Verificar que la entrada pertenece al negocio del admin
    const supabase = getServiceClient();
    const { data: wlEntry } = await supabase
      .from('waitlist')
      .select('id, business_id, status')
      .eq('id', waitlist_id)
      .eq('business_id', auth.businessId)
      .eq('status', 'waiting')
      .maybeSingle();

    if (!wlEntry) {
      return NextResponse.json({ error: 'Entrada no encontrada o no está en espera' }, { status: 404 });
    }

    // Importar notifyWaitlist a través de una re-implementación inline
    // (no podemos importar del engine en un API route Next.js sin bundling)
    const notifiedAt = new Date();
    const expiresAt  = new Date(notifiedAt.getTime() + 30 * 60_000);

    await supabase
      .from('waitlist')
      .update({
        status:      'notified',
        notified_at: notifiedAt.toISOString(),
        expires_at:  expiresAt.toISOString(),
      })
      .eq('id', waitlist_id);

    // Obtener teléfono del cliente y datos del negocio para programar expiración
    const { data: fullEntry } = await supabase
      .from('waitlist')
      .select('business_id, customer:customer_id(id, phone), service:service_id(name)')
      .eq('id', waitlist_id)
      .maybeSingle();

    if (fullEntry) {
      const entry = fullEntry as unknown as {
        business_id: string;
        customer: { id: string; phone: string } | null;
        service:  { name: string } | null;
      };

      if (entry.customer) {
        await supabase.from('scheduled_notifications').insert({
          business_id:    entry.business_id,
          type:           'waitlist_expiry',
          scheduled_for:  expiresAt.toISOString(),
          customer_phone: entry.customer.phone,
          customer_id:    entry.customer.id,
          metadata: {
            waitlist_id,
            slot_starts_at,
            slot_staff_id:   staff_id,
            slot_staff_name: staff_name,
            service_name:    entry.service?.name ?? '',
          },
        });
      }
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
