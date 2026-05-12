// ─── API /api/leads/[id] ─────────────────────────────────────────────────────
// PATCH — actualiza el status de un lead del seller autenticado

import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { UpdateLeadStatusSchema } from '@presenciapro/engine/types';
import { getSession } from '@/lib/auth';
import type { Lead } from '@presenciapro/engine/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;

  const body: unknown = await request.json();
  const parsed = UpdateLeadStatusSchema.safeParse(body);

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
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('seller_id', session.seller.id) // Guard: solo puede editar sus propios leads
    .select()
    .single<Lead>();

  if (error) {
    // Guard: row not found returns PGRST116 when using .single()
    if (error.code === 'PGRST116') {
      return Response.json({ error: 'Lead no encontrado' }, { status: 404 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ lead });
}
