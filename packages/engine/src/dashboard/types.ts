// ─── Dashboard Types ───────────────────────────────────────────────────────────
// Shared types for the dashboard module. These are view-model types — they
// combine data from multiple DB tables into structures ready for rendering.
// They are NOT persistence types (use scheduling/types.ts for those).

import type { Appointment, AppointmentStatus } from '../scheduling/types.js';

// Re-export for consumers who import from this module
export type { Appointment, AppointmentStatus };

// ─── Intake data ───────────────────────────────────────────────────────────────

/**
 * A single rendered field from the intake form.
 * The `label` is the human-readable Spanish label for the field key.
 */
export interface IntakeField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * Complete intake data for a single appointment.
 * `null` means the patient has not filled the intake form yet.
 */
export interface IntakeData {
  readonly id: string;
  readonly fields: readonly IntakeField[];
  readonly signedAt: Date | null;
}

// ─── Appointment view model ────────────────────────────────────────────────────

/**
 * An appointment enriched with patient name and intake data.
 * Produced by the dashboard page's data-fetching layer and passed to DayView.
 */
export interface AppointmentWithPatient {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AppointmentStatus;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly specialistId: string;
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly intakeData: IntakeData | null;
}

// ─── Emergency slot ────────────────────────────────────────────────────────────

/**
 * A slot currently blocked for emergency use.
 * Shown as a top-priority card in the dashboard so the doctor can release it
 * if a real urgent patient arrives.
 */
export interface EmergencySlot {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly specialistId: string;
}

// ─── Patient history (medical profile only) ────────────────────────────────────
// Fetched by getPatientHistory() and rendered in PatientHistoryDrawer.
// intakeData is loaded eagerly in the same query so the drawer can expand
// IntakeViewer inline without a second round-trip.

export interface PatientHistorySummary {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly firstVisit: Date | null;
  readonly totalVisits: number;
  readonly lastVisit: Date | null;
}

export interface PatientHistoryAppointment {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly startsAt: Date;
  readonly status: AppointmentStatus;
  readonly hasIntake: boolean;
  readonly intakeId: string | null;
  /** Pre-loaded intake fields — null if the patient has not filled the form. */
  readonly intakeData: IntakeData | null;
}

export interface PatientHistory {
  readonly patient: PatientHistorySummary;
  readonly appointments: readonly PatientHistoryAppointment[];
}
