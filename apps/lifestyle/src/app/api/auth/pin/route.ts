// ─── POST /api/auth/pin ────────────────────────────────────────────────────────
// Valida un PIN de 4 dígitos y crea una sesión para el barbero.
//
// Body:  { pin: string }            — PIN de 4 dígitos
//
// Flujo:
//   1. Rate limiting por IP — máx. 5 intentos/min, bloqueo de 15 min tras 5 fallos.
//   2. Validar formato del PIN (4 dígitos numéricos).
//   3. Buscar en staff: pin = $1, active = true.
//      Si hay múltiples coincidencias entre negocios (demo), tomar la primera.
//   4. Crear sesión firmada con HMAC-SHA256.
//   5. Setear cookie httpOnly ls_session en la respuesta.
//   6. Retornar { role, business_id, staff_name } para el redirect del cliente.
//
// Security note: el PIN no es un mecanismo de seguridad de producción.
// Es adecuado para el flujo de demo con un negocio. Para multi-tenant real
// se requeriría identificador de negocio adicional.
//
// TODO (A-1 / rate limiting distribuido): el rate limiter en memoria es
// instancia-local en Vercel Fluid Compute. Para producción con alta escala
// migrar a Upstash Redis o Vercel Edge Config para compartir estado entre
// instancias. En Fase 1 (un cliente, instancias pocas) es aceptable.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  signSession,
  makeSessionPayload,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/lib/session';

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Ventana deslizante por IP: máx. MAX_ATTEMPTS por WINDOW_MS.
// Tras MAX_ATTEMPTS fallos acumulados en la ventana, bloquear BLOCK_MS.
//
// La Map es instancia-local. Ver TODO arriba sobre limitaciones en serverless.

const WINDOW_MS       = 60 * 1_000;       // 1 minuto
const MAX_ATTEMPTS    = 5;                 // máx. intentos en la ventana
const BLOCK_MS        = 15 * 60 * 1_000;  // 15 minutos de bloqueo

type RateLimitEntry = {
  count:         number;
  resetAt:       number;   // timestamp en ms — fin de la ventana actual
  blockedUntil?: number;   // timestamp en ms — fin del bloqueo activo
};

const rateLimitMap = new Map<string, RateLimitEntry>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Evalúa si la IP puede hacer otro intento.
 * Retorna { allowed: true } o { allowed: false, retryAfter: segundos }.
 * Incrementa el contador en cada llamada (tanto en éxito como en fallo).
 */
function checkRateLimit(ip: string): { allowed: true } | { allowed: false; retryAfter: number } {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip);

  // ── Bloqueo activo ──────────────────────────────────────────────────────────
  if (entry?.blockedUntil && now < entry.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1_000) };
  }

  // ── Sin entrada o ventana expirada — nueva ventana ─────────────────────────
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  // ── Dentro de la ventana ───────────────────────────────────────────────────
  entry.count += 1;

  if (entry.count > MAX_ATTEMPTS) {
    // Activar bloqueo prolongado
    entry.blockedUntil = now + BLOCK_MS;
    return { allowed: false, retryAfter: Math.ceil(BLOCK_MS / 1_000) };
  }

  return { allowed: true };
}

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
  // 0. Rate limiting por IP
  const ip = getClientIp(request);
  const rl = checkRateLimit(ip);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo más tarde.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
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
