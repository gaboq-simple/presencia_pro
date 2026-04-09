import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

const ToneSchema = z.enum(['warm-premium', 'professional', 'friendly']);

const ServiceModeSchema = z.enum(['domicilio', 'consultorio']);

// URL que acepta string vacío para campos pendientes
const UrlOrEmptySchema = z.string().url().or(z.literal(''));

// Número WhatsApp: solo dígitos, sin + ni espacios (10–15 dígitos)
const WhatsAppPhoneSchema = z
  .string()
  .regex(/^\d{10,15}$/, 'whatsapp: solo dígitos, sin + ni espacios (10–15 dígitos)');

// ─── Specialist ───────────────────────────────────────────────────────────────

const SpecialistSchema = z.object({
  /** Slug único dentro de la instancia. Nunca cambia una vez asignado. */
  id: z.string().min(1),
  name: z.string().min(1),
  area: z.string().min(1),
  /** Frase corta que aparece bajo el nombre en la landing. */
  tagline: z.string().min(1),
  /** Lista de credenciales mostradas en la landing. */
  credentials: z.array(z.string().min(1)),
  /** Años de experiencia para mostrar en UI. Null si no aplica. */
  yearsExperience: z.number().int().nonnegative().nullable().optional(),
  /** Texto de ubicación para mostrar en la landing. Ej: "Zona Esmeralda, EdoMex" */
  location: z.string().min(1),
  whatsapp: WhatsAppPhoneSchema,
  /** Google Calendar ID del especialista (email o calendar ID). */
  calendarId: z.string().min(1),
  /** Ruta relativa a la imagen, ej: /images/doctor.jpg */
  photo: z.string().min(1),
});

// ─── ServiceIcon ──────────────────────────────────────────────────────────────

const ServiceIconSchema = z.enum([
  'sparkles',
  'map-pin',
  'home',
  'syringe',
  'clock',
  'shield',
]);

// ─── Service schemas ──────────────────────────────────────────────────────────

/** Campos compartidos por servicios de ambos perfiles. */
const BaseServiceSchema = z.object({
  /** Slug único del servicio dentro de la instancia. */
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  /** Ícono de Lucide para mostrar en la landing. */
  icon: ServiceIconSchema,
  /** Debe coincidir con un Specialist.id de la misma instancia. */
  specialistId: z.string().min(1),
  /**
   * Días sin nueva cita de este servicio antes de enviar reactivación.
   * Si se define, sobreescribe el global postConsulta.reactivationDays para pacientes
   * cuya última cita fue de este tipo de servicio.
   * Útil para servicios con ciclos de retorno distintos (ej: botox cada 4 meses).
   */
  followUpDays: z.number().int().positive().optional(),
});

/** Servicio para perfil medical — incluye modalidades y productos post-consulta. */
const MedicalServiceSchema = BaseServiceSchema.extend({
  /** Modalidades disponibles para este servicio. Mínimo una. */
  modes: z.array(ServiceModeSchema).min(1),
  /** IDs de Product recomendados post-consulta para este servicio. */
  postConsultaProducts: z.array(z.string()),
});

/** Servicio para perfil lifestyle — siempre en local, sin productos post-consulta. */
const LifestyleServiceSchema = BaseServiceSchema;

// ─── BotConfig ────────────────────────────────────────────────────────────────

const OfficeHoursSchema = z.object({
  /** Hora de inicio en formato HH:mm. Ej: "09:00" */
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm requerido'),
  /** Hora de cierre en formato HH:mm. Ej: "19:00" */
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:mm requerido'),
  /** Días de atención: 1=lunes, 7=domingo */
  days: z.array(z.number().int().min(1).max(7)).min(1),
});

const BotConfigSchema = z.object({
  /** Nombre del asistente virtual que el paciente verá. */
  assistantName: z.string().min(1),
  tone: ToneSchema,
  greeting: z.string().min(1),
  awayMessage: z.string().min(1),
  fallbackMessage: z.string().min(1),
  /** Horas de espera antes de mandar seguimiento si el paciente no responde. */
  followUpDelayHours: z.number().int().positive(),
  followUpMessage: z.string().min(1),
  officeHours: OfficeHoursSchema,
});

// ─── SchedulingConfig ─────────────────────────────────────────────────────────

const SchedulingConfigSchema = z.object({
  slotDurationMinutes: z.number().int().positive(),
  bufferBetweenSlotsMinutes: z.number().int().nonnegative(),
  /** Huecos bloqueados invisibles al paciente reservados para emergencias. */
  emergencySlotsPerDay: z.number().int().nonnegative(),
  /** Máximo de días hacia adelante para permitir agendamiento. */
  advanceBookingDays: z.number().int().positive(),
  /** Horas antes de la cita en que se envían recordatorios. Ej: [24, 2] */
  reminderSchedule: z.array(z.number().positive()).min(1),
  /** Mínimo de horas de anticipación para cancelar sin penalización. */
  cancellationWindowHours: z.number().int().nonnegative(),
  /** Si true, el paciente debe confirmar o el slot se libera automáticamente. */
  confirmationRequired: z.boolean(),
  /** Tiempo en horas para confirmar antes de liberar el slot. */
  confirmationWindowHours: z.number().int().positive(),
});

// ─── IntakeConfig ─────────────────────────────────────────────────────────────

const IntakeConfigSchema = z.object({
  /** Nombres de los campos a incluir en el formulario pre-consulta. */
  fields: z.array(z.string().min(1)).min(1),
  requiresSignature: z.boolean(),
  signatureLabel: z.string().min(1),
  privacyUrl: z.string().min(1),
});

// ─── DesignConfig ─────────────────────────────────────────────────────────────

const DesignColorsSchema = z.object({
  primary: z.string().min(1),
  primaryLight: z.string().min(1),
  primaryDark: z.string().min(1),
  background: z.string().min(1),
  surface: z.string().min(1),
  text: z.string().min(1),
  textMuted: z.string().min(1),
  border: z.string().min(1),
  white: z.string().min(1),
});

const DesignFontsSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});

const DesignConfigSchema = z.object({
  colors: DesignColorsSchema,
  fonts: DesignFontsSchema,
  /** Valor CSS de border-radius base. Ej: "0.5rem" */
  borderRadius: z.string().min(1),
});

// ─── PostConsultaConfig ───────────────────────────────────────────────────────
// Compartido por ambos perfiles. medical puede usar postConsultaMessage;
// lifestyle simplemente no lo define.

const PostConsultaConfigSchema = z.object({
  /** Horas después de la cita antes de pedir reseña. */
  reviewRequestDelayHours: z.number().int().positive(),
  /** URL de Google Reviews u otra plataforma. Vacío si está pendiente. */
  reviewUrl: UrlOrEmptySchema,
  /** Días sin nueva cita antes de enviar mensaje de reactivación. */
  reactivationDays: z.number().int().positive(),
  reactivationMessage: z.string().min(1),
  /**
   * Mensaje de seguimiento enviado ~1h después de finalizada la cita (post_consulta).
   * Opcional — si no se define, el sistema usa un mensaje genérico de agradecimiento.
   * TODO(cliente): Personalizar con instrucciones post-tratamiento específicas del servicio.
   */
  postConsultaMessage: z.string().min(1).optional(),
});

// ─── Product ──────────────────────────────────────────────────────────────────

const ProductSchema = z.object({
  /** Slug único del producto dentro de la instancia. */
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.enum(['MXN', 'USD']),
  /** URL de compra directa. Vacío si está pendiente. */
  purchaseUrl: UrlOrEmptySchema,
});

// ─── ServiceModes (modalidades de atención) — solo medical ───────────────────

const DomicilioModeSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
  availableZones: z.array(z.string().min(1)).min(1),
  /** Costo adicional en la moneda del cliente. 0 = incluido. */
  additionalCost: z.number().nonnegative(),
});

const ConsultorioModeSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
  address: z.string().min(1),
  googleMapsUrl: UrlOrEmptySchema,
  parkingAvailable: z.boolean(),
});

// ─── ContactSchema ────────────────────────────────────────────────────────────

const ContactSchema = z.object({
  whatsapp: WhatsAppPhoneSchema,
  whatsappMessage: z.string().min(1),
  email: z.string().email().or(z.literal('')),
  bookingUrl: UrlOrEmptySchema,
  instagram: UrlOrEmptySchema,
  tiktok: UrlOrEmptySchema,
  /**
   * Email del doctor al que se envían los reportes mensuales automáticos.
   * Opcional — si no está definido, el envío de email se omite sin lanzar error.
   */
  reportEmail: z.string().email().optional(),
});

// ─── SeoSchema ────────────────────────────────────────────────────────────────

const SeoSchema = z.object({
  title: z.string().min(10).max(70),
  description: z.string().min(50).max(160),
  keywords: z.array(z.string().min(1)).min(1).max(10),
  /** Ruta relativa a la imagen Open Graph. Ej: /images/og-image.jpg */
  ogImage: z.string().optional(),
});

// ─── BaseConfigSchema — campos compartidos por ambos perfiles ─────────────────

const BaseConfigSchema = z.object({
  profile: z.enum(['medical', 'lifestyle']),

  client: z.object({
    /** Slug único de la instancia. Kebab-case, nunca cambia. */
    id: z.string().min(1),
    name: z.string().min(1),
    specialty: z.string().min(1),
    domain: z.string().min(1),
    /** Ej: "America/Mexico_City" */
    timezone: z.string().min(1),
    /** Ej: "es-MX" */
    locale: z.string().min(1),
  }),

  bot: BotConfigSchema,

  /** Mínimo un especialista requerido. */
  specialists: z.array(SpecialistSchema).min(1),

  scheduling: SchedulingConfigSchema,

  contact: ContactSchema,

  postConsulta: PostConsultaConfigSchema,

  seo: SeoSchema,

  design: DesignConfigSchema,
});

// ─── MedicalConfigSchema ──────────────────────────────────────────────────────
// Para: médicos, dentistas, psicólogos, nutriólogos.
// Agrega: modalidades de atención, intake pre-consulta, productos post-consulta.
// Servicios incluyen modes[] y postConsultaProducts[].

const MedicalConfigSchema = BaseConfigSchema.extend({
  profile: z.literal('medical'),

  /** Mínimo un servicio requerido. Cada servicio declara sus modalidades. */
  services: z.array(MedicalServiceSchema).min(1),

  /**
   * Modalidades de atención disponibles en esta instancia.
   * Ambas requeridas — un servicio puede referenciar solo una, pero ambas
   * deben estar configuradas para que el engine pueda describir cada opción.
   */
  serviceModes: z.object({
    domicilio: DomicilioModeSchema,
    consultorio: ConsultorioModeSchema,
  }),

  /** Formulario pre-consulta con firma digital. */
  intake: IntakeConfigSchema,

  /** Productos recomendados post-consulta. Puede ser array vacío. */
  products: z.array(ProductSchema),
});

// ─── LifestyleConfigSchema ────────────────────────────────────────────────────
// Para: peluquerías, uñas, spa, estética.
// Sin intake, sin modalidades, sin productos post-consulta.
// Servicios simples — siempre en local.

const LifestyleConfigSchema = BaseConfigSchema.extend({
  profile: z.literal('lifestyle'),

  /** Mínimo un servicio requerido. Sin modalidades — siempre en local. */
  services: z.array(LifestyleServiceSchema).min(1),

  /** Dirección física del local. */
  address: z.string().min(1),

  /** URL de Google Maps del local. Vacío si está pendiente. */
  googleMapsUrl: UrlOrEmptySchema.optional(),
});

// ─── Root schema — discriminated union ───────────────────────────────────────

export const ClientConfigSchema = z.discriminatedUnion('profile', [
  MedicalConfigSchema,
  LifestyleConfigSchema,
]);

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isMedical(config: ClientConfig): config is MedicalConfig {
  return config.profile === 'medical';
}

export function isLifestyle(config: ClientConfig): config is LifestyleConfig {
  return config.profile === 'lifestyle';
}

// ─── Exported types ───────────────────────────────────────────────────────────

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type MedicalConfig = z.infer<typeof MedicalConfigSchema>;
export type LifestyleConfig = z.infer<typeof LifestyleConfigSchema>;
export type Specialist = z.infer<typeof SpecialistSchema>;
export type MedicalService = z.infer<typeof MedicalServiceSchema>;
export type LifestyleService = z.infer<typeof LifestyleServiceSchema>;
export type ServiceMode = z.infer<typeof ServiceModeSchema>;
export type ServiceIcon = z.infer<typeof ServiceIconSchema>;
export type Tone = z.infer<typeof ToneSchema>;
export type BotConfig = z.infer<typeof BotConfigSchema>;
export type SchedulingConfig = z.infer<typeof SchedulingConfigSchema>;
export type IntakeConfig = z.infer<typeof IntakeConfigSchema>;
export type DesignConfig = z.infer<typeof DesignConfigSchema>;
export type PostConsultaConfig = z.infer<typeof PostConsultaConfigSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type ContactConfig = z.infer<typeof ContactSchema>;
