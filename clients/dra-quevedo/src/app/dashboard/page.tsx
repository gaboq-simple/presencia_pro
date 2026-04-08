// ─── Dashboard Page ────────────────────────────────────────────────────────────
// Server Component — fetches all data for today's appointments and renders
// via DashboardShell (Client Component).
//
// Data fetching strategy:
//   1. Today's appointments for the specialist (getAppointmentsForDay)
//   2. Patient names (one query by patient_id IN [...])
//   3. Intake data for appointments that have an intakeId
//   4. The emergency_blocked slot (if any) for today
//   5. Appointment dates for the current month (for BlockedDaysManager highlights)
//
// Uses the service role Supabase client — never the anon key for data reads.
// Auth is guaranteed by middleware + layout.tsx before this page renders.

import { createClient } from '@supabase/supabase-js';
import { getAppointmentsForDay } from '@presenciapro/engine/scheduling';
import type { AppointmentWithPatient, EmergencySlot, IntakeData, IntakeField } from '@presenciapro/engine/dashboard';
import type { Appointment } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import {
  completeAppointmentAction,
  markNoShowAction,
  releaseEmergencySlotAction,
} from './actions';

// ─── Field label map ──────────────────────────────────────────────────────────
// Translates intake field keys (from client.config.intake.fields) to Spanish labels.

const INTAKE_FIELD_LABELS: Record<string, string> = {
  nombre_completo:      'Nombre completo',
  fecha_nacimiento:     'Fecha de nacimiento',
  alergias_conocidas:   'Alergias conocidas',
  medicamentos_actuales:'Medicamentos actuales',
  motivo_consulta:      'Motivo de consulta',
  tratamientos_previos: 'Tratamientos previos',
  datos_facturacion:    'Datos de facturación',
};

// ─── Data fetching helpers ────────────────────────────────────────────────────

function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

/** Returns today's UTC midnight for the client's timezone, so that
 *  getAppointmentsForDay receives the correct day boundary. */
function getTodayUtc(timezone: string): Date {
  const now = new Date();
  // Use Intl to find the local calendar date, then build a UTC midnight for that date.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year  = Number(parts.find((p) => p.type === 'year')?.value ?? now.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? now.getUTCMonth() + 1);
  const day   = Number(parts.find((p) => p.type === 'day')?.value ?? now.getUTCDate());

  return new Date(Date.UTC(year, month - 1, day));
}

/** Resolves intake data for a list of appointments that have an intakeId. */
async function fetchIntakeMap(
  appointmentsWithIntake: readonly Appointment[],
  supabase: ReturnType<typeof getServiceRoleClient>,
  clientId: string,
): Promise<Map<string, IntakeData>> {
  const intakeIds = appointmentsWithIntake
    .map((a) => a.intakeId)
    .filter((id): id is string => id !== null);

  if (intakeIds.length === 0) return new Map();

  const { data } = await supabase
    .from('intakes')
    .select('id, appointment_id, fields, signed_at')
    .eq('client_id', clientId)
    .in('id', intakeIds);

  if (!data) return new Map();

  const map = new Map<string, IntakeData>();

  for (const row of data as {
    id: string;
    appointment_id: string;
    fields: Record<string, unknown>;
    signed_at: string | null;
  }[]) {
    const fields: IntakeField[] = Object.entries(row.fields).map(([key, value]) => ({
      key,
      label: INTAKE_FIELD_LABELS[key] ?? key,
      value: String(value ?? ''),
    }));

    map.set(row.appointment_id, {
      id: row.id,
      fields,
      signedAt: row.signed_at ? new Date(row.signed_at) : null,
    });
  }

  return map;
}

/** Resolves patient names for a set of patient IDs. */
async function fetchPatientNameMap(
  patientIds: readonly string[],
  supabase: ReturnType<typeof getServiceRoleClient>,
  clientId: string,
): Promise<Map<string, string>> {
  if (patientIds.length === 0) return new Map();

  const { data } = await supabase
    .from('patients')
    .select('id, name')
    .eq('client_id', clientId)
    .in('id', patientIds);

  if (!data) return new Map();

  return new Map(
    (data as { id: string; name: string }[]).map((row) => [row.id, row.name]),
  );
}

/** Finds today's emergency_blocked slot (if any) for the specialist. */
async function fetchEmergencySlot(
  supabase: ReturnType<typeof getServiceRoleClient>,
  clientId: string,
  specialistId: string,
  todayUtc: Date,
): Promise<EmergencySlot | null> {
  const dayEnd = new Date(todayUtc.getTime() + 24 * 60 * 60_000);

  const { data } = await supabase
    .from('appointments')
    .select('id, starts_at, ends_at, specialist_id')
    .eq('client_id', clientId)
    .eq('specialist_id', specialistId)
    .eq('status', 'emergency_blocked')
    .gte('starts_at', todayUtc.toISOString())
    .lt('starts_at', dayEnd.toISOString())
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const row = data as { id: string; starts_at: string; ends_at: string; specialist_id: string };
  return {
    id: row.id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    specialistId: row.specialist_id,
  };
}

/** Returns YYYY-MM-DD strings (in client timezone) for all non-emergency
 *  appointments in the current calendar month — used by BlockedDaysManager
 *  to render green highlights. */
async function fetchMonthAppointmentDates(
  supabase: ReturnType<typeof getServiceRoleClient>,
  clientId: string,
  specialistId: string,
  timezone: string,
  referenceDate: Date,
): Promise<readonly string[]> {
  // Build month boundaries in UTC
  const year  = Number(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric' }).format(referenceDate));
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit' }).format(referenceDate));

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, month, 1));     // exclusive upper bound

  const { data } = await supabase
    .from('appointments')
    .select('starts_at')
    .eq('client_id', clientId)
    .eq('specialist_id', specialistId)
    .neq('status', 'cancelled')
    .neq('status', 'emergency_blocked')
    .gte('starts_at', monthStart.toISOString())
    .lt('starts_at', monthEnd.toISOString());

  if (!data) return [];

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  });

  const uniqueDates = new Set(
    (data as { starts_at: string }[]).map((row) => fmt.format(new Date(row.starts_at))),
  );

  return Array.from(uniqueDates);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = getServiceRoleClient();
  const specialist = clientConfig.specialists[0]!;
  const clientId = clientConfig.client.id;
  const timezone = clientConfig.client.timezone;

  const todayUtc = getTodayUtc(timezone);

  // ── Fetch today's appointments ───────────────────────────────────────────
  const rawAppointments = await getAppointmentsForDay(
    { clientId, specialistId: specialist.id, date: todayUtc },
    { supabase },
  );

  // Filter out emergency_blocked from the main list (shown separately)
  const appointments = rawAppointments.filter(
    (a) => a.status !== 'emergency_blocked',
  );

  // ── Resolve patient names ────────────────────────────────────────────────
  const patientIds = [
    ...new Set(
      appointments
        .map((a) => a.patientId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const patientNameMap = await fetchPatientNameMap(patientIds, supabase, clientId);

  // ── Resolve intake data ──────────────────────────────────────────────────
  const appointmentsWithIntake = appointments.filter((a) => a.intakeId !== null);
  const intakeMap = await fetchIntakeMap(appointmentsWithIntake, supabase, clientId);

  // ── Resolve service names ────────────────────────────────────────────────
  const serviceNameMap = new Map(
    clientConfig.services.map((s) => [s.id, s.name]),
  );

  // ── Build view models ────────────────────────────────────────────────────
  const viewAppointments: AppointmentWithPatient[] = appointments.map((a) => ({
    id:          a.id,
    startsAt:    a.startsAt,
    endsAt:      a.endsAt,
    status:      a.status,
    serviceId:   a.serviceId,
    serviceName: serviceNameMap.get(a.serviceId) ?? a.serviceId,
    serviceMode: a.serviceMode,
    specialistId: a.specialistId,
    patientId:   a.patientId,
    patientName: a.patientId ? (patientNameMap.get(a.patientId) ?? null) : null,
    intakeData:  a.id ? (intakeMap.get(a.id) ?? null) : null,
  }));

  // Sort chronologically
  viewAppointments.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // ── Fetch emergency slot ─────────────────────────────────────────────────
  const emergencySlot = await fetchEmergencySlot(
    supabase,
    clientId,
    specialist.id,
    todayUtc,
  );

  // ── Fetch current-month appointment dates (for BlockedDaysManager) ───────
  const appointmentDates = await fetchMonthAppointmentDates(
    supabase,
    clientId,
    specialist.id,
    timezone,
    todayUtc,
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <DashboardShell
      appointments={viewAppointments}
      emergencySlot={emergencySlot}
      date={todayUtc}
      timezone={timezone}
      onComplete={completeAppointmentAction}
      onNoShow={markNoShowAction}
      onReleaseEmergency={releaseEmergencySlotAction}
      specialistId={specialist.id}
      appointmentDates={appointmentDates}
    />
  );
}
