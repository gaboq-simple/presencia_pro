// ─── Intake Token — JWT generation and verification ───────────────────────────
// Uses node:crypto (HMAC-SHA256) for synchronous signing.
// The JWT is self-contained and never stored in Supabase.
// INTAKE_SECRET env var must be ≥ 32 characters.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IntakeToken } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const INTAKE_TTL_MS = 48 * 60 * 60 * 1_000; // 48 hours
const ALG_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'; // {"alg":"HS256","typ":"JWT"} base64url

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function getSecret(): string {
  const secret = process.env['INTAKE_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('INTAKE_SECRET must be set and at least 32 characters');
  }
  return secret;
}

// ─── JWT payload shape (raw, before wrapping in IntakeToken) ──────────────────

type JwtPayload = {
  appointmentId: string;
  patientId: string;
  clientId: string;
  exp: number; // Unix timestamp seconds
};

// ─── generateIntakeUrl ────────────────────────────────────────────────────────

/**
 * Generates a signed intake URL valid for 48 hours.
 * The JWT is self-contained — no DB write required.
 *
 * @returns Full URL: `https://{domain}/intake?token={jwt}`
 */
export function generateIntakeUrl(params: {
  appointmentId: string;
  patientId: string;
  clientId: string;
}): string {
  const secret = getSecret();
  const exp = Math.floor((Date.now() + INTAKE_TTL_MS) / 1_000);

  const payload: JwtPayload = {
    appointmentId: params.appointmentId,
    patientId: params.patientId,
    clientId: params.clientId,
    exp,
  };

  const body = base64urlEncode(JSON.stringify(payload));
  const data = `${ALG_HEADER}.${body}`;
  const sig = sign(data, secret);
  const jwt = `${data}.${sig}`;

  // Base URL: NEXT_PUBLIC_SITE_URL for the current client, fallback to relative path
  const base = process.env['NEXT_PUBLIC_SITE_URL'] ?? '';
  return `${base}/intake?token=${jwt}`;
}

// ─── verifyIntakeToken ────────────────────────────────────────────────────────

/**
 * Verifies the JWT signature and expiration.
 * Returns `null` if the token is invalid or expired — never throws.
 * The `used` field reflects whether an intake already exists for this appointment
 * (that check is done in the repository, not here).
 */
export function verifyIntakeToken(token: string): IntakeToken | null {
  try {
    const secret = getSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts as [string, string, string];
    const data = `${header}.${body}`;
    const expectedSig = sign(data, secret);

    // Guard: constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(base64urlDecode(body)) as JwtPayload;

    // Guard: reject expired tokens
    if (payload.exp * 1_000 < Date.now()) return null;

    // Guard: required fields
    if (!payload.appointmentId || !payload.patientId || !payload.clientId) return null;

    return {
      appointmentId: payload.appointmentId,
      patientId: payload.patientId,
      clientId: payload.clientId,
      expiresAt: new Date(payload.exp * 1_000),
      used: false, // repository sets this after checking the DB
    };
  } catch {
    return null;
  }
}
