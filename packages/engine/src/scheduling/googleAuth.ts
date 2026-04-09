// ─── Google OAuth — utilidad compartida para access_tokens ─────────────────────
//
// ⚠️  NOTA ARQUITECTÓNICA — leer antes de modificar:
//
// Este módulo existe para que módulos del motor fuera de scheduling/
// (bot/, notifications/, etc.) puedan obtener access_tokens de Google
// sin tomar una dependencia directa sobre el módulo scheduling/.
//
// El módulo scheduling/ tiene su propia función getAccessToken() en calendar.ts
// (línea 61) que hace exactamente lo mismo y es la que usan internamente
// slots.ts, appointments.ts y emergency.ts. Ambas funciones son independientes
// y no se llaman entre sí — esto es intencional:
//
//   calendar.ts : getAccessToken(credentials: GoogleCredentials)
//     → uso interno de scheduling/, recibe GoogleCredentials directamente
//
//   googleAuth.ts : getGoogleAccessToken(params: GetGoogleAccessTokenParams)
//     → utilidad exportada para otros módulos, con parámetros explícitamente
//       nombrados para distinguir el clientId de negocio del googleClientId OAuth
//
// Si en el futuro se decide centralizar, el camino correcto es:
//   calendar.ts importa getGoogleAccessToken() desde googleAuth.ts
//   (nunca al revés — googleAuth.ts no debe depender de scheduling/)
//
// ─── Implementación ────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GetGoogleAccessTokenParams {
  /**
   * ID de negocio del cliente — solo para mensajes de error legibles.
   * Ejemplo: "dra-quevedo". NO es el Google Client ID OAuth.
   */
  readonly clientId: string;
  /** GOOGLE_CLIENT_SECRET del cliente — leído de .env.local por el caller */
  readonly clientSecret: string;
  /** GOOGLE_REFRESH_TOKEN obtenido con scripts/google-oauth.ts */
  readonly refreshToken: string;
  /** GOOGLE_CLIENT_ID — ID de la aplicación OAuth en Google Cloud Console */
  readonly googleClientId: string;
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Obtiene un access_token fresco intercambiando el refresh_token con Google.
 *
 * Sin caché — Google acepta tokens frescos en cada llamada y el motor es
 * stateless (mismo comportamiento que getAccessToken en calendar.ts).
 *
 * Si el token fue revocado (invalid_grant), lanza con instrucciones claras
 * en español para que el operador sepa exactamente qué script correr.
 *
 * @param params - Credenciales OAuth del cliente. El caller lee las env vars
 *   y las pasa aquí — el motor nunca accede a process.env directamente.
 * @returns El access_token listo para usar en headers de Google APIs.
 * @throws Error con mensaje en español si las credenciales son inválidas.
 */
export async function getGoogleAccessToken(
  params: GetGoogleAccessTokenParams,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: params.googleClientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();

    // Token revocado — el especialista retiró el acceso desde su cuenta de Google
    if (response.status === 400 && text.includes('invalid_grant')) {
      throw new Error(
        `[${params.clientId}] El GOOGLE_REFRESH_TOKEN fue revocado o expiró. ` +
          'El especialista debe volver a autorizar el acceso ejecutando: ' +
          `npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${params.clientId}`,
      );
    }

    throw new Error(
      `[${params.clientId}] Error al obtener access_token de Google (${response.status}): ${text}. ` +
        'Verifica GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN en .env.local.',
    );
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}
