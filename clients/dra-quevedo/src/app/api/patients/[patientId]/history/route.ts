// ─── API Route: GET /api/patients/[patientId]/history ──────────────────────────
// Returns the full appointment history for a single patient.
// Exclusive to the `medical` profile — guarded by isMedical().
//
// Auth:    active Supabase Auth session (doctor-facing).
// Returns: PatientHistory with Dates serialized as ISO strings.

import { createClient } from '@supabase/supabase-js';
import { getPatientHistory } from '@presenciapro/engine/dashboard';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';

// ─── Intake field label map ────────────────────────────────────────────────────
// Mirrors the map in dashboard/page.tsx — translates field keys to Spanish labels.

const INTAKE_FIELD_LABELS: Record<string, string> = {
  nombre_completo:       'Nombre completo',
  fecha_nacimiento:      'Fecha de nacimiento',
  alergias_conocidas:    'Alergias conocidas',
  medicamentos_actuales: 'Medicamentos actuales',
  motivo_consulta:       'Motivo de consulta',
  tratamientos_previos:  'Tratamientos previos',
  datos_facturacion:     'Datos de facturación',
};

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

  // Build serviceNameMap from clientConfig — engine never reads config directly
  const serviceNameMap = new Map(
    clientConfig.services.map((s) => [s.id, s.name]),
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let history;
  try {
    history = await getPatientHistory({
      clientId:      clientConfig.client.id,
      patientId,
      serviceNameMap,
      supabase,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Patient not found → 404, other errors → 500
    const status = message.includes('not found') ? 404 : 500;
    return json({ error: message }, status);
  }

  // ── Apply Spanish labels to intake fields ────────────────────────────────────
  const labeledHistory = {
    patient: {
      ...history.patient,
      firstVisit: history.patient.firstVisit?.toISOString() ?? null,
      lastVisit:  history.patient.lastVisit?.toISOString() ?? null,
    },
    appointments: history.appointments.map((a) => ({
      ...a,
      startsAt: a.startsAt.toISOString(),
      intakeData: a.intakeData
        ? {
            ...a.intakeData,
            signedAt: a.intakeData.signedAt?.toISOString() ?? null,
            fields: a.intakeData.fields.map((f) => ({
              ...f,
              label: INTAKE_FIELD_LABELS[f.key] ?? f.key,
            })),
          }
        : null,
    })),
  };

  return json(labeledHistory, 200);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
