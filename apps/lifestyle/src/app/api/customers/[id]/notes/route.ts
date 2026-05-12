// ─── PATCH /api/customers/[id]/notes ─────────────────────────────────────────
// Actualiza customers.notes para un cliente del negocio.
//
// Auth: requiere sesión activa — staff del mismo business_id.
// customer_id del path — nunca del body.
// Valida que el customer pertenece al business_id del staff autenticado.
//
// Body: { notes: string }  — máximo 500 caracteres (Zod).
// Retorna: { notes: string }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';

// ─── Validación ───────────────────────────────────────────────────────────────

const ParamSchema = z.object({
  id: z.string().uuid('customer id must be a UUID'),
});

const BodySchema = z.object({
  notes: z.string().max(500, 'notes must be 500 characters or fewer'),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Verificar sesión
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Validar path param
  const resolvedParams = await params;
  const paramParsed = ParamSchema.safeParse(resolvedParams);
  if (!paramParsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: paramParsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const customerId = paramParsed.data.id;

  // 3. Validar body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bodyParsed = BodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: bodyParsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { notes } = bodyParsed.data;

  // 4. Obtener staff autenticado + business_id
  const supabase = getServiceClient();
  const { data: staffRecord, error: staffError } = await supabase
    .from('staff')
    .select('business_id')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (staffError || !staffRecord) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const businessId = staffRecord.business_id as string;

  try {
    // 5. Actualizar notes — WHERE id AND business_id garantiza aislamiento
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update({ notes })
      .eq('id', customerId)
      .eq('business_id', businessId)
      .select('notes')
      .maybeSingle();

    if (updateError) throw new Error(`update failed: ${updateError.message}`);

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ notes: (updated as { notes: string | null }).notes ?? '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
