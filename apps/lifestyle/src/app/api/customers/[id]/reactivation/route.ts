// ─── POST /api/customers/[id]/reactivation ────────────────────────────────────
// Envía un mensaje de reactivación por WhatsApp al cliente y registra
// el envío en scheduled_notifications para tener historial.
//
// Auth: requiere sesión de owner o admin del negocio (token o Supabase Auth).
// Verifica que customer.business_id === session.business_id.
//
// Body: { message: string }  — máximo 300 caracteres (Zod).
//
// Comportamiento:
//   - Llama sendWhatsAppMeta() best-effort (try/catch)
//   - Registra en scheduled_notifications con type='reactivation' y sent_at=NOW()
//   - Fallo en WhatsApp no interrumpe — retorna { sent: false } con 200
//   - Retorna { sent: boolean }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  message: z
    .string()
    .min(1, 'message cannot be empty')
    .max(300, 'message cannot exceed 300 characters'),
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
  business_id: string;
};

type RawBusinessRow = {
  whatsapp_phone_number_id: string;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 1. Auth: owner o admin del negocio (token o Supabase Auth)
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const businessId = auth.businessId;
  const supabase = getServiceClient();

  // 3. Validar body con Zod
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { message } = parsed.data;

  // 4. Resolver customer_id desde params
  const { id: customerId } = await params;

  // 5. Obtener cliente — verificar que pertenece al mismo negocio
  const { data: custData, error: custError } = await supabase
    .from('customers')
    .select('id, name, phone, business_id')
    .eq('id', customerId)
    .maybeSingle();

  if (custError || !custData) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  const customer = custData as RawCustomerRow;

  if (customer.business_id !== businessId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 6. Obtener whatsapp_phone_number_id del negocio
  const { data: bizData, error: bizError } = await supabase
    .from('businesses')
    .select('whatsapp_phone_number_id')
    .eq('id', businessId)
    .maybeSingle();

  if (bizError || !bizData) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const business = bizData as RawBusinessRow;

  // 7. Enviar WhatsApp — best-effort
  let sent = false;
  try {
    const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
    if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not set');

    const result = await sendWhatsAppMeta(
      { to: customer.phone, body: message },
      { accessToken, phoneNumberId: business.whatsapp_phone_number_id },
    );
    sent = result.success;
  } catch {
    // best-effort — no interrumpir
  }

  // 8. Registrar en scheduled_notifications — best-effort
  try {
    const now = new Date().toISOString();
    await supabase.from('scheduled_notifications').insert({
      business_id:    businessId,
      appointment_id: null,
      type:           'reactivation',
      scheduled_for:  now,
      sent_at:        now,
    });
  } catch {
    // best-effort — historial no crítico
  }

  return NextResponse.json({ sent });
}
