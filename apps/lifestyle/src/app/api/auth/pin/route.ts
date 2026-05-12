// ─── POST /api/auth/pin ────────────────────────────────────────────────────────
// Valida un PIN de 4 dígitos y crea una sesión para el barbero.
//
// Body:  { pin: string }            — PIN de 4 dígitos
//
// Flujo:
//   1. Validar formato del PIN (4 dígitos numéricos).
//   2. Buscar en staff: pin = $1, active = true.
//      Si hay múltiples coincidencias entre negocios (demo), tomar la primera.
//   3. Crear sesión firmada con HMAC-SHA256.
//   4. Setear cookie httpOnly ls_session en la respuesta.
//   5. Retornar { role, business_id, staff_name } para el redirect del cliente.
//
// Security note: el PIN no es un mecanismo de seguridad de producción.
// Es adecuado para el flujo de demo con un negocio. Para multi-tenant real
// se requeriría identificador de negocio adicional.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  signSession,
  makeSessionPayload,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/session';

// ─── Schema ───────────────────────────────────────────────────────────────────

const PinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'El PIN debe ser de 4 dígitos numéricos'),
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

  const { pin } = parsed.data;

  // 2. Buscar el staff con ese PIN
  const admin = getAdminClient();
  const { data: rows, error } = await admin
    .from('staff')
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

  // Solo barberos pueden entrar por PIN — admin y assistant usan token
  if (staffRecord.role !== 'barber') {
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 });
  }

  // 3. Crear sesión firmada
  const payload = makeSessionPayload({
    type: 'staff',
    business_id: staffRecord.business_id,
    role: 'barber',
    staff_id: staffRecord.id,
  });

  const cookieValue = await signSession(payload);
  const isProd = process.env['NODE_ENV'] === 'production';

  // 4. Setear cookie y retornar datos para el redirect
  const response = NextResponse.json({
    role: 'barber',
    staff_name: staffRecord.name,
    business_id: staffRecord.business_id,
  });

  response.cookies.set(SESSION_COOKIE, cookieValue, sessionCookieOptions(isProd));

  return response;
}
