// ─── Zod schemas — mutación de servicios ──────────────────────────────────────
// Compartidos por POST /api/services y PATCH /api/services/[id].
// El form del cliente (ServiceForm) espeja estas reglas.

import { z } from 'zod';

// Rango de precio: min y max deben venir juntos (o ninguno) y min <= max.
// Se aplica como superRefine para poder ubicar el error en el campo correcto.
function refinePriceRange(
  data: { price_min?: number | null; price_max?: number | null },
  ctx: z.RefinementCtx,
): void {
  const hasMin = data.price_min != null;
  const hasMax = data.price_max != null;
  if (hasMin !== hasMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El rango de precio requiere mínimo y máximo juntos',
      path: [hasMin ? 'price_max' : 'price_min'],
    });
    return;
  }
  if (hasMin && hasMax && (data.price_min as number) > (data.price_max as number)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El precio mínimo no puede ser mayor que el máximo',
      path: ['price_max'],
    });
  }
}

const NameSchema        = z.string().trim().min(1, 'El nombre es requerido').max(80, 'Máximo 80 caracteres');
const PriceSchema       = z.number({ error: 'Precio inválido' }).min(0, 'El precio no puede ser negativo');
const DurationSchema    = z.number({ error: 'Duración inválida' }).int('La duración debe ser entera').positive('La duración debe ser mayor a 0');
const DescriptionSchema = z.string().trim().max(500, 'Máximo 500 caracteres').nullable().optional();
const PriceBoundSchema  = z.number().min(0, 'No puede ser negativo').nullable().optional();
const PriceNoteSchema   = z.string().trim().max(120, 'Máximo 120 caracteres').nullable().optional();
const CurrencySchema    = z.string().trim().min(1).max(8).optional();

export const ServiceCreateSchema = z
  .object({
    name:             NameSchema,
    price:            PriceSchema,
    duration_minutes: DurationSchema,
    description:      DescriptionSchema,
    price_min:        PriceBoundSchema,
    price_max:        PriceBoundSchema,
    price_note:       PriceNoteSchema,
    currency:         CurrencySchema,
  })
  .superRefine(refinePriceRange);

export const ServiceUpdateSchema = z
  .object({
    name:             NameSchema.optional(),
    price:            PriceSchema.optional(),
    duration_minutes: DurationSchema.optional(),
    description:      DescriptionSchema,
    price_min:        PriceBoundSchema,
    price_max:        PriceBoundSchema,
    price_note:       PriceNoteSchema,
    currency:         CurrencySchema,
    active:           z.boolean().optional(),
  })
  .refine(
    (b) => Object.keys(b).length > 0,
    { message: 'Debe incluir al menos un campo a actualizar' },
  )
  .superRefine(refinePriceRange);

export type ServiceCreateInput = z.infer<typeof ServiceCreateSchema>;
export type ServiceUpdateInput = z.infer<typeof ServiceUpdateSchema>;
