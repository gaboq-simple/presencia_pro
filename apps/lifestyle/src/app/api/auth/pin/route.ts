// ─── POST /api/auth/pin ────────────────────────────────────────────────────────
// Valida un PIN de 4 dígitos y crea una sesión para el barbero.
//
// Body:  { pin: string, business_slug: string }   — PIN de 4 dígitos + negocio
//
// Flujo:
//   1. Rate limiting por IP — máx. 5 intentos/60s (distribuido via Upstash Redis).
//   2. Validar formato del PIN (4 dígitos numéricos) + business_slug presente.
//   3. Resolver el negocio desde business_slug (active = true). Desconocido → 401.
//   4. Buscar en staff: business_id = <resuelto>, pin = $1, active = true.
//      El scope por business_id es el fix de MT-02: el PIN es UNIQUE(business_id,
//      pin) — único POR negocio, no global. Sin el scope, dos barberos de
//      negocios distintos con el mismo PIN colisionaban y el login caía en el
//      negocio equivocado. La ruta /[slug]/staff provee el business_slug.
//   5. Crear sesión firmada con HMAC-SHA256.
//   6. Setear cookie httpOnly ls_session en la respuesta.
//   7. Retornar { role, business_id, staff_name } para el redirect del cliente.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  signSession,
  makeSessionPayload,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { tenantDb } from '@/lib/tenantDb';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const PinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'El PIN debe ser de 4 dígitos numéricos'),
  business_slug: z.string().min(1, 'Falta el negocio'),
});

// ─── Service client ───────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── DB row type ──────────────────────────────────────────────────────────────

type StaffPinRow = {
  id: string;
  business_id: string;
  name: string;
  role: string;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 0. Rate limiting por IP — 5 intentos / 60s (distribuido via Upstash Redis)
  const ip = getClientIp(request);
  const rl = await rateLimit(`pin:${ip}`, 5, 60);

  if (!rl.success) {
    const retryAfter = rl.reset > 0 ? rl.reset - Math.floor(Date.now() / 1_000) : 60;
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.max(1, retryAfter)) },
      },
    );
  }

  // 1. Parsear y validar body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = PinSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'PIN inválido' },
      { status: 422 },
    );
  }

  const { pin, business_slug } = parsed.data;

  const admin = getAdminClient();

  // 2. Resolver el negocio desde el slug (scope de MT-02). Desconocido/inactivo
  //    → 401 genérico, nunca un fallback que adivine el negocio.
  const { data: bizRow, error: bizError } = await admin
    .from('businesses')
    .select('id')
    .eq('slug', business_slug)
    .eq('active', true)
    .maybeSingle();

  if (bizError) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }

  const business = bizRow as { id: string } | null;
  if (!business) {
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 });
  }

  // 3. Buscar el staff con ese PIN DENTRO del negocio resuelto (business.id sale del
  //    lookup por slug → server-derivado). El helper inyecta el .eq('business_id'):
  //    el PIN NUNCA se busca global (dos negocios con el mismo PIN no colisionan).
  const { data: rows, error } = await tenantDb(admin, business.id)
    .table('staff')
    .select('id, business_id, name, role')
    .eq('pin', pin)
    .eq('active', true)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }

  const staffRows = (rows ?? []) as StaffPinRow[];
  const staffRecord = staffRows[0];

  if (!staffRecord) {
    // PIN no encontrado — respuesta genérica para no revelar si existe
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 });
  }

  // Barbero y asistente entran por PIN (cada uno con identidad individual — el
  // asistente por PIN reemplaza al assistant_token compartido). Admin usa token.
  if (staffRecord.role !== 'barber' && staffRecord.role !== 'assistant') {
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 });
  }
  const role = staffRecord.role as 'barber' | 'assistant';

  // 3. Crear sesión firmada — staff_id real ⇒ el audit firma con esta identidad.
  const payload = makeSessionPayload({
    type: 'staff',
    business_id: staffRecord.business_id,
    role,
    staff_id: staffRecord.id,
  });

  const cookieValue = await signSession(payload);
  const isProd = process.env['NODE_ENV'] === 'production';

  // 4. Setear cookie y retornar datos para el redirect (el cliente rutea por rol)
  const response = NextResponse.json({
    role,
    staff_name: staffRecord.name,
    business_id: staffRecord.business_id,
  });

  response.cookies.set(SESSION_COOKIE, cookieValue, sessionCookieOptions(isProd));

  return response;
}
