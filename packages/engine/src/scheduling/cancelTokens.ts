// ─── Cancel Token — JWT generation and verification ───────────────────────────
// Usa la utilidad compartida de JWT (utils/jwt.ts) — misma implementación,
// mismo secreto (INTAKE_SECRET), mismo algoritmo (HS256).
// El campo type='cancel' distingue estos tokens de los tokens de intake.
// TTL: 24h — coincide con la ventana del recordatorio reminder_24h.

import { signJwt, verifyJwt } from '../utils/jwt';

// ─── Constants ────────────────────────────────────────────────────────────────

const CANCEL_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ─── Payload ──────────────────────────────────────────────────────────────────

type CancelJwtPayload = {
  readonly type: 'cancel';
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
  readonly exp: number; // Unix timestamp seconds
};

// ─── CancelToken ──────────────────────────────────────────────────────────────

export interface CancelToken {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
  readonly expiresAt: Date;
}

// ─── generateCancelToken ──────────────────────────────────────────────────────

/**
 * Genera un JWT de cancelación válido por 24 horas.
 * Retorna solo el token (sin URL) — úsalo cuando necesitas incluir el token
 * en una respuesta de API en lugar de generar un link completo.
 *
 * @returns JWT string
 */
export function generateCancelToken(params: {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
}): string {
  const exp = Math.floor((Date.now() + CANCEL_TTL_MS) / 1_000);

  const payload: CancelJwtPayload = {
    type: 'cancel',
    appointmentId: params.appointmentId,
    patientId: params.patientId,
    clientId: params.clientId,
    exp,
  };

  return signJwt(payload);
}

// ─── generateCancelUrl ────────────────────────────────────────────────────────

/**
 * Genera una URL de cancelación firmada válida por 24 horas.
 * El JWT es auto-contenido — no requiere escritura en DB.
 *
 * @returns URL completa: `{NEXT_PUBLIC_SITE_URL}/cancel?token={jwt}`
 */
export function generateCancelUrl(params: {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
}): string {
  const jwt = generateCancelToken(params);
  const base = process.env['NEXT_PUBLIC_SITE_URL'] ?? '';
  return `${base}/cancel?token=${jwt}`;
}

// ─── verifyCancelToken ────────────────────────────────────────────────────────

/**
 * Verifica la firma JWT y la expiración de un token de cancelación.
 * Retorna `null` si el token es inválido o expirado — nunca lanza.
 */
export function verifyCancelToken(token: string): CancelToken | null {
  const payload = verifyJwt<CancelJwtPayload>(token);
  if (!payload) return null;

  // Guard: discriminador de tipo
  if (payload.type !== 'cancel') return null;

  // Guard: campos requeridos
  if (!payload.appointmentId || !payload.patientId || !payload.clientId) return null;

  return {
    appointmentId: payload.appointmentId,
    patientId: payload.patientId,
    clientId: payload.clientId,
    expiresAt: new Date((payload.exp ?? 0) * 1_000),
  };
}
