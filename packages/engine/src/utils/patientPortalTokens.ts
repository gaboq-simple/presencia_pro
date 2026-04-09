// ─── Patient Portal Token — JWT generation and verification ───────────────────
// Usa la utilidad compartida de JWT (utils/jwt.ts) — mismo secreto (INTAKE_SECRET),
// mismo algoritmo (HS256).
// El campo type='patient-portal' distingue estos tokens de intake y cancel.
// TTL: 7 días — el paciente puede revisitar su portal durante una semana.

import { signJwt, verifyJwt } from './jwt';

// ─── Constants ────────────────────────────────────────────────────────────────

const PATIENT_PORTAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ─── PatientPortalToken ───────────────────────────────────────────────────────

/**
 * Decoded payload of a signed patient portal JWT.
 * The JWT is self-contained — never stored in Supabase.
 * Identifies the patient for read-only portal access.
 */
export type PatientPortalToken = {
  readonly type: 'patient-portal';
  readonly patientId: string;
  readonly clientId: string;
  readonly iat: number; // Unix timestamp seconds — issued at
  readonly exp: number; // Unix timestamp seconds — expiration
};

// ─── JWT payload shape ────────────────────────────────────────────────────────

type PatientPortalJwtPayload = PatientPortalToken;

// ─── generatePatientPortalToken ───────────────────────────────────────────────

/**
 * Genera un JWT de portal del paciente firmado, válido por 7 días.
 * El JWT es auto-contenido — no requiere escritura en DB.
 *
 * @returns JWT string (sin URL — el caller construye el link completo)
 */
export function generatePatientPortalToken(patientId: string, clientId: string): string {
  const nowSec = Math.floor(Date.now() / 1_000);
  const exp = nowSec + Math.floor(PATIENT_PORTAL_TTL_MS / 1_000);

  const payload: PatientPortalJwtPayload = {
    type: 'patient-portal',
    patientId,
    clientId,
    iat: nowSec,
    exp,
  };

  return signJwt(payload);
}

// ─── verifyPatientPortalToken ─────────────────────────────────────────────────

/**
 * Verifica la firma JWT y la expiración de un token de portal del paciente.
 * Retorna `null` si el token es inválido o expirado — nunca lanza.
 */
export function verifyPatientPortalToken(token: string): PatientPortalToken | null {
  const payload = verifyJwt<PatientPortalJwtPayload>(token);
  if (!payload) return null;

  // Guard: discriminador de tipo
  if (payload.type !== 'patient-portal') return null;

  // Guard: campos requeridos
  if (!payload.patientId || !payload.clientId) return null;

  return {
    type: 'patient-portal',
    patientId: payload.patientId,
    clientId: payload.clientId,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}
