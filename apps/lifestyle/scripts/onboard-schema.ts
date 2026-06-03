/**
 * apps/lifestyle/scripts/onboard-schema.ts
 *
 * Esquemas Zod del onboarding, extraídos de onboard-business.ts para que sean
 * importables SIN disparar efectos secundarios (main(), createClient, env).
 * Esto permite testear la retrocompatibilidad del schema con node:test sin red.
 *
 * Mantener todos los campos nuevos OPCIONALES → configs viejas siguen validando.
 */

import { z } from 'zod';

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM requerido');

// F-05: Validación IANA timezone
export function isValidIANATimezone(tz: string): boolean {
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

export const OfficeHoursSchema = z.object({
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

export const BusinessSchema = z.object({
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
  // S4-BOT-04: datos del negocio cableados al bot. Todos opcionales → retrocompat.
  review_url:                z.string().url().nullable().optional(),
  map_url:                   z.string().url().nullable().optional(),
  attributes:                z.record(z.string(), z.boolean()).optional(),
  social: z.object({
    instagram_url: z.string().url().nullable().optional(),
    tiktok_url:    z.string().url().nullable().optional(),
  }).optional(),
});

export const BotSchema = z.object({
  assistant_name:    z.string().min(1, 'assistant_name requerido'),
  greeting:          z.string().min(1, 'greeting requerido'),
  fallback_message:  z.string().min(1, 'fallback_message requerido'),
  away_message:      z.string().min(1, 'away_message requerido'),
  followup_message:  z.string().optional(),
  whatsapp_message:  z.string().nullable().optional(),
});

export const StaffMemberSchema = z.object({
  name:         z.string().min(1, 'name del staff requerido'),
  role:         z.enum(['admin', 'barber', 'assistant']),
  phone:        z.string().nullable().optional(),        // F-06: opcional en config
  whatsapp_id:  z.string().nullable().optional(),        // F-06: opcional en config
  photo_url:    z.string().url().nullable().optional(),
  availability: StaffAvailabilityMapSchema.optional(),
  services:     z.array(z.string().min(1)).optional().default([]),
});

export const ServiceSchema = z.object({
  id:               z.string().min(1, 'id del servicio requerido'),
  name:             z.string().min(1, 'name del servicio requerido'),
  description:      z.string().nullable().optional(),
  price:            z.number().min(0, 'price >= 0'),
  // S4-BOT-04: rango de precio opcional. Si se omiten, `price` es el exacto. Retrocompat.
  price_min:        z.number().min(0).nullable().optional(),
  price_max:        z.number().min(0).nullable().optional(),
  price_note:       z.string().nullable().optional(),
  currency:         z.string().default('MXN'),
  duration_minutes: z.number().int().positive('duration_minutes > 0'),
});

export const WhatsappSchema = z.object({
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

export const OwnerContactSchema = z.object({
  _comment: z.string().optional(),
  name:     z.string().min(1),
  phone:    z.string().min(1),
  email:    z.string().email(),
});

export const OrganizationSchema = z.object({
  name:        z.string().min(1, 'name de organizacion requerido'),
  slug:        z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug de org: solo minusculas, numeros y guiones'),
  owner_name:  z.string().optional(),
  owner_email: z.string().email().optional(),
  owner_phone: z.string().optional(),
});

export const ConfigSchema = z.object({
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

export type Config = z.infer<typeof ConfigSchema>;
