/**
 * scripts/create-doctor-user.ts
 * Crea el usuario doctor en Supabase Auth con client_id en user_metadata.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json scripts/create-doctor-user.ts \
 *     --client=dra-quevedo \
 *     --email=doctor@email.com
 *
 * Variables de entorno requeridas (leídas de clients/<id>/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL        — URL del proyecto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY       — service_role key (nunca se expone al frontend)
 *
 * Salidas:
 *   ✅ Usuario creado — imprime email y contraseña generada
 *   ❌ Error — describe la causa y sale con código 1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Mínimo del client.config.ts necesario para este script. */
interface MinimalClientConfig {
  client: {
    id: string;
    name: string;
  };
}

// ─── Argumentos ───────────────────────────────────────────────────────────────

function parseArgs(): { clientId: string; email: string } {
  const get = (flag: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${flag}=`))?.split('=').slice(1).join('=');

  const clientId = get('client');
  const email    = get('email');

  if (!clientId || !email) {
    console.error(
      '\nUso: npx ts-node --project tsconfig.scripts.json scripts/create-doctor-user.ts' +
      ' --client=<id> --email=<email>\n',
    );
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(clientId)) {
    console.error('❌ --client debe ser kebab-case: solo letras minúsculas, números y guiones.');
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`❌ --email "${email}" no tiene formato válido.`);
    process.exit(1);
  }

  return { clientId, email };
}

// ─── Cargar client.config ──────────────────────────────────────────────────────
// Mismo patrón que validate-config.ts: require() resuelve .ts vía ts-node.

function loadClientConfig(clientId: string): MinimalClientConfig {
  const ROOT       = path.resolve(__dirname, '..');
  const configPath = path.join(ROOT, 'clients', clientId, 'src', 'config', 'client.config');

  let rawConfig: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(configPath) as { clientConfig?: unknown };
    if (mod.clientConfig === undefined) {
      throw new Error('El archivo no exporta "clientConfig".');
    }
    rawConfig = mod.clientConfig;
  } catch (err) {
    console.error(`\n❌ No se pudo cargar clients/${clientId}/src/config/client.config.ts`);
    console.error(`   ${(err as Error).message}\n`);
    process.exit(1);
  }

  assertMinimalClientConfig(rawConfig, clientId);
  return rawConfig;
}

function assertMinimalClientConfig(
  raw: unknown,
  clientId: string,
): asserts raw is MinimalClientConfig {
  const obj = raw as Record<string, unknown>;
  const clientField = obj['client'] as Record<string, unknown> | undefined;

  if (
    typeof clientField !== 'object' ||
    clientField === null ||
    typeof clientField['id'] !== 'string' ||
    clientField['id'].trim() === '' ||
    typeof clientField['name'] !== 'string'
  ) {
    console.error(
      `❌ client.config.ts de "${clientId}" no tiene client.id válido.`,
    );
    process.exit(1);
  }
}

// ─── Leer variables de entorno ─────────────────────────────────────────────────
// Se leen desde clients/<clientId>/.env.local.
// dotenv no está en las devDependencies raíz — se parsea manualmente.

function loadClientEnv(clientId: string): Record<string, string> {
  const ROOT     = path.resolve(__dirname, '..');
  const envPath  = path.join(ROOT, 'clients', clientId, '.env.local');

  if (!fs.existsSync(envPath)) {
    console.error(`❌ No se encontró clients/${clientId}/.env.local`);
    console.error(
      '   Agrega NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY a ese archivo.\n',
    );
    process.exit(1);
  }

  const env: Record<string, string> = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key   = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');

    if (key) env[key] = value;
  }

  return env;
}

function requireEnvVar(env: Record<string, string>, key: string, clientId: string): string {
  const value = env[key] ?? process.env[key] ?? '';
  if (!value) {
    console.error(`❌ Variable de entorno "${key}" no encontrada en clients/${clientId}/.env.local`);
    process.exit(1);
  }
  return value;
}

// ─── Generar contraseña temporal ──────────────────────────────────────────────
// 24 bytes de entropía → 48 caracteres hex.
// Suficientemente segura para entrega inicial. El doctor debe cambiarla al entrar.

function generateTemporaryPassword(): string {
  return crypto.randomBytes(24).toString('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { clientId, email } = parseArgs();

  console.log(`\nCreando usuario doctor para cliente: ${clientId}`);
  console.log(`Email: ${email}\n`);

  // 1. Cargar config del cliente
  const config = loadClientConfig(clientId);

  // Guard: el client.id del config debe coincidir con el --client argumento
  if (config.client.id !== clientId) {
    console.error(
      `❌ El client.id en el config ("${config.client.id}") no coincide con --client="${clientId}"`,
    );
    console.error('   Verifica que estás apuntando al cliente correcto.\n');
    process.exit(1);
  }

  // 2. Leer variables de entorno del cliente
  const env            = loadClientEnv(clientId);
  const supabaseUrl    = requireEnvVar(env, 'NEXT_PUBLIC_SUPABASE_URL', clientId);
  const serviceRoleKey = requireEnvVar(env, 'SUPABASE_SERVICE_ROLE_KEY', clientId);

  // 3. Crear cliente Supabase con service_role (nunca anon key para admin ops)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });

  // 4. Generar contraseña temporal
  const temporaryPassword = generateTemporaryPassword();

  // 5. Crear usuario en Supabase Auth con client_id en user_metadata
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password:       temporaryPassword,
    email_confirm:  true,          // el doctor no necesita confirmar — credenciales entregadas directamente
    user_metadata:  {
      client_id:    config.client.id,   // leído por las políticas RLS: auth.jwt() -> 'user_metadata' ->> 'client_id'
      display_name: config.client.name,
    },
  });

  if (error) {
    console.error('❌ Error al crear el usuario en Supabase Auth:');
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }

  if (!data.user) {
    console.error('❌ Supabase no devolvió el usuario creado. Verifica el dashboard.\n');
    process.exit(1);
  }

  // 6. Imprimir credenciales para entregar al doctor
  console.log('═══════════════════════════════════════════════════');
  console.log('✅ Usuario creado correctamente');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  UUID:              ${data.user.id}`);
  console.log(`  Email:             ${email}`);
  console.log(`  Contraseña:        ${temporaryPassword}`);
  console.log(`  client_id (meta):  ${config.client.id}`);
  console.log(`  display_name:      ${config.client.name}`);
  console.log('───────────────────────────────────────────────────');
  console.log('  ⚠️  Entrega estas credenciales al doctor de forma');
  console.log('      segura (mensaje cifrado, nunca por email plano).');
  console.log('  ⚠️  El doctor debe cambiar la contraseña al entrar.');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch((err: unknown) => {
  console.error('❌ Error inesperado:', (err as Error).message ?? err);
  process.exit(1);
});
