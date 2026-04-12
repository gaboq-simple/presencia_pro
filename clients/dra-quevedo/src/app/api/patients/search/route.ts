// ─── API Route: GET /api/patients/search ──────────────────────────────────────
// Searches patients for the authenticated doctor.
//
// Query params:
//   q  — search string, minimum 2 characters
//
// Search logic:
//   - Letters only → search by name
//   - Digits only  → search by phone AND whatsapp_id
//   - Mixed / free → search all three + appointments.service_id
//
// Auth:    active Supabase Auth session (doctor-facing)
// Returns: PatientSearchResult[]

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';
import type { PatientSearchResult } from '@presenciapro/engine/dashboard';

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
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

  // Guard: valid query
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (q.length < 2) {
    return json({ error: 'El texto de búsqueda debe tener al menos 2 caracteres' }, 400);
  }

  const clientId = clientConfig.client.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Build service name map for enriching results
  const serviceNameMap = new Map<string, string>(
    clientConfig.services.map((s) => [s.id, s.name] as [string, string]),
  );

  try {
    // Raw query — supabase-js doesn't support correlated subqueries, use RPC-style
    // We use a direct Postgres query via .rpc is not available, so we compose manually.
    // Strategy: fetch candidates matching name/phone/whatsapp, then join last appointment.
    const { data: patients, error: pErr } = await supabase
      .from('patients')
      .select('id, whatsapp_id, phone, name, created_at')
      .eq('client_id', clientId)
      .or(
        [
          `name.ilike.%${q}%`,
          `phone.ilike.%${q}%`,
          `whatsapp_id.ilike.%${q}%`,
        ].join(','),
      )
      .limit(20);

    if (pErr) throw new Error(pErr.message);

    if (!patients || patients.length === 0) {
      // Also try matching by service_id via appointments
      const { data: apptPatients, error: apErr } = await supabase
        .from('appointments')
        .select('patient_id')
        .eq('client_id', clientId)
        .ilike('service_id', `%${q}%`)
        .limit(20);

      if (apErr) throw new Error(apErr.message);

      const servicePatientIds = Array.from(
        new Set(
          ((apptPatients ?? []) as Array<{ patient_id: string }>)
            .map((r) => r.patient_id)
            .filter(Boolean),
        ),
      ).slice(0, 6);

      if (servicePatientIds.length === 0) {
        return json([], 200);
      }

      const { data: servicePatients, error: spErr } = await supabase
        .from('patients')
        .select('id, whatsapp_id, phone, name, created_at')
        .eq('client_id', clientId)
        .in('id', servicePatientIds)
        .limit(6);

      if (spErr) throw new Error(spErr.message);

      const enriched = await enrichPatients(
        (servicePatients ?? []) as PatientRow[],
        clientId,
        serviceNameMap,
        supabase,
      );
      return json(enriched, 200);
    }

    // Merge with any service-matched patients not already included
    const namePhoneIds = new Set((patients as PatientRow[]).map((p) => p.id));

    const { data: apptPatients } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('client_id', clientId)
      .ilike('service_id', `%${q}%`)
      .limit(20);

    const extraIds = ((apptPatients ?? []) as Array<{ patient_id: string }>)
      .map((r) => r.patient_id)
      .filter((id) => id && !namePhoneIds.has(id));

    let allPatients: PatientRow[] = patients as PatientRow[];

    if (extraIds.length > 0) {
      const { data: extraPatients } = await supabase
        .from('patients')
        .select('id, whatsapp_id, phone, name, created_at')
        .eq('client_id', clientId)
        .in('id', Array.from(new Set(extraIds)));

      allPatients = [...allPatients, ...((extraPatients ?? []) as PatientRow[])];
    }

    // Take first 6
    const candidates = allPatients.slice(0, 6);
    const enriched = await enrichPatients(candidates, clientId, serviceNameMap, supabase);
    return json(enriched, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

type PatientRow = {
  id: string;
  whatsapp_id: string;
  phone: string | null;
  name: string;
  created_at: string;
};

type ApptRow = {
  patient_id: string;
  service_id: string;
  starts_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichPatients(
  patients: PatientRow[],
  clientId: string,
  serviceNameMap: Map<string, string>,
  supabase: SupabaseClient,
): Promise<PatientSearchResult[]> {
  if (patients.length === 0) return [];

  const patientIds = patients.map((p) => p.id);

  // Fetch last completed appointment per patient + total count
  const { data: rawAppointments } = await supabase
    .from('appointments')
    .select('patient_id, service_id, starts_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .in('patient_id', patientIds)
    .order('starts_at', { ascending: false });

  const appointments = (rawAppointments ?? []) as ApptRow[];

  // Group by patient — first row = last appointment
  const lastApptByPatient = new Map<string, { service_id: string; starts_at: string }>();
  const countByPatient = new Map<string, number>();

  for (const row of appointments) {
    const pid = row.patient_id;
    if (!lastApptByPatient.has(pid)) {
      lastApptByPatient.set(pid, { service_id: row.service_id, starts_at: row.starts_at });
    }
    countByPatient.set(pid, (countByPatient.get(pid) ?? 0) + 1);
  }

  return patients.map((p): PatientSearchResult => {
    const last = lastApptByPatient.get(p.id);
    return {
      id:               p.id,
      whatsappId:       p.whatsapp_id,
      phone:            p.phone,
      name:             p.name,
      createdAt:        p.created_at,
      lastServiceId:    last?.service_id ?? null,
      lastServiceName:  last ? (serviceNameMap.get(last.service_id) ?? last.service_id) : null,
      lastVisit:        last?.starts_at ?? null,
      totalAppointments: countByPatient.get(p.id) ?? 0,
    };
  });
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
