// ─── API /api/leads ─────────────────────────────────────────────────────────
// GET  — lista los leads del seller autenticado
// POST — crea un nuevo lead

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { CreateLeadSchema } from '@presenciapro/engine/types';
import { getSession } from '@/lib/auth';
import type { Lead } from '@presenciapro/engine/types';
import { notifySellerLeadRegistered, notifyOperatorNewLead } from '@/lib/notify-seller';

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('seller_id', session.seller.id)
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ leads: leads as Lead[] });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  const body: unknown = await request.json();
  const parsed = CreateLeadSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = createServiceClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({ ...parsed.data, seller_id: session.seller.id })
    .select()
    .single<Lead>();

  if (error) {
    // Guard: unique violation on doctor_phone
    if (error.code === '23505') {
      return Response.json(
        { error: 'Este número ya fue registrado por otro vendedor' },
        { status: 409 },
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  try {
    await Promise.all([
      notifySellerLeadRegistered({
        seller: session.seller,
        doctorName: parsed.data.doctor_name,
        city: parsed.data.city,
        specialty: parsed.data.specialty,
      }),
      notifyOperatorNewLead({
        seller: session.seller,
        doctorName: parsed.data.doctor_name,
        doctorPhone: parsed.data.doctor_phone,
        city: parsed.data.city,
        specialty: parsed.data.specialty,
      }),
    ]);
  } catch { /* best-effort */ }

  return Response.json({ lead }, { status: 201 });
}
