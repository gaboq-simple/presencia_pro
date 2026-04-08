/**
 * scripts/validate-config.ts
 * Valida que un client.config.ts esté listo para deploy.
 *
 * Uso:
 *   npx ts-node --project tsconfig.scripts.json scripts/validate-config.ts --client=dra-quevedo
 *
 * Salidas:
 *   ✅ Config lista para deploy — sin errores bloqueantes
 *   ❌ N error(es) bloqueante(s): [lista]
 *
 * Códigos de salida:
 *   0 — config válida (puede haber advertencias)
 *   1 — config inválida o cliente no encontrado
 */

import * as path from 'path';
// Ruta relativa para evitar dependencia de tsconfig-paths en runtime
import { ClientConfigSchema } from '../packages/engine/src/types/client.config.schema';

// ─── Args ─────────────────────────────────────────────────────────────────────

const clientId = process.argv
  .find((a) => a.startsWith('--client='))
  ?.split('=')
  .slice(1)
  .join('=');

if (!clientId) {
  console.error(
    '\nUso: npx ts-node --project tsconfig.scripts.json scripts/validate-config.ts --client=<id>',
  );
  process.exit(1);
}

// ─── Load config ──────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
// require() sin extensión — ts-node resuelve .ts automáticamente
const configPath = path.join(ROOT, 'clients', clientId, 'src', 'config', 'client.config');

let rawConfig: unknown;
try {
  // El import es type-only en client.config.ts — no genera runtime dependency.
  // require() resuelve el módulo y devuelve el objeto clientConfig puro.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(configPath) as { clientConfig?: unknown };
  if (mod.clientConfig === undefined) {
    throw new Error('El archivo no exporta "clientConfig".');
  }
  rawConfig = mod.clientConfig;
} catch (err) {
  console.error(`\n❌ No se pudo cargar clients/${clientId}/src/config/client.config.ts`);
  console.error(`   ${(err as Error).message}`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const errors: string[] = [];
const warnings: string[] = [];

function err(msg: string): void { errors.push(msg); }
function warn(msg: string): void { warnings.push(msg); }

// ─── 1. Zod schema validation ─────────────────────────────────────────────────

const result = ClientConfigSchema.safeParse(rawConfig);
if (!result.success) {
  for (const issue of result.error.issues) {
    const fieldPath = issue.path.join('.') || '(raíz)';
    err(`[schema] ${fieldPath} — ${issue.message}`);
  }
}

// ─── 2. Detección de valores "PENDIENTE" ──────────────────────────────────────
// Cualquier string con valor literal "PENDIENTE" (case-insensitive) bloquea el deploy.

function scanPendiente(obj: unknown, prefix = ''): void {
  if (typeof obj === 'string' && obj.trim().toUpperCase() === 'PENDIENTE') {
    err(`[pendiente] ${prefix} tiene valor "PENDIENTE"`);
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => scanPendiente(item, `${prefix}[${i}]`));
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      scanPendiente(v, prefix ? `${prefix}.${k}` : k);
    }
  }
}
scanPendiente(rawConfig);

// ─── 3. Campos críticos vacíos ─────────────────────────────────────────────────
// Estos campos no pueden estar vacíos — bloquean la operación básica del sistema.

type AnyObj = Record<string, unknown>;
const cfg = rawConfig as AnyObj;
const client = (cfg['client'] ?? {}) as AnyObj;
const bot    = (cfg['bot']    ?? {}) as AnyObj;
const contact = (cfg['contact'] ?? {}) as AnyObj;

const criticalFields: Array<{ path: string; value: unknown }> = [
  { path: 'client.name',       value: client['name']       },
  { path: 'client.specialty',  value: client['specialty']  },
  { path: 'client.domain',     value: client['domain']     },
  { path: 'bot.assistantName', value: bot['assistantName'] },
  { path: 'bot.greeting',      value: bot['greeting']      },
];

for (const { path: fieldPath, value } of criticalFields) {
  if (typeof value !== 'string' || value.trim() === '') {
    err(`[vacío] ${fieldPath} no puede estar vacío`);
  }
}

// Specialists
const specialists = Array.isArray(cfg['specialists']) ? cfg['specialists'] as AnyObj[] : [];
specialists.forEach((s, i) => {
  if (!s['id'] || String(s['id']).trim() === '')         err(`[vacío] specialists[${i}].id`);
  if (!s['calendarId'] || String(s['calendarId']).trim() === '') err(`[vacío] specialists[${i}].calendarId`);
});

// ─── 4. Formato E.164 México (521 + 10 dígitos = 13 dígitos) ──────────────────
// Formato requerido: 521XXXXXXXXXX (sin +, sin espacios)

const E164_MX = /^521\d{10}$/;

const contactWa = String(contact['whatsapp'] ?? '');
if (contactWa && !E164_MX.test(contactWa)) {
  err(`[e164] contact.whatsapp "${contactWa}" — debe tener formato 521XXXXXXXXXX (13 dígitos)`);
}

specialists.forEach((s, i) => {
  const wa = String(s['whatsapp'] ?? '');
  if (wa && !E164_MX.test(wa)) {
    err(`[e164] specialists[${i}].whatsapp "${wa}" — debe tener formato 521XXXXXXXXXX (13 dígitos)`);
  }
});

// ─── 5. Formato de dominio ─────────────────────────────────────────────────────

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const domain = String(client['domain'] ?? '');
if (domain && !DOMAIN_RE.test(domain)) {
  err(`[dominio] client.domain "${domain}" no es un dominio válido (ej: ejemplo.com)`);
}

// ─── 6. URLs válidas si no están vacías ───────────────────────────────────────
// Los campos UrlOrEmpty del schema aceptan '' — pero si tienen valor, debe ser URL real.

const serviceModes = (cfg['serviceModes'] ?? {}) as AnyObj;
const consultorio  = (serviceModes['consultorio'] ?? {}) as AnyObj;
const postConsulta = (cfg['postConsulta'] ?? {}) as AnyObj;

const urlFields: Array<{ path: string; value: string }> = [
  { path: 'serviceModes.consultorio.googleMapsUrl', value: String(consultorio['googleMapsUrl'] ?? '') },
  { path: 'postConsulta.reviewUrl',                 value: String(postConsulta['reviewUrl']    ?? '') },
  { path: 'contact.bookingUrl',                     value: String(contact['bookingUrl']        ?? '') },
  { path: 'contact.instagram',                      value: String(contact['instagram']         ?? '') },
  { path: 'contact.tiktok',                         value: String(contact['tiktok']            ?? '') },
];

for (const { path: fieldPath, value } of urlFields) {
  if (value && value !== '') {
    try {
      new URL(value);
    } catch {
      err(`[url] ${fieldPath} "${value}" no es una URL válida`);
    }
  }
}

// ─── 7. Advertencias no bloqueantes ───────────────────────────────────────────

const email = String(contact['email'] ?? '');
if (!email || email.trim() === '') {
  warn('contact.email está vacío — las notificaciones por email no funcionarán');
}

if (!postConsulta['reviewUrl'] || String(postConsulta['reviewUrl']).trim() === '') {
  warn('postConsulta.reviewUrl está vacío — review_request enviará mensaje sin link');
}

const products = Array.isArray(cfg['products']) ? cfg['products'] as AnyObj[] : [];
products.forEach((p, i) => {
  const pu = String(p['purchaseUrl'] ?? '');
  if (!pu || pu.trim() === '') {
    warn(`products[${i}] (${p['name'] ?? i}).purchaseUrl está vacío — link de compra desactivado`);
  }
});

// ─── Reporte ──────────────────────────────────────────────────────────────────

console.log(`\nValidando config: ${clientId}\n`);

if (warnings.length > 0) {
  console.log('⚠️  Advertencias (no bloquean el deploy):');
  warnings.forEach((w) => console.log(`   ${w}`));
  console.log('');
}

if (errors.length === 0) {
  console.log('✅ Config lista para deploy — sin errores bloqueantes\n');
} else {
  console.log(`❌ ${errors.length} error(es) bloqueante(s):\n`);
  errors.forEach((e) => console.log(`   ${e}`));
  console.log('');
  process.exit(1);
}
