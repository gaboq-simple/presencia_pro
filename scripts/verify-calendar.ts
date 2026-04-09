/**
 * scripts/verify-calendar.ts
 * PresenciaPro — Verificación post-configuración de Google Calendar.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json scripts/verify-calendar.ts --client=dra-quevedo
 *
 * Qué verifica:
 *  1. Lee GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN del .env.local
 *  2. Obtiene un access_token fresco intercambiando el refresh_token
 *  3. Llama a GET /calendar/v3/calendars/primary para confirmar acceso real
 *  4. Imprime el email del calendario si la conexión es válida
 *
 * Ejecutar después de configurar GOOGLE_REFRESH_TOKEN con scripts/google-oauth.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { URL, URLSearchParams } from 'url';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EnvVars {
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_REFRESH_TOKEN: string;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface CalendarResponse {
  readonly id?: string;
  readonly summary?: string;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly status: string;
  };
}

interface HttpsResult {
  readonly status: number;
  readonly body: string;
}

// ─── Argument parsing ──────────────────────────────────────────────────────────

function getClientSlug(): string {
  const args = process.argv.slice(2);
  const clientArg = args.find((a) => a.startsWith('--client='));
  if (!clientArg) {
    console.error(
      'Uso: npx ts-node --project tsconfig.scripts.json scripts/verify-calendar.ts --client=<slug>',
    );
    process.exit(1);
  }
  return clientArg.slice('--client='.length);
}

// ─── .env.local parser ────────────────────────────────────────────────────────

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    console.error(`\nNo se encontró el archivo: ${filePath}`);
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
  const refreshToken = env['GOOGLE_REFRESH_TOKEN'];

  if (!clientId) {
    console.error(
      `\nError: GOOGLE_CLIENT_ID no configurado en clients/${clientSlug}/.env.local`,
    );
    process.exit(1);
  }
  if (!clientSecret) {
    console.error(
      `\nError: GOOGLE_CLIENT_SECRET no configurado en clients/${clientSlug}/.env.local`,
    );
    process.exit(1);
  }
  if (!refreshToken) {
    console.error(
      `\nError: GOOGLE_REFRESH_TOKEN no configurado en clients/${clientSlug}/.env.local`,
    );
    console.error('\nPrimero conecta el calendario ejecutando:');
    console.error(
      `  npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${clientSlug}\n`,
    );
    process.exit(1);
  }

  return {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REFRESH_TOKEN: refreshToken,
  };
}

// ─── HTTPS helpers ────────────────────────────────────────────────────────────

function httpsPost(url: string, formBody: string): Promise<HttpsResult> {
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

function httpsGet(url: string, bearerToken: string): Promise<HttpsResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
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
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const clientSlug = getClientSlug();
  const vars = readEnvVars(clientSlug);

  console.log(`\nVerificando Google Calendar para: ${clientSlug}...\n`);

  // ── Paso 1: obtener access_token desde el refresh_token ────────────────────
  const tokenBody = new URLSearchParams({
    client_id: vars.GOOGLE_CLIENT_ID,
    client_secret: vars.GOOGLE_CLIENT_SECRET,
    refresh_token: vars.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const tokenResult = await httpsPost(
    'https://oauth2.googleapis.com/token',
    tokenBody.toString(),
  );

  if (tokenResult.status !== 200) {
    console.error(`❌ Error al obtener access_token (HTTP ${tokenResult.status}):`);
    console.error(tokenResult.body);
    console.error('\nSolución: vuelve a conectar el calendario con:');
    console.error(
      `  npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${clientSlug}\n`,
    );
    process.exit(1);
  }

  const tokenData = JSON.parse(tokenResult.body) as TokenResponse;

  if (tokenData.error || !tokenData.access_token) {
    console.error('❌ El refresh_token es inválido o fue revocado por el especialista.');
    if (tokenData.error_description) console.error(`   ${tokenData.error_description}`);
    console.error('\nSolución: vuelve a conectar el calendario con:');
    console.error(
      `  npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${clientSlug}\n`,
    );
    process.exit(1);
  }

  // ── Paso 2: llamar a Calendar API ─────────────────────────────────────────
  const calendarResult = await httpsGet(
    'https://www.googleapis.com/calendar/v3/calendars/primary',
    tokenData.access_token,
  );

  if (calendarResult.status !== 200) {
    console.error(`❌ Error al llamar a Google Calendar API (HTTP ${calendarResult.status}):`);
    console.error(calendarResult.body);
    console.error('\nSolución: vuelve a conectar el calendario con:');
    console.error(
      `  npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${clientSlug}\n`,
    );
    process.exit(1);
  }

  const calendarData = JSON.parse(calendarResult.body) as CalendarResponse;

  if (calendarData.error) {
    console.error(`❌ Error de Google Calendar: ${calendarData.error.message}`);
    console.error('\nSolución: vuelve a conectar el calendario con:');
    console.error(
      `  npx ts-node --project tsconfig.scripts.json scripts/google-oauth.ts --client=${clientSlug}\n`,
    );
    process.exit(1);
  }

  // Preferir .id (el email de la cuenta) sobre .summary (el nombre del calendario)
  const calendarEmail = calendarData.id ?? calendarData.summary ?? '(sin email)';
  console.log(`✅ Google Calendar conectado correctamente para ${calendarEmail}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
