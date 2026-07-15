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
// Auth: requiere sesión de owner o admin del negocio (token o Supabase Auth).
// business_id siempre del servidor — nunca del cliente.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { logManagementAudit } from '@/lib/managementAudit';

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

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwnerOrAdmin();
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
  const auth = await requireOwnerOrAdmin();
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

  const CONFIG_FIELDS = 'report_enabled, report_whatsapp, review_requests_enabled, review_url';

  try {
    const supabase = getServiceClient();

    // Estado previo — sirve para la validación de review_url Y como `before` del audit.
    const { data: before } = await supabase
      .from('businesses')
      .select(CONFIG_FIELDS)
      .eq('id', auth.businessId)
      .maybeSingle();

    // Validar: review_requests_enabled=true requiere review_url (nueva o ya guardada)
    if (updates['review_requests_enabled'] === true && !updates['review_url']) {
      const currentUrl = (before as { review_url: string | null } | null)?.review_url;
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
      .select(CONFIG_FIELDS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

    // Auditoría (best-effort). PATCH por campo → UNA fila 'updated' con changed_fields.
    // report_whatsapp (teléfono del PROPIO dueño, no de un cliente) se guarda ENTERO —
    // sin maskPhone: es su dato de contacto, no PII de tercero.
    await logManagementAudit(supabase, {
      entity:        'businesses',
      entityId:      auth.businessId,
      action:        'updated',
      businessId:    auth.businessId,
      actorStaffId:  auth.staffId,
      oldData:       (before as Record<string, unknown> | null) ?? null,
      newData:       data as Record<string, unknown>,
      changedFields: Object.keys(updates),
    });

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
