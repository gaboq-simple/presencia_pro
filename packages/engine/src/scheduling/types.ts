// ─── Scheduling Module — Types ─────────────────────────────────────────────────
// All types use readonly fields. Dates are Date objects within the engine.
// ISO 8601 string conversion happens only at Supabase/Google Calendar API
// boundaries — never in internal logic.

import type { ClientConfig } from '../types/client.config.schema';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Google Calendar ───────────────────────────────────────────────────────────

/**
 * OAuth2 credentials for Google Calendar REST API.
 * Read from env vars by the API route caller — the engine never reads env vars.
 */
export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** A busy period returned by Google Calendar FreeBusy API */
export interface BusyPeriod {
  readonly start: string; // ISO 8601 UTC
  readonly end: string;   // ISO 8601 UTC
}

// ─── Slots ─────────────────────────────────────────────────────────────────────

/** An appointment slot */
export interface TimeSlot {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly specialistId: string;
  readonly available: boolean;
}

/** Office hours in local time — derived from BotConfig.officeHours */
export interface OfficeHours {
  readonly start: string;           // HH:MM  e.g. "09:00"
  readonly end: string;             // HH:MM  e.g. "19:00"
  readonly days: readonly number[]; // 0=Sun … 6=Sat
}

/** Slot generation config — derived from SchedulingConfig + service duration */
export interface SlotConfig {
  readonly slotDurationMinutes: number;
  readonly bufferBetweenSlotsMinutes: number;
  readonly advanceBookingDays: number;
}

// ─── Appointments ──────────────────────────────────────────────────────────────

/**
 * Appointment status lifecycle.
 *
 * pending              → created, no patient action required (confirmationRequired = false)
 * pending_confirmation → created with confirmationRequired = true; patient has
 *                        confirmationWindowHours to confirm or slot is auto-released
 * confirmed            → patient confirmed
 * cancelled            → cancelled by patient, system (expired confirmation), or doctor
 * completed            → appointment took place
 * no_show              → doctor marked as no-show after scheduled time passed
 * emergency_blocked    → slot reserved by doctor for emergencies; invisible to patient;
 *                        patientId is null for these records
 */
export type AppointmentStatus =
  | 'pending'
  | 'pending_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'emergency_blocked';

/** Persisted appointment record */
export interface Appointment {
  readonly id: string;
  readonly clientId: string;
  /** UUID FK → patients.id. Null only for emergency_blocked appointments (no patient assigned). */
  readonly patientId: string | null;
  readonly specialistId: string;
  readonly serviceId: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AppointmentStatus;
  readonly googleEventId: string | null;
  /** UUID FK → intakes.id. Set after the patient completes the pre-consultation form. */
  readonly intakeId: string | null;
  readonly createdAt: Date;
}

/** Input for creating a new appointment */
export interface AppointmentRequest {
  readonly clientId: string;
  /** UUID FK → patients.id. The API route resolves phone → UUID before calling createAppointment. */
  readonly patientId: string;
  readonly specialistId: string;
  readonly serviceId: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly startsAt: Date;
}

/** Params for cancelling an appointment */
export interface CancelAppointmentParams {
  readonly appointmentId: string;
  readonly clientId: string;
  readonly reason?: string;
}

// ─── Dependency injection ──────────────────────────────────────────────────────
// The engine never reads env vars. API routes create the Supabase client and
// read Google credentials from env, then pass them as deps.

/** Infrastructure dependencies for appointment operations */
export interface AppointmentDeps {
  readonly supabase: SupabaseClient;
  readonly credentials: GoogleCredentials;
  readonly config: ClientConfig;
}

/** Infrastructure dependencies for emergency slot operations */
export interface EmergencyDeps {
  readonly supabase: SupabaseClient;
  readonly credentials: GoogleCredentials;
  readonly config: ClientConfig;
}

// ─── Public API params ─────────────────────────────────────────────────────────

/** Params for getAvailableSlots — all infrastructure injected, engine never reads env vars */
export interface GetAvailableSlotsParams {
  readonly clientId: string;
  readonly specialistId: string;
  readonly serviceId: string;
  readonly dateRange: { readonly from: Date; readonly to: Date };
  readonly config: ClientConfig;
  readonly credentials: GoogleCredentials;
  readonly supabase: SupabaseClient;
}

// ─── Errors ────────────────────────────────────────────────────────────────────

export class SlotUnavailableError extends Error {
  constructor() {
    super('El horario seleccionado ya no está disponible');
    this.name = 'SlotUnavailableError';
  }
}
