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
  MonthlyMetrics,
  ServiceCount,
} from './types';
import type { AppointmentStatus } from '../scheduling/types';

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

// ─── getMonthlyMetrics ─────────────────────────────────────────────────────────

// ─── Internal row types ────────────────────────────────────────────────────────

type AppointmentSummaryRow = {
  id: string;
  patient_id: string | null;
  service_id: string;
  status: string;
};

type PriorPatientRow = {
  patient_id: string;
};

/**
 * Calcula las métricas del mes `year/month` para el reporte mensual automático.
 *
 * Realiza 3 queries:
 *  1. Todas las citas del mes (excluyendo emergency_blocked)
 *  2. Citas completadas del mes anterior (para comparativo)
 *  3. Citas previas al mes para los pacientes únicos del mes actual (nuevo vs recurrente)
 *
 * @param serviceNameMap - serviceId → nombre del servicio, construido por el API Route
 *                         desde clientConfig.services. El engine nunca importa client.config.
 */
export async function getMonthlyMetrics(params: {
  readonly clientId: string;
  /** Año del reporte (ej: 2026) */
  readonly year: number;
  /** Mes del reporte: 1 = enero … 12 = diciembre */
  readonly month: number;
  readonly serviceNameMap: ReadonlyMap<string, string>;
  readonly supabase: SupabaseClient;
}): Promise<MonthlyMetrics> {
  const { clientId, year, month, serviceNameMap, supabase } = params;

  // ── Date ranges ──────────────────────────────────────────────────────────────
  const monthStart    = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd      = new Date(Date.UTC(year, month, 1));        // exclusive upper bound
  const prevMonth     = month === 1 ? 12 : month - 1;
  const prevYear      = month === 1 ? year - 1 : year;
  const prevMonthStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
  const prevMonthEnd  = monthStart;                                // exclusive upper bound

  const monthStartISO     = monthStart.toISOString();
  const monthEndISO       = monthEnd.toISOString();
  const prevMonthStartISO = prevMonthStart.toISOString();
  const prevMonthEndISO   = prevMonthEnd.toISOString();

  // ── 1. Current month appointments ────────────────────────────────────────────
  const { data: currentData, error: currentError } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, status')
    .eq('client_id', clientId)
    .neq('status', 'emergency_blocked')
    .gte('starts_at', monthStartISO)
    .lt('starts_at', monthEndISO);

  if (currentError) {
    throw new Error(`getMonthlyMetrics: failed to fetch current month — ${currentError.message}`);
  }

  const currentRows = (currentData ?? []) as AppointmentSummaryRow[];
  const completedRows = currentRows.filter((r) => r.status === 'completed');
  const noShowRows    = currentRows.filter((r) => r.status === 'no_show');

  const completed      = completedRows.length;
  const totalScheduled = currentRows.length;
  const noShows        = noShowRows.length;
  const noShowRate     = totalScheduled > 0 ? noShows / totalScheduled : 0;

  // ── 2. Previous month completed (comparativo) ─────────────────────────────────
  const { data: prevData, error: prevError } = await supabase
    .from('appointments')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gte('starts_at', prevMonthStartISO)
    .lt('starts_at', prevMonthEndISO);

  if (prevError) {
    throw new Error(`getMonthlyMetrics: failed to fetch previous month — ${prevError.message}`);
  }

  const previousCompleted = (prevData ?? []).length;
  const completedDelta    = completed - previousCompleted;
  const completedDeltaPct =
    previousCompleted > 0 ? Math.round((completedDelta / previousCompleted) * 100) : 0;

  // ── Top services ──────────────────────────────────────────────────────────────
  const serviceCountMap = new Map<string, number>();
  for (const row of completedRows) {
    serviceCountMap.set(row.service_id, (serviceCountMap.get(row.service_id) ?? 0) + 1);
  }

  const topServices: ServiceCount[] = Array.from(serviceCountMap.entries())
    .map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceNameMap.get(serviceId) ?? serviceId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // ── New vs returning patients ──────────────────────────────────────────────────
  const patientIds = completedRows
    .map((r) => r.patient_id)
    .filter((id): id is string => id !== null);

  let newPatients = 0;
  let returningPatients = 0;

  if (patientIds.length > 0) {
    const uniquePatientIds = Array.from(new Set(patientIds));

    // Guard: find patients who had any prior appointment before this month
    const { data: priorData, error: priorError } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('client_id', clientId)
      .in('patient_id', uniquePatientIds)
      .lt('starts_at', monthStartISO)
      .neq('status', 'emergency_blocked');

    if (priorError) {
      throw new Error(`getMonthlyMetrics: failed to fetch prior appointments — ${priorError.message}`);
    }

    const priorPatientSet = new Set(
      ((priorData ?? []) as PriorPatientRow[]).map((r) => r.patient_id),
    );

    for (const pid of uniquePatientIds) {
      if (priorPatientSet.has(pid)) {
        returningPatients++;
      } else {
        newPatients++;
      }
    }
  }

  return {
    clientId,
    year,
    month,
    completed,
    totalScheduled,
    noShows,
    noShowRate,
    topServices,
    newPatients,
    returningPatients,
    previousCompleted,
    completedDelta,
    completedDeltaPct,
  };
}
