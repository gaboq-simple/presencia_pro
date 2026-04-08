// ─── Dashboard Queries ─────────────────────────────────────────────────────────
// Server-side data fetching for the dashboard module.
// All functions are pure async — no React dependencies, no env var reads.
// Infrastructure (supabase, serviceNameMap) is injected by the API route caller.
//
// Rule: every query includes client_id in WHERE — data never crosses clients.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PatientHistory,
  PatientHistorySummary,
  PatientHistoryAppointment,
  IntakeData,
  IntakeField,
} from './types.js';
import type { AppointmentStatus } from '../scheduling/types.js';

// ─── Internal row types ────────────────────────────────────────────────────────

type PatientRow = {
  id: string;
  name: string;
  phone: string;
};

type AppointmentRow = {
  id: string;
  service_id: string;
  starts_at: string;
  status: string;
  intake_id: string | null;
};

type IntakeRow = {
  id: string;
  appointment_id: string;
  fields: Record<string, unknown>;
  signed_at: string | null;
};

// ─── getPatientHistory ─────────────────────────────────────────────────────────

/**
 * Returns the full history for a single patient: summary stats + all appointments
 * with their intake data pre-loaded.
 *
 * Performs 3 queries:
 *  1. Fetch patient row
 *  2. Fetch all appointments for the patient (newest first)
 *  3. Batch-fetch intakes for appointments that have an intake_id
 *
 * @param serviceNameMap - serviceId → display name, built from clientConfig.services
 *                         by the API route. The engine never imports client.config.
 */
export async function getPatientHistory(params: {
  readonly clientId: string;
  readonly patientId: string;
  readonly serviceNameMap: ReadonlyMap<string, string>;
  readonly supabase: SupabaseClient;
}): Promise<PatientHistory> {
  const { clientId, patientId, serviceNameMap, supabase } = params;

  // ── 1. Patient ───────────────────────────────────────────────────────────────
  const { data: patientData, error: patientError } = await supabase
    .from('patients')
    .select('id, name, phone')
    .eq('client_id', clientId)
    .eq('id', patientId)
    .single();

  if (patientError || !patientData) {
    throw new Error(`Patient not found: ${patientId}`);
  }

  const patientRow = patientData as PatientRow;

  // ── 2. Appointments ──────────────────────────────────────────────────────────
  const { data: apptData, error: apptError } = await supabase
    .from('appointments')
    .select('id, service_id, starts_at, status, intake_id')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .neq('status', 'emergency_blocked')
    .order('starts_at', { ascending: false });

  if (apptError) {
    throw new Error(`Failed to fetch appointments: ${apptError.message}`);
  }

  const apptRows = (apptData ?? []) as AppointmentRow[];

  // ── 3. Intakes (batch) ───────────────────────────────────────────────────────
  const intakeIds = apptRows
    .map((a) => a.intake_id)
    .filter((id): id is string => id !== null);

  const intakeMap = new Map<string, IntakeData>();

  if (intakeIds.length > 0) {
    const { data: intakeData, error: intakeError } = await supabase
      .from('intakes')
      .select('id, appointment_id, fields, signed_at')
      .eq('client_id', clientId)
      .in('id', intakeIds);

    if (intakeError) {
      throw new Error(`Failed to fetch intakes: ${intakeError.message}`);
    }

    for (const row of (intakeData ?? []) as IntakeRow[]) {
      const fields: IntakeField[] = Object.entries(row.fields).map(([key, value]) => ({
        key,
        label: key,        // API route may override with INTAKE_FIELD_LABELS if needed
        value: String(value ?? ''),
      }));

      intakeMap.set(row.appointment_id, {
        id:       row.id,
        fields,
        signedAt: row.signed_at ? new Date(row.signed_at) : null,
      });
    }
  }

  // ── Build patient summary ────────────────────────────────────────────────────
  const completedAppts = apptRows.filter((a) => a.status === 'completed');

  const startsAts = completedAppts.map((a) => new Date(a.starts_at).getTime());

  const summary: PatientHistorySummary = {
    id:          patientRow.id,
    name:        patientRow.name,
    phone:       patientRow.phone,
    totalVisits: completedAppts.length,
    firstVisit:  startsAts.length > 0 ? new Date(Math.min(...startsAts)) : null,
    lastVisit:   startsAts.length > 0 ? new Date(Math.max(...startsAts)) : null,
  };

  // ── Build appointment list ───────────────────────────────────────────────────
  const appointments: PatientHistoryAppointment[] = apptRows.map((a) => {
    const intake = intakeMap.get(a.id) ?? null;
    return {
      id:          a.id,
      serviceId:   a.service_id,
      serviceName: serviceNameMap.get(a.service_id) ?? a.service_id,
      startsAt:    new Date(a.starts_at),
      status:      a.status as AppointmentStatus,
      hasIntake:   a.intake_id !== null,
      intakeId:    a.intake_id,
      intakeData:  intake,
    };
  });

  return { patient: summary, appointments };
}
