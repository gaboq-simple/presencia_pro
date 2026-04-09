/**
 * scripts/google-oauth.ts
 * PresenciaPro — Flujo OAuth para conectar Google Calendar de un especialista.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=dra-quevedo
 *
 * Flujo:
 *  1. Lee GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET del .env.local del cliente
 *  2. Genera la URL de autorización OAuth con scopes de Calendar
 *  3. Imprime la URL con instrucciones claras para el operador
 *  4. Inicia servidor HTTP local en localhost:3333/oauth/callback
 *  5. Espera el callback de Google con el código de autorización
 *  6. Intercambia el código por access_token + refresh_token
 *  7. Imprime el refresh_token con instrucciones para guardarlo en .env.local
 *  8. Cierra el servidor
 *
 * Seguridad:
 *  - El refresh_token NUNCA se escribe automáticamente en ningún archivo.
 *    El operador lo copia manualmente. Esto es intencional.
 *  - El servidor HTTP escucha solo en 127.0.0.1 (localhost), nunca en 0.0.0.0.
 *  - El servidor cierra inmediatamente después de recibir el callback.
 *
 * Prerequisito en Google Cloud Console:
 *  - URI de redirección autorizada: http://localhost:3333/oauth/callback
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL, URLSearchParams } from 'url';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EnvVars {
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface HttpsPostResult {
  readonly status: number;
  readonly body: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CALLBACK_PORT = 3333;
const CALLBACK_PATH = '/oauth/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const AUTH_URL_BASE = 'https://accounts.google.com/o/oauth2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

// ─── Argument parsing ──────────────────────────────────────────────────────────

function getClientSlug(): string {
  const args = process.argv.slice(2);
  const clientArg = args.find((a) => a.startsWith('--client='));
  if (!clientArg) {
    console.error(
      'Uso: npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=<slug>',
    );
    process.exit(1);
  }
  return clientArg.slice('--client='.length);
}

// ─── .env.local parser ────────────────────────────────────────────────────────

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    console.error(`\nNo se encontró el archivo: ${filePath}`);
    console.error('Asegúrate de que el cliente existe y tiene un .env.local configurado.');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }

  return result;
}

function readEnvVars(clientSlug: string): EnvVars {
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, 'clients', clientSlug, '.env.local');
  const env = parseEnvFile(envPath);

  const clientId = env['GOOGLE_CLIENT_ID'];
  const clientSecret = env['GOOGLE_CLIENT_SECRET'];

  if (!clientId) {
    console.error(
      `\nError: GOOGLE_CLIENT_ID no está configurado en clients/${clientSlug}/.env.local`,
    );
    console.error('Agrega tu Client ID de Google Cloud Console y vuelve a intentarlo.');
    process.exit(1);
  }
  if (!clientSecret) {
    console.error(
      `\nError: GOOGLE_CLIENT_SECRET no está configurado en clients/${clientSlug}/.env.local`,
    );
    console.error('Agrega tu Client Secret de Google Cloud Console y vuelve a intentarlo.');
    process.exit(1);
  }

  return { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret };
}

// ─── OAuth URL builder ────────────────────────────────────────────────────────

function buildAuthUrl(googleClientId: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',  // necesario para recibir refresh_token
    prompt: 'consent',       // fuerza la pantalla de consentimiento — sin esto
    //                          Google omite el refresh_token si ya fue autorizado antes
  });
  return `${AUTH_URL_BASE}?${params.toString()}`;
}

// ─── HTTPS POST helper ────────────────────────────────────────────────────────

function httpsPost(url: string, formBody: string): Promise<HttpsPostResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuffer = Buffer.from(formBody, 'utf-8');

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': bodyBuffer.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        );
      },
    );

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCodeForRefreshToken(
  code: string,
  googleClientId: string,
  googleClientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const result = await httpsPost(TOKEN_URL, body.toString());

  if (result.status !== 200) {
    console.error(`\n❌ Error al intercambiar el código con Google (HTTP ${result.status}):`);
    console.error(result.body);
    process.exit(1);
  }

  const data = JSON.parse(result.body) as TokenResponse;

  if (data.error) {
    console.error(`\n❌ Error de Google: ${data.error}`);
    if (data.error_description) console.error(`   ${data.error_description}`);
    process.exit(1);
  }

  if (!data.refresh_token) {
    console.error('\n❌ Google no devolvió un refresh_token.');
    console.error(
      '   Esto ocurre cuando la aplicación ya fue autorizada anteriormente.',
    );
    console.error(
      '   Solución: revoca el acceso en https://myaccount.google.com/permissions',
    );
    console.error('   y vuelve a correr este script.');
    process.exit(1);
  }

  return data.refresh_token;
}

// ─── Local callback server ────────────────────────────────────────────────────

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = req.url ?? '';

      // Guard: ignorar requests que no sean el callback (ej. favicon)
      if (!reqUrl.startsWith(CALLBACK_PATH)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const queryStr = reqUrl.includes('?') ? reqUrl.slice(reqUrl.indexOf('?') + 1) : '';
      const params = new URLSearchParams(queryStr);
      const error = params.get('error');
      const code = params.get('code');

      const htmlOk = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>PresenciaPro — Autorización</title></head>
<body style="font-family:sans-serif;padding:2rem;max-width:500px;margin:auto">
  <h2 style="color:#16a34a">✅ ¡Autorización exitosa!</h2>
  <p>Google Calendar ha sido conectado correctamente.</p>
  <p>Puedes cerrar esta ventana y regresar a la terminal.</p>
</body></html>`;

      const htmlCancelled = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>PresenciaPro — Cancelado</title></head>
<body style="font-family:sans-serif;padding:2rem;max-width:500px;margin:auto">
  <h2 style="color:#dc2626">❌ Autorización cancelada</h2>
  <p>La doctora canceló el proceso de autorización.</p>
  <p>Puedes cerrar esta ventana. Vuelve a correr el script para intentarlo de nuevo.</p>
</body></html>`;

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlCancelled);
        server.close(() =>
          reject(new Error(`Autorización cancelada por el usuario (${error})`)),
        );
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body>Parámetro code no encontrado en el callback.</body></html>');
        server.close(() =>
          reject(new Error('Callback recibido sin código de autorización.')),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlOk);

      // Cerrar el servidor antes de resolver — ya no necesitamos escuchar más
      server.close(() => resolve(code));
    });

    // Escuchar solo en loopback — nunca en 0.0.0.0
    server.listen(CALLBACK_PORT, '127.0.0.1');
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `El puerto ${CALLBACK_PORT} ya está en uso. ` +
              'Cierra el proceso que lo ocupa y vuelve a intentarlo.',
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const clientSlug = getClientSlug();
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = readEnvVars(clientSlug);
  const authUrl = buildAuthUrl(GOOGLE_CLIENT_ID);

  const divider = '━'.repeat(74);
  console.log(`\n${divider}`);
  console.log('PresenciaPro — Conexión Google Calendar');
  console.log(`Cliente: ${clientSlug}`);
  console.log(`${divider}\n`);
  console.log('Abre este link en el navegador de la doctora:\n');
  console.log(`  ${authUrl}\n`);
  console.log('La doctora debe iniciar sesión con la cuenta de Google');
  console.log('que usa para su calendario de citas.');
  console.log('Autoriza el acceso cuando Google lo solicite.');
  console.log('\nRegresa aquí — el proceso continuará automáticamente.\n');
  console.log('Esperando autorización...\n');

  let code: string;
  try {
    code = await waitForCallback();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ ${message}`);
    process.exit(1);
  }

  const refreshToken = await exchangeCodeForRefreshToken(
    code,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
  );

  console.log('✅ ¡Autorización exitosa!\n');
  console.log(`Agrega esta línea a clients/${clientSlug}/.env.local:\n`);
  console.log(`  GOOGLE_REFRESH_TOKEN=${refreshToken}\n`);
  console.log('⚠️  Guarda este token de forma segura. No lo compartas.');
  console.log('    Si lo pierdes, deberás repetir este proceso.\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
