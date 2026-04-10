// ─── GET /api/appointments/week ────────────────────────────────────────────────
// Returns all appointments for a date range (one week) with patient names.
//
// Query params:
//   from=YYYY-MM-DD  — first day of the range (Monday), interpreted as UTC midnight
//   to=YYYY-MM-DD    — exclusive upper bound (next Monday), interpreted as UTC midnight
//
// Auth: Supabase session cookie (same pattern as cancel-by-doctor and reschedule).
// Guard: client_id must match this instance's config — never expose cross-client data.
//
// Response: JSON array of AppointmentWithPatient (Dates serialized as ISO strings).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { clientConfig } from '@/config/client.config';
import type { AppointmentStatus } from '@presenciapro/engine/dashboard';

// ─── Response type ────────────────────────────────────────────────────────────
// Plain serializable shape — Dates as ISO strings, no intakeData (not needed in WeekView).

type WeekAppointmentResponse = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly specialistId: string;
  readonly patientId: string | null;
  readonly patientName: string | null;
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  clientId: z.string().min(1),
});

// ─── DB row type ──────────────────────────────────────────────────────────────

interface AppointmentRow {
  id: string;
  client_id: string;
  patient_id: string | null;
  specialist_id: string;
  service_id: string;
  service_mode: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

interface PatientRow {
  id: string;
  name: string;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // ── Verificar sesión del médico ───────────────────────────────────────────
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // ── Validar query params ──────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const rawParams = {
    from:     searchParams.get('from') ?? '',
    to:       searchParams.get('to') ?? '',
    clientId: searchParams.get('clientId') ?? '',
  };

  let params: z.infer<typeof QuerySchema>;
  try {
    params = QuerySchema.parse(rawParams);
  } catch {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
  }

  const { from, to, clientId } = params;

  // Guard: clientId debe coincidir con esta instancia
  if (clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'client mismatch' }, { status: 403 });
  }

  // ── Convertir YYYY-MM-DD a UTC midnight boundaries ────────────────────────
  // Pattern mirrors getTodayUtc in dashboard/page.tsx: parse as UTC midnight.
  const fromUtc = new Date(`${from}T00:00:00.000Z`);
  const toUtc   = new Date(`${to}T00:00:00.000Z`);

  if (isNaN(fromUtc.getTime()) || isNaN(toUtc.getTime())) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 });
  }

  if (toUtc.getTime() <= fromUtc.getTime()) {
    return NextResponse.json({ error: 'to debe ser posterior a from' }, { status: 400 });
  }

  // ── Env vars ─────────────────────────────────────────────────────────────
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Configuración de servidor incompleta' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const specialist = clientConfig.specialists[0]!;

  // ── Fetch appointments in range ───────────────────────────────────────────
  // Uses starts_at boundaries (same approach as getAppointmentsForDay).
  // Excludes emergency_blocked — never shown in the doctor's week grid.
  const { data: apptRows, error: apptError } = await supabase
    .from('appointments')
    .select('id, client_id, patient_id, specialist_id, service_id, service_mode, starts_at, ends_at, status')
    .eq('client_id', clientId)
    .eq('specialist_id', specialist.id)
    .neq('status', 'emergency_blocked')
    .gte('starts_at', fromUtc.toISOString())
    .lt('starts_at', toUtc.toISOString())
    .order('starts_at');

  if (apptError) {
    return NextResponse.json({ error: 'Error al obtener las citas' }, { status: 500 });
  }

  const appointments = (apptRows ?? []) as AppointmentRow[];

  // ── Fetch patient names ───────────────────────────────────────────────────
  const patientIds = [
    ...new Set(
      appointments
        .map((a) => a.patient_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const patientNameMap = new Map<string, string>();

  if (patientIds.length > 0) {
    const { data: patientRows } = await supabase
      .from('patients')
      .select('id, name')
      .eq('client_id', clientId)
      .in('id', patientIds);

    for (const row of (patientRows ?? []) as PatientRow[]) {
      patientNameMap.set(row.id, row.name);
    }
  }

  // ── Resolve service names from config ─────────────────────────────────────
  const serviceNameMap = new Map(
    clientConfig.services.map((s) => [s.id, s.name]),
  );

  // ── Build response ────────────────────────────────────────────────────────
  // Dates serialized as ISO strings — the client component parses them with new Date().
  const result: WeekAppointmentResponse[] = appointments.map((a) => ({
    id:          a.id,
    startsAt:    a.starts_at,
    endsAt:      a.ends_at,
    status:      a.status as AppointmentStatus,
    serviceId:   a.service_id,
    serviceName: serviceNameMap.get(a.service_id) ?? a.service_id,
    serviceMode: a.service_mode as 'domicilio' | 'consultorio',
    specialistId: a.specialist_id,
    patientId:   a.patient_id,
    patientName: a.patient_id ? (patientNameMap.get(a.patient_id) ?? null) : null,
  }));

  return NextResponse.json(result);
}
