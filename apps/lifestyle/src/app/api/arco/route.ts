// ─── POST /api/arco — Solicitudes ARCO (LFPDPPP Art. 22-25) ──────────────────
// Recibe el formulario público, lo valida, guarda en arco_requests.
// Sin autenticación requerida — cualquier titular puede presentar su solicitud.
// Rate limit: 3 solicitudes / hora por teléfono.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';

// ─── Validación ───────────────────────────────────────────────────────────────

const ArcoSchema = z.object({
  customer_name:  z.string().min(2, 'Nombre demasiado corto').max(120),
  customer_phone: z.string().min(7, 'Teléfono inválido').max(20).regex(/^\+?[\d\s\-()]+$/, 'Teléfono inválido'),
  customer_email: z.string().email('Correo inválido').max(120).nullable().optional(),
  request_type:   z.enum(['acceso', 'rectificacion', 'cancelacion', 'oposicion']),
  description:    z.string().min(10, 'Descripción demasiado corta').max(2000),
});

// ─── Supabase service client ──────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Parse body ──────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  // ── Validar con Zod ─────────────────────────────────────────────────────────
  const parsed = ArcoSchema.safeParse(rawBody);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Datos inválidos';
    return NextResponse.json({ error: firstError }, { status: 422 });
  }

  const { customer_name, customer_phone, customer_email, request_type, description } = parsed.data;

  // ── Rate limit: 3 / hora por teléfono ──────────────────────────────────────
  const rl = await rateLimit(`arco:${customer_phone}`, 3, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta de nuevo en una hora.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.reset - Math.floor(Date.now() / 1000)) },
      },
    );
  }

  // ── Lookup business_id por teléfono en customers ────────────────────────────
  const supabase = getServiceClient();
  let businessId: string | null = null;

  const { data: customerRow } = await supabase
    .from('customers')
    .select('business_id')
    .eq('phone', customer_phone)
    .limit(1)
    .maybeSingle();

  if (customerRow) {
    businessId = (customerRow as { business_id: string }).business_id;
  }

  // ── INSERT en arco_requests ─────────────────────────────────────────────────
  const { error } = await supabase.from('arco_requests').insert({
    customer_phone,
    customer_name,
    customer_email: customer_email ?? null,
    request_type,
    description,
    business_id: businessId,
  });

  if (error) {
    console.error(JSON.stringify({
      ts:    new Date().toISOString(),
      event: 'arco_insert_failed',
      error: error.message,
    }));
    return NextResponse.json(
      { error: 'No se pudo registrar la solicitud. Intenta de nuevo o escríbenos a contacto@zentriq.mx.' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { message: 'Solicitud recibida. Te contactaremos en un máximo de 20 días hábiles.' },
    { status: 201 },
  );
}
