// ─── JWT Utilities — HMAC-SHA256 ──────────────────────────────────────────────
// Única implementación de JWT en el engine. Todos los módulos que necesitan
// firmar o verificar tokens importan desde aquí.
// Usa node:crypto (HMAC-SHA256). El secreto proviene de INTAKE_SECRET.
// INTAKE_SECRET debe tener ≥ 32 caracteres.

import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base64url-encoded {"alg":"HS256","typ":"JWT"} — siempre el mismo */
export const ALG_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function hmacSign(data: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function getJwtSecret(): string {
  const secret = process.env['INTAKE_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('INTAKE_SECRET must be set and at least 32 characters');
  }
  return secret;
}

// ─── signJwt ──────────────────────────────────────────────────────────────────

/**
 * Crea un JWT compacto (HS256) para el payload dado.
 * El campo `exp` debe ser fijado por el caller (Unix timestamp en segundos).
 */
export function signJwt<T extends Record<string, unknown>>(payload: T): string {
  const secret = getJwtSecret();
  const body = base64urlEncode(JSON.stringify(payload));
  const data = `${ALG_HEADER}.${body}`;
  const sig = hmacSign(data, secret);
  return `${data}.${sig}`;
}

// ─── verifyJwt ────────────────────────────────────────────────────────────────

/**
 * Verifica un JWT compacto (HS256).
 * Retorna el payload decodificado o null si inválido/expirado.
 * Nunca lanza — retorna null ante cualquier error.
 */
export function verifyJwt<T extends Record<string, unknown>>(
  token: string,
): (T & { exp?: number }) | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts as [string, string, string];
    const data = `${header}.${body}`;
    const expectedSig = hmacSign(data, secret);

    // Guard: comparación en tiempo constante para prevenir timing attacks
    const sigBuf      = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(base64urlDecode(body)) as T & { exp?: number };

    // Guard: rechazar tokens expirados
    if (payload.exp !== undefined && payload.exp * 1_000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
