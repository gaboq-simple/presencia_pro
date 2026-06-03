/**
 * apps/lifestyle/scripts/onboard-business.ts
 *
 * Provisiona un negocio completo en PresenciaPro Lifestyle a partir de un JSON
 * de configuración. Inserta businesses, staff, staff_availability, services y
 * staff_services en el orden correcto respetando FKs.
 *
 * Uso (desde la raíz del monorepo):
 *   npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json>
 *   npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json> --validate
 *   npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json> --dry-run
 *   npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json> --force
 *
 * Flags:
 *   --validate   Valida el JSON con Zod y sale. No toca la DB.
 *   --dry-run    Muestra qué insertaría sin tocar la DB.
 *   --force      Re-ejecuta aunque el slug ya exista (UPDATE + re-insert).
 *
 * Variables requeridas (apps/lifestyle/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Env loader ───────────────────────────────────────────────────────────────

function loadEnv(): void {
  const candidates = [
    path.join(process.cwd(), 'apps/lifestyle/.env.local'),
    path.join(process.cwd(), '.env.local'),
  ];

  let loaded = false;
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key   = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    }

    loaded = true;
    break;
  }

  if (!loaded) {
    console.error('❌ No se encontró apps/lifestyle/.env.local');
    console.error('   Copia apps/lifestyle/.env.local.example y rellena las credenciales.');
    process.exit(1);
  }
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

type Flags = {
  configPath: string;
  validate:   boolean;
  dryRun:     boolean;
  force:      boolean;
};

function parseArgs(): Flags {
  const args = process.argv.slice(2);

  const configPath = args.find((a) => !a.startsWith('--'));
  if (!configPath) {
    console.error('❌ Falta el archivo de configuración.');
    console.error('   Uso: npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json>');
    process.exit(1);
  }

  return {
    configPath,
    validate: args.includes('--validate'),
    dryRun:   args.includes('--dry-run'),
    force:    args.includes('--force'),
  };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM requerido');

// F-05: Validación IANA timezone
function isValidIANATimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DayHoursOpenCloseSchema = z.object({
  open:  TimeSchema,
  close: TimeSchema,
});

const OfficeHoursSchema = z.object({
  mon: DayHoursOpenCloseSchema.nullable().optional(),
  tue: DayHoursOpenCloseSchema.nullable().optional(),
  wed: DayHoursOpenCloseSchema.nullable().optional(),
  thu: DayHoursOpenCloseSchema.nullable().optional(),
  fri: DayHoursOpenCloseSchema.nullable().optional(),
  sat: DayHoursOpenCloseSchema.nullable().optional(),
  sun: DayHoursOpenCloseSchema.nullable().optional(),
});

const DayAvailabilitySchema = z.object({
  start:       TimeSchema,
  end:         TimeSchema,
  break_start: TimeSchema.optional(),  // F-03
  break_end:   TimeSchema.optional(),  // F-03
});

const StaffAvailabilityMapSchema = z.object({
  mon: DayAvailabilitySchema.nullable().optional(),
  tue: DayAvailabilitySchema.nullable().optional(),
  wed: DayAvailabilitySchema.nullable().optional(),
  thu: DayAvailabilitySchema.nullable().optional(),
  fri: DayAvailabilitySchema.nullable().optional(),
  sat: DayAvailabilitySchema.nullable().optional(),
  sun: DayAvailabilitySchema.nullable().optional(),
});

const BusinessSchema = z.object({
  name:                      z.string().min(1, 'name requerido'),
  slug:                      z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug: solo minúsculas, números y guiones'),
  business_type:             z.string().min(1, 'business_type requerido'),
  description:               z.string().nullable().optional(),
  tagline:                   z.string().nullable().optional(),
  address:                   z.string().min(1, 'address requerido'),
  timezone:                  z.string().min(1, 'timezone requerido').refine(
    isValidIANATimezone,
    { message: 'Timezone IANA inválida. Ejemplo válido: America/Mexico_City' },
  ),  // F-05
  palette:                   z.enum(['obsidian', 'humo', 'cuero', 'bronce', 'blanco', 'arena']).optional().default('arena'),
  walk_in_buffer_minutes:    z.number().int().min(0).optional().default(15),
  // F-04: campos operativos configurables
  max_late_minutes:          z.number().int().min(0).max(30).optional().default(15),
  auto_cancel_after_minutes: z.number().int().positive().optional().default(20),
  max_noshows_before_flag:   z.number().int().positive().optional().default(3),
  office_hours:              OfficeHoursSchema.optional(),
  social: z.object({
    instagram_url: z.string().url().nullable().optional(),
    tiktok_url:    z.string().url().nullable().optional(),
  }).optional(),
});

const BotSchema = z.object({
  assistant_name:    z.string().min(1, 'assistant_name requerido'),
  greeting:          z.string().min(1, 'greeting requerido'),
  fallback_message:  z.string().min(1, 'fallback_message requerido'),
  away_message:      z.string().min(1, 'away_message requerido'),
  followup_message:  z.string().optional(),
  whatsapp_message:  z.string().nullable().optional(),
});

const StaffMemberSchema = z.object({
  name:         z.string().min(1, 'name del staff requerido'),
  role:         z.enum(['admin', 'barber', 'assistant']),
  phone:        z.string().nullable().optional(),        // F-06: opcional en config
  whatsapp_id:  z.string().nullable().optional(),        // F-06: opcional en config
  photo_url:    z.string().url().nullable().optional(),
  availability: StaffAvailabilityMapSchema.optional(),
  services:     z.array(z.string().min(1)).optional().default([]),
});

const ServiceSchema = z.object({
  id:               z.string().min(1, 'id del servicio requerido'),
  name:             z.string().min(1, 'name del servicio requerido'),
  description:      z.string().nullable().optional(),
  price:            z.number().min(0, 'price >= 0'),
  currency:         z.string().default('MXN'),
  duration_minutes: z.number().int().positive('duration_minutes > 0'),
});

const WhatsappSchema = z.object({
  _comment:        z.string().optional(),
  number_model:    z.enum(['own', 'provided']),
  phone_number:    z.string().nullable().optional(),
  business_profile: z.object({
    display_name:       z.string().optional(),
    category:           z.string().optional(),
    description_short:  z.string().optional(),
    email:              z.string().email().optional(),
    logo_url:           z.string().url().nullable().optional(),
  }).optional(),
  verification: z.object({
    legal_name:      z.string().optional(),
    rfc:             z.string().optional(),
    fiscal_address:  z.string().optional(),
    owner_name:      z.string().optional(),
    owner_email:     z.string().email().optional(),
    owner_phone:     z.string().optional(),
  }).optional(),
});

const OwnerContactSchema = z.object({
  _comment: z.string().optional(),
  name:     z.string().min(1),
  phone:    z.string().min(1),
  email:    z.string().email(),
});

const OrganizationSchema = z.object({
  name:        z.string().min(1, 'name de organizacion requerido'),
  slug:        z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug de org: solo minusculas, numeros y guiones'),
  owner_name:  z.string().optional(),
  owner_email: z.string().email().optional(),
  owner_phone: z.string().optional(),
});

const ConfigSchema = z.object({
  _meta: z.object({
    version:    z.string().optional(),
    created_by: z.string().optional(),
    created_at: z.string().optional(),
  }).optional(),
  organization:  OrganizationSchema.optional(),
  business:      BusinessSchema,
  bot:           BotSchema,
  staff:         z.array(StaffMemberSchema).min(1, 'Se requiere al menos 1 miembro del staff'),
  services:      z.array(ServiceSchema).min(1, 'Se requiere al menos 1 servicio'),
  whatsapp:      WhatsappSchema.optional(),
  owner_contact: OwnerContactSchema.optional(),
});

type Config = z.infer<typeof ConfigSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 0=dom, 1=lun, 2=mar, 3=mie, 4=jue, 5=vie, 6=sab — convención JS getDay() */
const DAY_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Convierte office_hours del JSON ({ open, close }) al formato de DB ({ start, end }, clave numérica string). */
function convertOfficeHours(
  raw: z.infer<typeof OfficeHoursSchema>,
): Record<string, { start: string; end: string } | null> {
  const result: Record<string, { start: string; end: string } | null> = {};
  // Inicializar los 7 días como null
  for (let i = 0; i <= 6; i++) result[String(i)] = null;
  // Sobrescribir con los días del JSON
  for (const [day, hours] of Object.entries(raw)) {
    const key = DAY_NUM[day];
    if (key === undefined) continue;
    result[String(key)] = hours ? { start: hours.open, end: hours.close } : null;
  }
  return result;
}

/** Genera N PINs de 4 dígitos únicos entre sí. */
function generateUniquePins(count: number): string[] {
  const pins = new Set<string>();
  while (pins.size < count) {
    pins.add(String(Math.floor(Math.random() * 10000)).padStart(4, '0'));
  }
  return Array.from(pins);
}

/** Genera un token de 32 caracteres hexadecimales. */
function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Valida que todos los service IDs referenciados en staff.services existen en services[]. */
function validateServiceReferences(config: Config): void {
  const serviceIds = new Set(config.services.map((s) => s.id));
  const errors: string[] = [];

  for (const member of config.staff) {
    for (const sid of member.services) {
      if (!serviceIds.has(sid)) {
        errors.push(`  Staff "${member.name}" referencia servicio "${sid}" que no existe en services[].`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('❌ Referencias de servicios inválidas:');
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }
}

function supabaseClient(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridos.');
    process.exit(1);
  }
  return createClient(url, key);
}

// ─── Slug check ───────────────────────────────────────────────────────────────

async function checkSlugExists(
  supabase: SupabaseClient,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('❌ Error al verificar slug:', error.message);
    process.exit(1);
  }

  return (data as { id: string } | null)?.id ?? null;
}

// ─── Dry-run printer ──────────────────────────────────────────────────────────

function printDryRun(config: Config, accessToken: string, assistantToken: string, pins: string[]): void {
  const DIVIDER = '─'.repeat(60);

  console.log('\n' + DIVIDER);
  console.log('DRY-RUN — ningun dato sera insertado en la base de datos');
  console.log(DIVIDER);

  if (config.organization) {
    console.log('\n[organizations]');
    console.log(`  name:        ${config.organization.name}`);
    console.log(`  slug:        ${config.organization.slug}`);
    console.log(`  access_token: <se generara o reutilizara>`);
  }

  console.log('\n[businesses]');
  console.log(`  name:                   ${config.business.name}`);
  console.log(`  slug:                   ${config.business.slug}`);
  console.log(`  business_type:          ${config.business.business_type}`);
  console.log(`  address:                ${config.business.address}`);
  console.log(`  timezone:               ${config.business.timezone}`);
  console.log(`  palette:                ${config.business.palette}`);
  console.log(`  walk_in_buffer_minutes: ${config.business.walk_in_buffer_minutes}`);
  console.log(`  bot_name:               ${config.bot.assistant_name}`);
  console.log(`  whatsapp_number:        '' (placeholder — Fase 2)`);
  console.log(`  whatsapp_phone_number_id: '' (placeholder — Fase 2)`);
  console.log(`  access_token:           ${accessToken.slice(0, 8)}... (32 chars)`);
  console.log(`  assistant_token:        ${assistantToken.slice(0, 8)}... (32 chars)`);
  if (config.business.office_hours) {
    console.log(`  office_hours:           ${JSON.stringify(convertOfficeHours(config.business.office_hours))}`);
  }

  console.log('\n[staff]');
  config.staff.forEach((member, i) => {
    console.log(`  [${i}] name: ${member.name}  role: ${member.role}  pin: ${pins[i]}`);
  });

  console.log('\n[staff_availability]');
  for (const member of config.staff) {
    if (!member.availability) continue;
    for (const [day, hours] of Object.entries(member.availability)) {
      if (!hours) continue;
      const breakStr = hours.break_start && hours.break_end
        ? `  [descanso ${hours.break_start}–${hours.break_end}]`
        : '';
      console.log(`  ${member.name} — ${day} (${DAY_NUM[day]}): ${hours.start}–${hours.end}${breakStr}`);
    }
  }

  console.log('\n[services]');
  for (const svc of config.services) {
    console.log(`  [${svc.id}] ${svc.name} — $${svc.price} ${svc.currency} — ${svc.duration_minutes} min`);
  }

  console.log('\n[staff_services]');
  for (const member of config.staff) {
    if (member.services.length === 0) continue;
    console.log(`  ${member.name} → [${member.services.join(', ')}]`);
  }

  if (config.whatsapp || config.bot.greeting || config.bot.followup_message || config.owner_contact) {
    console.log('\n[onboarding_data JSONB]');
    const od = buildOnboardingData(config);
    console.log('  ' + JSON.stringify(od, null, 2).replace(/\n/g, '\n  '));
  }

  const warnings = buildWarnings(config);
  if (warnings.length) {
    console.log('\n[advertencias]');
    warnings.forEach((w) => console.log(`  ${w}`));
  }

  console.log('\n' + DIVIDER + '\n');
}

// ─── onboarding_data builder ──────────────────────────────────────────────────

function buildOnboardingData(config: Config): Record<string, unknown> {
  const od: Record<string, unknown> = {};

  const botExtra: Record<string, string> = {};
  if (config.bot.greeting)         botExtra['greeting']          = config.bot.greeting;
  if (config.bot.followup_message) botExtra['followup_message']  = config.bot.followup_message;
  if (Object.keys(botExtra).length) od['bot_extra'] = botExtra;

  if (config.whatsapp) {
    const { _comment: _, ...wa } = config.whatsapp;
    od['whatsapp'] = wa;
  }

  if (config.owner_contact) {
    const { _comment: _, ...oc } = config.owner_contact;
    od['owner_contact'] = oc;
  }

  return od;
}

function buildWarnings(config: Config): string[] {
  const warnings: string[] = [];
  if (!config.whatsapp)      warnings.push('⚠️  Sección whatsapp ausente — Fase 2 pendiente.');
  if (!config.owner_contact) warnings.push('⚠️  Sección owner_contact ausente.');
  return warnings;
}

// ─── Insert pipeline ──────────────────────────────────────────────────────────

type InsertResult = {
  businessId:     string;
  staffRows:      Array<{ name: string; id: string; pin: string }>;
  serviceCount:   number;
  organization?:  { id: string; name: string; access_token: string; isNew: boolean };
};

async function upsertOrganization(
  supabase: SupabaseClient,
  orgConfig: NonNullable<Config['organization']>,
): Promise<{ id: string; name: string; access_token: string; isNew: boolean }> {
  // Verificar si la organización ya existe por slug
  const { data: existing, error: lookupError } = await supabase
    .from('organizations')
    .select('id, name, access_token')
    .eq('slug', orgConfig.slug)
    .maybeSingle();

  if (lookupError) {
    console.error('Error al buscar organizacion:', lookupError.message);
    process.exit(1);
  }

  if (existing) {
    const row = existing as { id: string; name: string; access_token: string };
    console.log(`  ✓ Organizacion existente reutilizada: ${row.name} (id: ${row.id})`);
    return { id: row.id, name: row.name, access_token: row.access_token, isNew: false };
  }

  // Crear nueva organización
  const orgToken = generateToken();
  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name:        orgConfig.name,
      slug:        orgConfig.slug,
      owner_name:  orgConfig.owner_name ?? null,
      owner_email: orgConfig.owner_email ?? null,
      owner_phone: orgConfig.owner_phone ?? null,
      access_token: orgToken,
    })
    .select('id, name, access_token')
    .single();

  if (error) {
    console.error('Error al insertar organizacion:', error.message);
    process.exit(1);
  }

  const row = data as { id: string; name: string; access_token: string };
  console.log(`  ✓ Organizacion creada: ${row.name} (id: ${row.id})`);
  return { id: row.id, name: row.name, access_token: row.access_token, isNew: true };
}

async function insertAll(
  supabase: SupabaseClient,
  config: Config,
  accessToken: string,
  assistantToken: string,
  pins: string[],
  existingBusinessId: string | null,
): Promise<InsertResult> {

  // ── 0. organization (si aplica) ──────────────────────────────────────────────

  let organization: InsertResult['organization'];

  if (config.organization) {
    organization = await upsertOrganization(supabase, config.organization);
  }

  // ── 1. businesses ────────────────────────────────────────────────────────────

  const officeHours = config.business.office_hours
    ? convertOfficeHours(config.business.office_hours)
    : null;

  const onboardingData = buildOnboardingData(config);
  const hasOnboardingData = Object.keys(onboardingData).length > 0;

  const businessRow = {
    name:                      config.business.name,
    slug:                      config.business.slug,
    business_type:             config.business.business_type,
    description:               config.business.description ?? null,
    tagline:                   config.business.tagline ?? null,
    address:                   config.business.address,
    timezone:                  config.business.timezone,
    palette:                   config.business.palette,
    walk_in_buffer_minutes:    config.business.walk_in_buffer_minutes,
    // F-04: campos operativos configurables
    max_late_minutes:          config.business.max_late_minutes,
    auto_cancel_after_minutes: config.business.auto_cancel_after_minutes,
    max_noshows_before_flag:   config.business.max_noshows_before_flag,
    office_hours:              officeHours,
    instagram_url:             config.business.social?.instagram_url ?? null,
    tiktok_url:                config.business.social?.tiktok_url ?? null,
    bot_name:                  config.bot.assistant_name,
    fallback_message:          config.bot.fallback_message,
    away_message:              config.bot.away_message,
    whatsapp_message:          config.bot.whatsapp_message ?? null,
    // Placeholders Fase 1 — se actualizan al conectar WhatsApp
    whatsapp_number:           '',
    whatsapp_phone_number_id:  '',
    // Tokens de acceso generados
    access_token:              accessToken,
    assistant_token:           assistantToken,
    // Multi-sucursal: FK a organizations (null si standalone)
    organization_id:           organization?.id ?? null,
    // Datos Fase 2
    onboarding_data:           hasOnboardingData ? onboardingData : null,
    active:                    true,
  };

  let businessId: string;

  if (existingBusinessId) {
    // --force: actualizar fila existente
    const { error } = await supabase
      .from('businesses')
      .update(businessRow)
      .eq('id', existingBusinessId);

    if (error) {
      console.error('❌ Error actualizando businesses:', error.message);
      process.exit(1);
    }
    businessId = existingBusinessId;
    console.log(`  ✓ businesses actualizado (--force) — id: ${businessId}`);

    // Eliminar staff/services/availability/staff_services existentes para re-insertar
    await supabase.from('staff_availability').delete().in(
      'staff_id',
      (await supabase.from('staff').select('id').eq('business_id', businessId)).data?.map(
        (r: { id: string }) => r.id,
      ) ?? [],
    );
    await supabase.from('staff_services').delete().in(
      'staff_id',
      (await supabase.from('staff').select('id').eq('business_id', businessId)).data?.map(
        (r: { id: string }) => r.id,
      ) ?? [],
    );
    await supabase.from('staff').delete().eq('business_id', businessId);
    await supabase.from('services').delete().eq('business_id', businessId);
  } else {
    const { data, error } = await supabase
      .from('businesses')
      .insert(businessRow)
      .select('id')
      .single();

    if (error) {
      console.error('❌ Error insertando businesses:', error.message);
      process.exit(1);
    }
    businessId = (data as { id: string }).id;
    console.log(`  ✓ businesses insertado — id: ${businessId}`);
  }

  // ── 2. services ──────────────────────────────────────────────────────────────

  const serviceIdMap = new Map<string, string>(); // logicalId → dbUUID

  for (const svc of config.services) {
    const { data, error } = await supabase
      .from('services')
      .insert({
        business_id:      businessId,
        name:             svc.name,
        description:      svc.description ?? null,
        price:            svc.price,
        currency:         svc.currency,
        duration_minutes: svc.duration_minutes,
        active:           true,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`❌ Error insertando service "${svc.name}":`, error.message);
      process.exit(1);
    }
    serviceIdMap.set(svc.id, (data as { id: string }).id);
  }
  console.log(`  ✓ ${config.services.length} servicio(s) insertado(s)`);

  // ── 3. staff ─────────────────────────────────────────────────────────────────

  const staffRows: InsertResult['staffRows'] = [];

  for (let i = 0; i < config.staff.length; i++) {
    const member = config.staff[i]!;
    const pin    = pins[i]!;

    // F-06: advertir si staff no tiene teléfono/whatsapp_id
    if (!member.phone) {
      console.warn(`  ⚠️  Staff '${member.name}' sin teléfono/WhatsApp — no recibirá notificaciones del sistema.`);
    }

    const { data, error } = await supabase
      .from('staff')
      .insert({
        business_id: businessId,
        name:        member.name,
        role:        member.role,
        photo_url:   member.photo_url ?? null,
        pin,
        phone:       member.phone ?? '',
        whatsapp_id: member.whatsapp_id ?? '',
        active:      true,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`❌ Error insertando staff "${member.name}":`, error.message);
      process.exit(1);
    }

    const staffId = (data as { id: string }).id;
    staffRows.push({ name: member.name, id: staffId, pin });

    // ── 4. staff_availability ─────────────────────────────────────────────────

    if (member.availability) {
      for (const [day, hours] of Object.entries(member.availability)) {
        if (!hours) continue;
        const dayOfWeek = DAY_NUM[day];
        if (dayOfWeek === undefined) continue;

        const { error: availError } = await supabase
          .from('staff_availability')
          .insert({
            staff_id:    staffId,
            day_of_week: dayOfWeek,
            start_time:  hours.start,
            end_time:    hours.end,
            // F-03: soporte de descanso
            break_start: hours.break_start ?? null,
            break_end:   hours.break_end ?? null,
          });

        if (availError) {
          console.error(`❌ Error insertando disponibilidad de "${member.name}" (${day}):`, availError.message);
          process.exit(1);
        }
      }
    }

    // ── 5. staff_services ─────────────────────────────────────────────────────

    for (const logicalServiceId of member.services) {
      const dbServiceId = serviceIdMap.get(logicalServiceId);
      if (!dbServiceId) continue; // ya validado antes

      const { error: ssError } = await supabase
        .from('staff_services')
        .insert({ staff_id: staffId, service_id: dbServiceId });

      if (ssError) {
        console.error(`❌ Error insertando staff_services (${member.name} → ${logicalServiceId}):`, ssError.message);
        process.exit(1);
      }
    }
  }

  console.log(`  ✓ ${config.staff.length} miembro(s) de staff insertado(s) con disponibilidad y servicios`);

  return { businessId, staffRows, serviceCount: config.services.length, organization };
}

// ─── Post-insert verification ─────────────────────────────────────────────────

async function verifyInsert(supabase: SupabaseClient, businessId: string, config: Config): Promise<void> {
  const { data: biz } = await supabase
    .from('businesses')
    .select('id, slug, active, whatsapp_phone_number_id, whatsapp_number')
    .eq('id', businessId)
    .single();

  const { count: staffCount } = await supabase
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);

  const { count: svcCount } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);

  const bizRow = biz as { id: string; slug: string; active: boolean; whatsapp_phone_number_id: string; whatsapp_number: string } | null;
  const ok = bizRow && staffCount === config.staff.length && svcCount === config.services.length;

  if (!ok) {
    console.error('❌ Verificación post-insert falló. Revisa la DB manualmente.');
    process.exit(1);
  }

  // F-01: advertir si WhatsApp no está configurado
  if (!bizRow?.whatsapp_phone_number_id || !bizRow?.whatsapp_number) {
    console.warn('\n⚠️  WHATSAPP NO CONFIGURADO: whatsapp_phone_number_id está vacío.');
    console.warn('   El bot NO responderá mensajes hasta que se configure.');
    console.warn('   Ejecuta el SQL del paso 2 del checklist cuando tengas el número.\n');
  }
}

// ─── Summary printer ──────────────────────────────────────────────────────────

function printSummary(
  result: InsertResult,
  config: Config,
  accessToken: string,
  assistantToken: string,
): void {
  const DIVIDER = '═'.repeat(60);

  console.log('\n' + DIVIDER);
  console.log('✅ ONBOARDING COMPLETADO');
  console.log(DIVIDER);

  console.log(`\nNegocio:        ${config.business.name}`);
  console.log(`Slug:           ${config.business.slug}`);
  console.log(`Business ID:    ${result.businessId}`);
  console.log(`Timezone:       ${config.business.timezone}`);

  if (result.organization) {
    const org = result.organization;
    console.log('\n── Organizacion ────────────────────────────────────────');
    console.log(`${org.isNew ? 'Nueva' : 'Existente'}: ${org.name}`);
    console.log(`org_access_token: ${org.access_token}`);
    console.log(`  → URL (todas las sucursales): /dashboard?token=${org.access_token}`);
  }

  console.log('\n── Accesos del encargado de esta sucursal ─────────────');
  console.log(`access_token:   ${accessToken}`);
  console.log(`  → URL: /dashboard?token=${accessToken}`);

  console.log('\n── Accesos del asistente ──────────────────────────────');
  console.log(`assistant_token: ${assistantToken}`);
  console.log(`  → URL: /dashboard?token=${assistantToken}&role=assistant`);

  console.log('\n── Staff y PINs ────────────────────────────────────────');
  for (const row of result.staffRows) {
    console.log(`  ${row.name.padEnd(25)} PIN: ${row.pin}   ID: ${row.id}`);
  }

  console.log('\n── WhatsApp (pendiente — Fase 2) ──────────────────────');
  if (config.whatsapp?.phone_number) {
    console.log(`  Número aportado: ${config.whatsapp.phone_number}`);
    console.log(`  Modelo:          ${config.whatsapp.number_model}`);
  } else {
    console.log(`  Sin número configurado — actualizar whatsapp_number y`);
    console.log(`  whatsapp_phone_number_id en businesses al conectar WhatsApp.`);
  }

  const warnings = buildWarnings(config);
  if (warnings.length) {
    console.log('\n── Advertencias ────────────────────────────────────────');
    warnings.forEach((w) => console.log(`  ${w}`));
  }

  console.log('\n' + DIVIDER + '\n');
}

// ─── Checklist generator ──────────────────────────────────────────────────────

function generateChecklist(
  result: InsertResult,
  config: Config,
  accessToken: string,
  assistantToken: string,
): void {
  const timestamp = new Date().toISOString();
  const slug      = config.business.slug;

  // F-02: resolver URL real del env
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://tu-dominio.com';

  const waPhoneProvided = config.whatsapp?.phone_number
    ? `${config.whatsapp.phone_number} (modelo: ${config.whatsapp.number_model})`
    : null;

  const waStep2Detail = waPhoneProvided
    ? `  Número registrado en config: ${waPhoneProvided}\n  ⚠️ Aún debes obtener el \`phone_number_id\` de Meta Business Manager.`
    : `  ⚠️ PENDIENTE — número no configurado todavía.`;

  const staffLines = result.staffRows
    .map((r) => `  - ${r.name.padEnd(25)} PIN \`${r.pin}\`   ID: \`${r.id}\``)
    .join('\n');

  // F-01: nota de advertencia si WhatsApp no está configurado
  const whatsappWarning = [
    `> [!WARNING]`,
    `> **WHATSAPP NO CONFIGURADO** — El bot NO responderá mensajes hasta completar el paso 2.`,
    `> Ejecuta el SQL de ese paso en cuanto tengas el \`phone_number_id\` de Meta.`,
    ``,
  ].join('\n');

  const md = [
    `# Checklist de onboarding: ${config.business.name} (${slug})`,
    ``,
    `Generado: ${timestamp}`,
    `Estado del onboarding: 60% completo`,
    ``,
    whatsappWarning,
    `## ✅ Hecho automáticamente`,
    `- [x] Business creado: \`business_id=${result.businessId}\``,
    `- [x] Staff creados: ${result.staffRows.length} miembro(s) de staff`,
    `- [x] Services creados: ${result.serviceCount} servicio(s)`,
    `- [x] Access tokens generados`,
    ``,
    `## ⚠️ Pasos manuales pendientes`,
    ``,
    `### 1. Registrar webhook en Meta Business Manager`,
    `- URL: \`${appUrl}/api/bot\``,
    `- Verify token: usar \`WHATSAPP_WEBHOOK_VERIFY_TOKEN\` actual`,
    `- Suscribir a campo: \`messages\``,
    `- Verificar que \`META_APP_SECRET\` está configurado en Vercel → Settings → Environment Variables`,
    ``,
    `### 2. Obtener phone_number_id de Meta y conectar WhatsApp`,
    waStep2Detail,
    `- Entrar a Meta Business → WhatsApp → Phone Numbers`,
    `- Copiar el Phone Number ID del número del negocio`,
    `- Ejecutar en Supabase SQL Editor:`,
    `  \`\`\`sql`,
    `  UPDATE businesses`,
    `  SET whatsapp_phone_number_id = '<PHONE_NUMBER_ID>',`,
    `      whatsapp_number = '<NUMERO_E164_SIN_PLUS>'`,
    `  WHERE slug = '${slug}';`,
    `  \`\`\``,
    ``,
    `### 3. Configurar crons de Supabase`,
    `- Edge Function: \`dispatch-lifestyle-notifications\` → schedule: \`* * * * *\``,
    `- Edge Function: \`dispatch-auto-cancel\` → schedule: \`* * * * *\``,
    `- Edge Function: \`dispatch-weekly-report\` → schedule: \`0 10 * * 1\``,
    ``,
    `### 4. Entregar credenciales al cliente`,
    `- URL admin:  \`${appUrl}/dashboard?token=${accessToken}\``,
    `- URL staff:  \`${appUrl}/dashboard?token=${assistantToken}\``,
    `- PINs:`,
    staffLines,
    `- ⚠️ Guardar en 1Password antes de enviar al cliente`,
    ``,
    `### 5. Probar`,
    `- [ ] Mandar mensaje de prueba al WhatsApp del negocio`,
    `- [ ] Verificar que el bot responde`,
    `- [ ] Crear cita de prueba desde el panel`,
    `- [ ] Verificar que aparece en el dashboard`,
    `- [ ] Confirmar que el reminder de 24h llega al cliente`,
    `- [ ] Confirmar que el reminder de 2h llega al cliente`,
    ``,
    `---`,
    ``,
    `Una vez todos los pasos arriba estén ✓, marcar este checklist como done y cerrar onboarding.`,
    ``,
  ].join('\n');

  const onboardingDir = path.join(process.cwd(), 'onboarding');
  fs.mkdirSync(onboardingDir, { recursive: true });

  const checklistPath = path.join(onboardingDir, `${slug}-checklist.md`);
  fs.writeFileSync(checklistPath, md, 'utf-8');

  console.log(`\n✅ Onboarding 60% completo.`);
  console.log(`📋 Checklist en: onboarding/${slug}-checklist.md`);
  console.log(`➡️  Sigue los pasos 1-5 del checklist para completar.\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs();
  loadEnv();

  // ── Leer y parsear JSON ───────────────────────────────────────────────────

  const configPath = path.isAbsolute(flags.configPath)
    ? flags.configPath
    : path.join(process.cwd(), flags.configPath);

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Archivo no encontrado: ${configPath}`);
    process.exit(1);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error('❌ JSON inválido:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // ── Validar con Zod ───────────────────────────────────────────────────────

  const result = ConfigSchema.safeParse(rawJson);

  if (!result.success) {
    console.error('❌ Configuración inválida:\n');
    for (const issue of result.error.issues) {
      const path = issue.path.length ? `  [${issue.path.join('.')}] ` : '  ';
      console.error(`${path}${issue.message}`);
    }
    process.exit(1);
  }

  const config = result.data;

  // ── Validación cruzada de referencias ────────────────────────────────────

  validateServiceReferences(config);

  if (flags.validate) {
    console.log('✅ Configuración válida. (--validate: sin cambios en DB)');
    process.exit(0);
  }

  // ── Advertencias sobre secciones opcionales ───────────────────────────────

  const warnings = buildWarnings(config);
  warnings.forEach((w) => console.log(w));

  // ── Generar tokens y PINs ─────────────────────────────────────────────────

  const accessToken    = generateToken();
  const assistantToken = generateToken();
  const pins           = generateUniquePins(config.staff.length);

  // ── Dry-run ───────────────────────────────────────────────────────────────

  if (flags.dryRun) {
    printDryRun(config, accessToken, assistantToken, pins);
    process.exit(0);
  }

  // ── Verificar slug en DB ──────────────────────────────────────────────────

  const supabase = supabaseClient();
  const existingId = await checkSlugExists(supabase, config.business.slug);

  if (existingId && !flags.force) {
    console.error(`❌ El slug "${config.business.slug}" ya existe en la DB (id: ${existingId}).`);
    console.error('   Usa --force para sobrescribir o cambia el slug en el JSON.');
    process.exit(1);
  }

  // ── Insertar ──────────────────────────────────────────────────────────────

  console.log(`\nProvisionando "${config.business.name}" (slug: ${config.business.slug})...`);
  if (existingId) console.log('  Modo --force: actualizando negocio existente.');

  const insertResult = await insertAll(
    supabase,
    config,
    accessToken,
    assistantToken,
    pins,
    existingId,
  );

  // ── Verificación post-insert ──────────────────────────────────────────────

  await verifyInsert(supabase, insertResult.businessId, config);

  // ── Resumen ───────────────────────────────────────────────────────────────

  printSummary(insertResult, config, accessToken, assistantToken);

  // ── Generar checklist ─────────────────────────────────────────────────────

  generateChecklist(insertResult, config, accessToken, assistantToken);
}

main().catch((err: unknown) => {
  console.error('❌ Error inesperado:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
