// ─── Seller domain types ──────────────────────────────────────────────────────
// Estos tipos mapean 1:1 con las tablas sellers, leads y commission_payouts.
// Nunca se mutan — todos los campos son readonly.

// ─── Enums as union types ─────────────────────────────────────────────────────

export type LeadStatus =
  | 'lead'
  | 'proposal_sent'
  | 'negotiating'
  | 'deploy_completed'
  | 'lost';

export type CommissionType = 'setup' | 'monthly';

// ─── Core entities ────────────────────────────────────────────────────────────

export interface Seller {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly commission_setup_pct: number;
  readonly commission_monthly_mxn: number;
  readonly commission_monthly_months: number;
  readonly is_operator: boolean;
  readonly active: boolean;
  readonly created_at: string;
}

export interface Lead {
  readonly id: string;
  readonly seller_id: string;
  readonly doctor_name: string;
  readonly doctor_phone: string;
  readonly specialty: string | null;
  readonly city: string;
  readonly notes: string | null;
  readonly status: LeadStatus;
  readonly setup_amount_mxn: number | null;
  readonly client_id: string | null;
  readonly deployed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CommissionPayout {
  readonly id: string;
  readonly seller_id: string;
  readonly lead_id: string;
  readonly type: CommissionType;
  readonly amount_mxn: number;
  readonly period_month: string | null;
  readonly paid_at: string | null;
  readonly paid_by: string | null;
  readonly created_at: string;
}

// ─── Joined views ─────────────────────────────────────────────────────────────

export interface LeadWithSeller extends Lead {
  readonly seller: Pick<Seller, 'id' | 'name' | 'phone'>;
}

export interface PayoutWithLead extends CommissionPayout {
  readonly lead: Pick<Lead, 'doctor_name' | 'client_id'>;
}
