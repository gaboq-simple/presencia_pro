// ─── Intake Types ─────────────────────────────────────────────────────────────
// Shared domain types for the intake module.
// Consumed by tokens.ts, fields.ts, repository.ts, and client pages.

// ─── IntakeToken ─────────────────────────────────────────────────────────────

/**
 * Decoded payload of a signed intake JWT.
 * The JWT is self-contained — never stored in Supabase.
 */
export type IntakeToken = {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly clientId: string;
  /** 48h from generation OR when signed, whichever comes first. */
  readonly expiresAt: Date;
  /** true after the patient submits — prevents double submission. */
  readonly used: boolean;
};

// ─── IntakeField ──────────────────────────────────────────────────────────────

/**
 * Definition of a single field in the intake form.
 * Used by fields.ts to build the form schema and by client UI to render labels.
 */
export type IntakeField = {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'date' | 'boolean';
  readonly required: boolean;
  /** Alergias, medicamentos — shown with emphasis in the dashboard. */
  readonly sensitive: boolean;
};

// ─── Intake ───────────────────────────────────────────────────────────────────

/**
 * A persisted intake record as returned by the repository.
 */
export type Intake = {
  readonly id: string;
  readonly clientId: string;
  readonly patientId: string;
  readonly appointmentId: string;
  readonly fields: Record<string, unknown>;
  readonly signatureUrl: string | null;
  readonly signedAt: Date | null;
  readonly createdAt: Date;
};
