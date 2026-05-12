// ─── GET|PATCH /api/business/config ──────────────────────────────────────────
// Gestiona la configuración del negocio (reportes + reseñas).
//
// GET  → retorna { report_enabled, report_whatsapp, review_requests_enabled, review_url }
//
// PATCH body:
//   report_enabled?:          boolean
//   report_whatsapp?:         string (10–13 dígitos)
//   review_requests_enabled?: boolean
//   review_url?:              string (URL válida) | null
//   → Si review_requests_enabled=true y no hay review_url → 422
//
// Auth: requiere sesión activa con role='admin'.
// business_id siempre del servidor — nunca del cliente.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PatchBodySchema = z
  .object({
    report_enabled: z.boolean().optional(),
    report_whatsapp: z
      .string()
      .regex(/^\d{10,13}$/, 'report_whatsapp debe ser un número de 10 a 13 dígitos')
      .optional()
      .nullable(),
    review_requests_enabled: z.boolean().optional(),
    review_url: z
      .string()
      .url('review_url debe ser una URL válida')
      .optional()
      .nullable(),
  })
  .refine(
    (data) =>
      data.report_enabled          !== undefined ||
      data.report_whatsapp         !== undefined ||
      data.review_requests_enabled !== undefined ||
      data.review_url              !== undefined,
    { message: 'Se requiere al menos un campo a actualizar' },
  );

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<
  { ok: true; businessId: string } | { ok: false; status: 401 | 403; error: string }
> {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabase = getServiceClient();
  const { data: staffRecord, error } = await supabase
    .from('staff')
    .select('role, business_id')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (error || !staffRecord || staffRecord.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, businessId: staffRecord.business_id as string };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('businesses')
      .select('report_enabled, report_whatsapp, review_requests_enabled, review_url')
      .eq('id', auth.businessId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const updates: Record<string, boolean | string | null> = {};
  if (parsed.data.report_enabled          !== undefined) updates['report_enabled']          = parsed.data.report_enabled;
  if (parsed.data.report_whatsapp         !== undefined) updates['report_whatsapp']         = parsed.data.report_whatsapp;
  if (parsed.data.review_requests_enabled !== undefined) updates['review_requests_enabled'] = parsed.data.review_requests_enabled;
  if (parsed.data.review_url              !== undefined) updates['review_url']              = parsed.data.review_url;

  try {
    const supabase = getServiceClient();

    // Validar: review_requests_enabled=true requiere review_url
    if (updates['review_requests_enabled'] === true && !updates['review_url']) {
      const { data: current } = await supabase
        .from('businesses')
        .select('review_url')
        .eq('id', auth.businessId)
        .maybeSingle();

      const currentUrl = (current as { review_url: string | null } | null)?.review_url;
      if (!currentUrl) {
        return NextResponse.json(
          { error: 'review_url es obligatorio para activar las reseñas automáticas' },
          { status: 422 },
        );
      }
    }

    const { data, error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', auth.businessId)
      .select('report_enabled, report_whatsapp, review_requests_enabled, review_url')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
