// ─── API: Staff Block Request — PATCH ─────────────────────────────────────────
// PATCH /api/staff/block-request/[id]
//   Solo owner o admin puede cambiar status → 'approved' | 'rejected'.
//   Verifica que el staff_block.staff_id pertenece al mismo business_id de la sesión.

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';

// ─── Service client ────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createServiceClient(url, key);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const PatchBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

// ─── Row types ─────────────────────────────────────────────────────────────────

type BlockRequestRow = {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  status: string;
  created_at: string;
};

// ─── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth: owner o admin del negocio (token o Supabase Auth)
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = getAdminClient();

  // 3. Validar body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' },
      { status: 422 },
    );
  }

  const { status } = parsed.data;
  const { id } = await params;

  // 4. Verificar que la solicitud existe y pertenece al negocio del admin
  const { data: blockRow, error: blockError } = await supabase
    .from('staff_blocks')
    .select('id, staff_id, starts_at, ends_at, reason, status, created_at')
    .eq('id', id)
    .maybeSingle();

  if (blockError || !blockRow) {
    return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
  }

  const block = blockRow as BlockRequestRow;

  // 5. Verificar que el barbero pertenece al mismo negocio del admin
  const { data: targetStaff, error: targetError } = await tenantDb(supabase, auth.businessId)
    .table('staff')
    .select('business_id')
    .eq('id', block.staff_id)
    .maybeSingle();

  if (targetError || !targetStaff) {
    return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
  }

  if ((targetStaff as { business_id: string }).business_id !== auth.businessId) {
    return NextResponse.json({ error: 'Prohibido' }, { status: 403 });
  }

  // 6. Actualizar status
  const { data: updated, error: updateError } = await supabase
    .from('staff_blocks')
    .update({ status })
    .eq('id', id)
    .select('id, starts_at, ends_at, reason, status, created_at')
    .single();

  if (updateError) {
    return NextResponse.json({ error: 'Error al actualizar solicitud' }, { status: 500 });
  }

  return NextResponse.json(updated as Omit<BlockRequestRow, 'staff_id'>);
}
