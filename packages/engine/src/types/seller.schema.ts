// ─── Seller Zod schemas ───────────────────────────────────────────────────────
// Validación de inputs en la frontera del sistema (CLI, API routes).
// Los tipos inferidos se exportan junto con los schemas.

import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const LeadStatusSchema = z.enum([
  'lead',
  'proposal_sent',
  'negotiating',
  'deploy_completed',
  'lost',
]);

export const CreateLeadSchema = z.object({
  doctor_name:  z.string().min(2).max(120),
  doctor_phone: z.string().min(8).max(20),
  city:         z.string().min(2).max(80),
  specialty:    z.string().max(80).optional(),
  notes:        z.string().max(500).optional(),
});

export const UpdateLeadStatusSchema = z.object({
  status: LeadStatusSchema,
});

export const DeployLeadSchema = z.object({
  setup_amount_mxn: z.number().positive(),
  client_id:        z.string().min(2).max(80),
});

export const CreateSellerSchema = z.object({
  name:                      z.string().min(2).max(120),
  phone:                     z.string().min(8).max(20),
  email:                     z.string().email(),
  commission_setup_pct:      z.number().min(0).max(100).default(20),
  commission_monthly_mxn:    z.number().min(0).default(120),
  commission_monthly_months: z.number().int().min(0).max(24).default(6),
  is_operator:               z.boolean().default(false),
});

// ─── Inferred input types ─────────────────────────────────────────────────────

export type CreateLeadInput   = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadStatus  = z.infer<typeof UpdateLeadStatusSchema>;
export type DeployLeadInput   = z.infer<typeof DeployLeadSchema>;
export type CreateSellerInput = z.infer<typeof CreateSellerSchema>;
