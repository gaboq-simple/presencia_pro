import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

const ServiceIconSchema = z.enum([
  'sparkles',
  'map-pin',
  'home',
  'syringe',
  'clock',
  'shield',
]);

// ─── Service ──────────────────────────────────────────────────────────────────

const ServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(280),
  duration: z.string().min(1).max(60),
  icon: ServiceIconSchema,
});

// ─── Doctor ───────────────────────────────────────────────────────────────────

const DoctorSchema = z.object({
  name: z.string().min(1),
  specialty: z.string().min(1),
  tagline: z.string().min(1).max(160),
  photo: z.string().refine((v) => v.startsWith('/'), {
    message: 'photo debe ser una ruta relativa que empiece con /',
  }),
  yearsExperience: z.number().int().positive().nullable(),
  credentials: z.array(z.string().min(1)).min(1).max(6),
  location: z.string().min(1),
  /** Modalidades de atención: domicilio, consultorio, o ambas. Max 4. */
  serviceMode: z.array(z.string().min(1)).min(1).max(4),
});

// ─── Contact ──────────────────────────────────────────────────────────────────

const ContactSchema = z.object({
  /** Solo dígitos, sin +, sin espacios. Ej: 5215512345678 */
  whatsapp: z
    .string()
    .regex(/^\d{10,15}$/, 'whatsapp: solo dígitos, sin + ni espacios (10–15 dígitos)'),
  whatsappMessage: z.string().min(1).max(320),
  email: z.union([z.string().email(), z.literal('')]),
  bookingUrl: z.union([z.string().url(), z.literal('')]),
  googleMapsUrl: z.union([z.string().url(), z.literal('')]),
});

// ─── SEO ──────────────────────────────────────────────────────────────────────

const SeoSchema = z.object({
  title: z.string().min(10).max(70),
  description: z.string().min(50).max(160),
  keywords: z.array(z.string().min(1)).min(1).max(10),
});

// ─── Root ─────────────────────────────────────────────────────────────────────

export const ContentSchema = z.object({
  doctor: DoctorSchema,
  contact: ContactSchema,
  /** Máx. 5 servicios por filosofía de diseño */
  services: z.array(ServiceSchema).min(1).max(5),
  seo: SeoSchema,
});

// ─── Exported types ───────────────────────────────────────────────────────────

export type Content = z.infer<typeof ContentSchema>;
export type Doctor = z.infer<typeof DoctorSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceIcon = z.infer<typeof ServiceIconSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type Seo = z.infer<typeof SeoSchema>;
