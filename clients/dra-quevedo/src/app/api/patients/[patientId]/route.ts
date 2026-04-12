// ─── API Route: GET /api/patients/[patientId] ─────────────────────────────────
// Returns the full profile of a single patient for the PatientDrawer.
//
// Auth:    active Supabase Auth session (doctor-facing)
// Returns: PatientProfile — includes status badge, first visit, last 10 appointments

import { createClient } from '@supabase/supabase-js';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';
import type { PatientProfile, AppointmentSummary, AppointmentStatus } from '@presenciapro/engine/dashboard';

// ─── Patient status thresholds (days since last completed visit) ───────────────

const ACTIVE_THRESHOLD_DAYS    = 60;
const AT_RISK_THRESHOLD_DAYS   = 90;

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  // Guard: feature is medical-only
  if (!isMedical(clientConfig)) {
    return json({ error: 'Not available for this profile' }, 403);
  }

  // Guard: required env vars
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // Guard: active doctor session
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { patientId } = await params;
  if (!patientId) {
    return json({ error: 'Missing patientId' }, 400);
  }

  const clientId = clientConfig.client.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Fetch patient — enforce client_id ownership
  const { data: patient, error: patErr } = await supabase
    .from('patients')
    .select('id, whatsapp_id, phone, name, created_at')
    .eq('id', patientId)
    .eq('client_id', clientId)
    .single();

  if (patErr || !patient) {
    return json({ error: 'Patient not found' }, 404);
  }

  // Fetch last 10 appointments (any status except emergency_blocked), ordered newest first
  const { data: appointments, error: apptErr } = await supabase
    .from('appointments')
    .select('id, service_id, service_mode, starts_at, status')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .neq('status', 'emergency_blocked')
    .order('starts_at', { ascending: false })
    .limit(10);

  if (apptErr) {
    return json({ error: apptErr.message }, 500);
  }

  // Build service name map from config
  const serviceNameMap = new Map(clientConfig.services.map((s) => [s.id, s.name]));

  const apptList = appointments ?? [];
  const summaries: AppointmentSummary[] = apptList.map((a) => ({
    id:          a.id as string,
    serviceId:   a.service_id as string,
    serviceName: serviceNameMap.get(a.service_id as string) ?? (a.service_id as string),
    startsAt:    a.starts_at as string,
    mode:        a.service_mode as string,
    status:      a.status as AppointmentStatus,
  }));

  // Derive computed fields
  const completedApts = apptList.filter((a) => a.status === 'completed');
  const lastVisit = completedApts.length > 0 ? (completedApts[0]!.starts_at as string) : null;
  const totalAppointments = completedApts.length;

  // First visit = oldest appointment (any status, non-blocked)
  let firstVisit: string | null = null;
  if (apptList.length > 0) {
    const oldest = [...apptList].sort(
      (a, b) => new Date(a.starts_at as string).getTime() - new Date(b.starts_at as string).getTime(),
    );
    firstVisit = oldest[0]!.starts_at as string;
  }

  // Last completed appointment across all history (not just last 10)
  const { data: allCompleted } = await supabase
    .from('appointments')
    .select('starts_at')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .eq('status', 'completed')
    .order('starts_at', { ascending: false })
    .limit(1);

  const latestCompleted = allCompleted?.[0]?.starts_at as string | undefined;
  const patientStatus = computeStatus(latestCompleted ?? null);

  // Last service shown in the profile header comes from the most recent completed visit
  let lastServiceId: string | null = null;
  let lastServiceName: string | null = null;
  if (completedApts.length > 0) {
    lastServiceId = completedApts[0]!.service_id as string;
    lastServiceName = serviceNameMap.get(lastServiceId) ?? lastServiceId;
  }

  const profile: PatientProfile = {
    id:               patient.id as string,
    whatsappId:       patient.whatsapp_id as string,
    phone:            (patient.phone as string | null) ?? null,
    name:             patient.name as string,
    createdAt:        patient.created_at as string,
    lastServiceId,
    lastServiceName,
    lastVisit:        latestCompleted ?? null,
    totalAppointments,
    status:           patientStatus,
    appointments:     summaries,
    firstVisit,
  };

  return json(profile, 200);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function computeStatus(lastCompletedVisitIso: string | null): 'active' | 'at-risk' | 'inactive' {
  if (!lastCompletedVisitIso) return 'inactive';

  const daysSince = Math.floor(
    (Date.now() - new Date(lastCompletedVisitIso).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysSince <= ACTIVE_THRESHOLD_DAYS) return 'active';
  if (daysSince <= AT_RISK_THRESHOLD_DAYS) return 'at-risk';
  return 'inactive';
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
