// ─── Intake Token — JWT generation and verification ───────────────────────────
// Usa la utilidad compartida de JWT (utils/jwt.ts).
// El JWT es auto-contenido y nunca se persiste en Supabase.
// INTAKE_SECRET env var debe tener ≥ 32 caracteres.

import { signJwt, verifyJwt } from '../utils/jwt';
import type { IntakeToken } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const INTAKE_TTL_MS = 48 * 60 * 60 * 1_000; // 48 hours

// ─── JWT payload shape ────────────────────────────────────────────────────────

type IntakeJwtPayload = {
  readonly type: 'intake';
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
  readonly exp: number; // Unix timestamp seconds
};

// ─── generateIntakeUrl ────────────────────────────────────────────────────────

/**
 * Genera una URL de intake firmada válida por 48 horas.
 * El JWT es auto-contenido — no requiere escritura en DB.
 *
 * @returns URL completa: `https://{domain}/intake?token={jwt}`
 */
export function generateIntakeUrl(params: {
  appointmentId: string;
  patientId: string;
  clientId: string;
}): string {
  const exp = Math.floor((Date.now() + INTAKE_TTL_MS) / 1_000);

  const payload: IntakeJwtPayload = {
    type: 'intake',
    appointmentId: params.appointmentId,
    patientId: params.patientId,
    clientId: params.clientId,
    exp,
  };

  const jwt = signJwt(payload);
  const base = process.env['NEXT_PUBLIC_SITE_URL'] ?? '';
  return `${base}/intake?token=${jwt}`;
}

// ─── verifyIntakeToken ────────────────────────────────────────────────────────

/**
 * Verifica la firma JWT y la expiración del token de intake.
 * Retorna `null` si el token es inválido o expirado — nunca lanza.
 * El campo `used` refleja si ya existe un intake para esta cita
 * (esa verificación la hace el repositorio, no esta función).
 */
export function verifyIntakeToken(token: string): IntakeToken | null {
  const payload = verifyJwt<IntakeJwtPayload>(token);
  if (!payload) return null;

  // Guard: discriminador de tipo
  if (payload.type !== 'intake') return null;

  // Guard: campos requeridos
  if (!payload.appointmentId || !payload.patientId || !payload.clientId) return null;

  return {
    appointmentId: payload.appointmentId,
    patientId: payload.patientId,
    clientId: payload.clientId,
    expiresAt: new Date((payload.exp ?? 0) * 1_000),
    used: false, // el repositorio lo fija tras verificar en DB
  };
}
