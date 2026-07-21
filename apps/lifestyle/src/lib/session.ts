// ─── Session — HMAC-signed cookie ─────────────────────────────────────────────
// Sistema de sesión para acceso por token/PIN (demo sin Supabase Auth).
//
// Cookie:  ls_session  (httpOnly, SameSite=Lax, Path=/)
// Formato: base64url(payload_json) + "." + hex(HMAC-SHA256(encoded_payload))
//
// SESSION_SECRET — variable de entorno dedicada, distinta de CRON_SECRET.
//   Mínimo 32 caracteres aleatorios. Rotar en producción requiere re-login.
//
// Compatible con Edge Runtime (Web Crypto API) y Node.js Runtime.

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SessionRole = 'owner' | 'assistant' | 'barber';

/**
 * SessionPayload — unión discriminada por `type`.
 *
 * · 'business' → acceso directo a una sucursal (dueño por email, asistente por PIN).
 *                Backward-compatible: cookies antiguas sin `type` se normalizan a
 *                este variant en verifySession().
 * · 'staff'    → sesión de barbero autenticado por PIN.
 *
 * El variant 'organization' (token compartido de `organizations.access_token`, sin
 * identidad → audit ciego) fue RETIRADO: era la última puerta por token compartido.
 * Ver proxy.ts. La tabla/columnas de la DB se borran en migración aparte (0 filas).
 */
export type SessionPayload =
  | {
      type: 'business';
      business_id: string;
      role: 'owner' | 'assistant';
      staff_id?: undefined;
      exp: number;
    }
  | {
      type: 'staff';
      business_id: string;
      role: 'barber' | 'assistant';
      staff_id: string;
      exp: number;
    };

// ─── Constantes ───────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'ls_session';
export const SESSION_DURATION_SECS = 7 * 24 * 60 * 60;  // 7 días

// ─── Helpers internos ─────────────────────────────────────────────────────────

function getSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }
  return secret;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function encodeB64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeB64url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return atob(pad ? padded + '='.repeat(4 - pad) : padded);
}

function buf2hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hex2buf(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

// ─── Normalización de payload legado ──────────────────────────────────────────

/**
 * Cookies firmadas antes de la migración multi-sucursal no tienen `type`.
 * Las normalizamos al variant 'business' o 'staff' según el rol.
 */
function normalizeLegacyPayload(raw: Record<string, unknown>): SessionPayload | null {
  if (typeof raw['exp'] !== 'number') return null;

  // Ya tiene type — payload nuevo. (El variant 'organization' fue retirado: un token
  // viejo de organización deja de ser una sesión válida → cae al /login normal.)
  const t = raw['type'];
  if (t === 'business' || t === 'staff') {
    return raw as unknown as SessionPayload;
  }

  // Legado: { business_id, role, staff_id?, exp }
  const role = raw['role'];
  const businessId = raw['business_id'];
  if (typeof businessId !== 'string' || typeof role !== 'string') return null;

  if (role === 'barber') {
    const staffId = raw['staff_id'];
    if (typeof staffId !== 'string') return null;
    return { type: 'staff', business_id: businessId, role: 'barber', staff_id: staffId, exp: raw['exp'] };
  }

  if (role === 'owner' || role === 'assistant') {
    return { type: 'business', business_id: businessId, role, exp: raw['exp'] };
  }

  return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Firma un payload de sesión y retorna el valor de la cookie.
 * Seguro para llamar desde API Routes (Node.js Runtime) y middleware (Edge Runtime).
 */
export async function signSession(payload: SessionPayload): Promise<string> {
  const secret = getSecret();
  const key = await getHmacKey(secret);

  const encodedPayload = encodeB64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  );

  return `${encodedPayload}.${buf2hex(sig)}`;
}

/**
 * Verifica la firma del cookie y retorna el payload si es válido y no expiró.
 * Retorna null si la firma es inválida, el token expiró, o cualquier error.
 * Normaliza cookies legadas (sin `type`) al variant correspondiente.
 */
export async function verifySession(cookie: string): Promise<SessionPayload | null> {
  try {
    const dotIndex = cookie.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const encodedPayload = cookie.slice(0, dotIndex);
    const sigHex = cookie.slice(dotIndex + 1);

    const secret = getSecret();
    const key = await getHmacKey(secret);

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      hex2buf(sigHex),
      new TextEncoder().encode(encodedPayload),
    );

    if (!valid) return null;

    const raw = JSON.parse(decodeB64url(encodedPayload)) as Record<string, unknown>;
    const payload = normalizeLegacyPayload(raw);
    if (!payload) return null;

    // Verificar expiración
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Opciones para el cookie de sesión.
 * secure=true en producción — el middleware lo detecta automáticamente.
 */
export function sessionCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_DURATION_SECS,
    secure: isProd,
  };
}

// DistributiveOmit distribuye sobre cada miembro de la unión correctamente.
// Omit<Union, K> no distribuye en TypeScript — fusiona los miembros.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Crea el payload de sesión con expiración a 30 días.
 */
export function makeSessionPayload(
  partial: DistributiveOmit<SessionPayload, 'exp'>,
): SessionPayload {
  return {
    ...partial,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECS,
  } as SessionPayload;
}
