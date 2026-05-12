/**
 * scripts/create-seller.ts
 * Crea un vendedor en Supabase Auth e inserta la fila correspondiente en sellers.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json scripts/create-seller.ts \
 *     --name="Nombre Apellido" \
 *     --email="vendedor@presenciapro.com" \
 *     --phone="5215500000099" \
 *     [--setup-pct=20] \
 *     [--monthly-mxn=120] \
 *     [--monthly-months=6] \
 *     [--operator]
 *
 * Variables de entorno requeridas (leídas de clients/dra-quevedo/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL   — URL del proyecto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  — service_role key (nunca se expone al frontend)
 *
 * Salidas:
 *   ✅ Seller creado — imprime ID, email, contraseña temporal
 *   ❌ Error — describe la causa y sale con código 1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { CreateSellerSchema } from '../packages/engine/src/types/seller.schema';

// ─── Argumentos ───────────────────────────────────────────────────────────────

interface ParsedArgs {
  name: string;
  email: string;
  phone: string;
  setupPct: number;
  monthlyMxn: number;
  monthlyMonths: number;
  isOperator: boolean;
}

function parseArgs(): ParsedArgs {
  const getFlag = (flag: string): string | undefined =>
    process.argv.find((a) => a.startsWith(`--${flag}=`))?.split('=').slice(1).join('=');

  const hasFlag = (flag: string): boolean =>
    process.argv.includes(`--${flag}`);

  const name         = getFlag('name');
  const email        = getFlag('email');
  const phone        = getFlag('phone');
  const setupPctRaw  = getFlag('setup-pct');
  const monthlyMxnRaw    = getFlag('monthly-mxn');
  const monthlyMonthsRaw = getFlag('monthly-months');
  const isOperator   = hasFlag('operator');

  if (!name || !email || !phone) {
    console.error(
      '\nUso: npx ts-node --project tsconfig.scripts.json scripts/create-seller.ts' +
      ' --name="Nombre" --email=<email> --phone=<phone>' +
      ' [--setup-pct=20] [--monthly-mxn=120] [--monthly-months=6] [--operator]\n',
    );
    process.exit(1);
  }

  const setupPct     = setupPctRaw     !== undefined ? parseFloat(setupPctRaw)     : 20;
  const monthlyMxn   = monthlyMxnRaw   !== undefined ? parseFloat(monthlyMxnRaw)   : 120;
  const monthlyMonths = monthlyMonthsRaw !== undefined ? parseInt(monthlyMonthsRaw, 10) : 6;

  if (isNaN(setupPct) || isNaN(monthlyMxn) || isNaN(monthlyMonths)) {
    console.error('❌ --setup-pct, --monthly-mxn y --monthly-months deben ser números válidos.');
    process.exit(1);
  }

  return { name, email, phone, setupPct, monthlyMxn, monthlyMonths, isOperator };
}

// ─── Leer variables de entorno ─────────────────────────────────────────────────
// Los scripts de infraestructura apuntan al mismo proyecto Supabase.
// Se lee desde clients/dra-quevedo/.env.local como fuente canónica.

function loadEnv(): Record<string, string> {
  const ROOT    = path.resolve(__dirname, '..');
  const envPath = path.join(ROOT, 'clients', 'dra-quevedo', '.env.local');

  if (!fs.existsSync(envPath)) {
    console.error('❌ No se encontró clients/dra-quevedo/.env.local');
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

function requireEnvVar(env: Record<string, string>, key: string): string {
  const value = env[key] ?? process.env[key] ?? '';
  if (!value) {
    console.error(`❌ Variable de entorno "${key}" no encontrada en clients/dra-quevedo/.env.local`);
    process.exit(1);
  }
  return value;
}

// ─── Contraseña temporal ──────────────────────────────────────────────────────
// 24 bytes de entropía → 48 caracteres hex.

function generateTemporaryPassword(): string {
  return crypto.randomBytes(24).toString('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // Validar con Zod antes de llamar a Supabase
  const parsed = CreateSellerSchema.safeParse({
    name:                      args.name,
    phone:                     args.phone,
    email:                     args.email,
    commission_setup_pct:      args.setupPct,
    commission_monthly_mxn:    args.monthlyMxn,
    commission_monthly_months: args.monthlyMonths,
    is_operator:               args.isOperator,
  });

  if (!parsed.success) {
    console.error('❌ Datos inválidos:');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const input = parsed.data;

  // Leer env y construir cliente Supabase
  const env            = loadEnv();
  const supabaseUrl    = requireEnvVar(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnvVar(env, 'SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  });

  const temporaryPassword = generateTemporaryPassword();

  // 1. Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email:          input.email,
    password:       temporaryPassword,
    email_confirm:  true,
    user_metadata:  {
      role: input.is_operator ? 'operator' : 'seller',
    },
  });

  if (authError) {
    // Email duplicado → mensaje claro sin stack trace
    if (authError.message.toLowerCase().includes('already been registered') ||
        authError.message.toLowerCase().includes('already exists')) {
      console.error(`❌ El email "${input.email}" ya existe en Supabase Auth.`);
      console.error('   Usa un email distinto o consulta el dashboard de Supabase.\n');
    } else {
      console.error('❌ Error al crear el usuario en Supabase Auth:');
      console.error(`   ${authError.message}\n`);
    }
    process.exit(1);
  }

  if (!authData.user) {
    console.error('❌ Supabase no devolvió el usuario creado. Verifica el dashboard.\n');
    process.exit(1);
  }

  const userId = authData.user.id;

  // 2. Insertar fila en sellers
  const { data: sellerData, error: sellerError } = await supabase
    .from('sellers')
    .insert({
      user_id:                   userId,
      name:                      input.name,
      phone:                     input.phone,
      email:                     input.email,
      commission_setup_pct:      input.commission_setup_pct,
      commission_monthly_mxn:    input.commission_monthly_mxn,
      commission_monthly_months: input.commission_monthly_months,
      is_operator:               input.is_operator,
    })
    .select('id')
    .single();

  if (sellerError) {
    // Rollback manual: eliminar el usuario auth recién creado para mantener consistencia
    await supabase.auth.admin.deleteUser(userId);

    if (sellerError.code === '23505') {
      console.error(`❌ Conflicto único: email o teléfono ya existe en la tabla sellers.`);
      console.error(`   ${sellerError.details ?? sellerError.message}\n`);
    } else {
      console.error('❌ Error al insertar en sellers:');
      console.error(`   ${sellerError.message}\n`);
    }
    process.exit(1);
  }

  // 3. Imprimir credenciales
  const role = input.is_operator ? 'Operador' : 'Vendedor';

  console.log('═══════════════════════════════════════════════════');
  console.log(`✅ ${role} creado correctamente`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Seller ID:         ${sellerData.id}`);
  console.log(`  Auth UUID:         ${userId}`);
  console.log(`  Nombre:            ${input.name}`);
  console.log(`  Email:             ${input.email}`);
  console.log(`  Teléfono:          ${input.phone}`);
  console.log(`  Comisión setup:    ${input.commission_setup_pct}%`);
  console.log(`  Comisión mensual:  $${input.commission_monthly_mxn} MXN × ${input.commission_monthly_months} meses`);
  console.log(`  Operador:          ${input.is_operator ? 'Sí' : 'No'}`);
  console.log(`  Contraseña:        ${temporaryPassword}`);
  console.log('───────────────────────────────────────────────────');
  console.log('  ⚠️  Entrega estas credenciales de forma segura.');
  console.log('  ⚠️  El vendedor debe cambiar la contraseña al entrar.');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch((err: unknown) => {
  console.error('❌ Error inesperado:', (err as Error).message ?? err);
  process.exit(1);
});
