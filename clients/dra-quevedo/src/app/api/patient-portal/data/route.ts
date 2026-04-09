// ─── GET /api/patient-portal/data ─────────────────────────────────────────────
// Retorna los datos del portal del paciente: próxima cita, historial e intakes.
// Autenticación: JWT de portal del paciente (type='patient-portal', TTL 7 días).
//
// El token puede enviarse como:
//   - Header: Authorization: Bearer {token}
//   - Query param: ?token={token}
//
// SEGURIDAD CRÍTICA:
// - clientId del token debe coincidir con NEXT_PUBLIC_CLIENT_ID antes de cualquier query
// - Nunca se loguean campos de intake (contienen datos médicos)
// - Nunca se exponen datos de otros pacientes ni de otros clientes

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyPatientPortalToken } from '@presenciapro/engine/portal';
import { generateCancelToken } from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';
import type { AppointmentStatus } from '@presenciapro/engine/scheduling';

// ─── Response types ───────────────────────────────────────────────────────────

type NextAppointmentData = {
  readonly id: string;
  readonly startsAt: string;   // ISO 8601
  readonly endsAt: string;     // ISO 8601
  readonly serviceId: string;
  readonly serviceName: string;
  readonly serviceMode: 'domicilio' | 'consultorio';
  readonly status: AppointmentStatus;
  /** JWT de cancelación — null si la cita no es cancelable por el paciente ahora */
  readonly cancelToken: string | null;
};

type PastAppointmentData = {
  readonly id: string;
  readonly startsAt: string;   // ISO 8601
  readonly serviceId: string;
  readonly serviceName: string;
  readonly status: 'completed' | 'cancelled' | 'no_show';
};

type IntakeData = {
  readonly id: string;
  readonly appointmentId: string;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly fields: Record<string, unknown>;
  readonly createdAt: string;  // ISO 8601
};

type PortalDataResponse = {
  readonly nextAppointment: NextAppointmentData | null;
  readonly pastAppointments: readonly PastAppointmentData[];
  readonly intakes: readonly IntakeData[];
};

// ─── DB row types ─────────────────────────────────────────────────────────────

type AppointmentRow = {
  id: string;
  patient_id: string;
  service_id: string;
  service_mode: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
};

type IntakeRow = {
  id: string;
  appointment_id: string;
  fields: Record<string, unknown>;
  created_at: string;
};

type AppointmentServiceRow = {
  service_id: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCancellableNow(startsAt: Date, status: AppointmentStatus): boolean {
  if (status !== 'pending' && status !== 'confirmed') return false;
  const windowMs = clientConfig.scheduling.cancellationWindowHours * 60 * 60 * 1_000;
  return startsAt.getTime() - Date.now() > windowMs;
}

function resolveServiceName(serviceId: string): string {
  return clientConfig.services.find((s) => s.id === serviceId)?.name ?? serviceId;
}

function extractToken(request: Request): string | null {
  // Try Authorization: Bearer {token}
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  // Try ?token= query param
  const url = new URL(request.url);
  const t = url.searchParams.get('token');
  return t ?? null;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // ── Extraer y verificar token ──────────────────────────────────────────────
  const rawToken = extractToken(request);
  if (!rawToken) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 401 });
  }

  const decoded = verifyPatientPortalToken(rawToken);
  if (!decoded) {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
  }

  // Guard: el token debe ser para esta instancia de cliente
  if (decoded.clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'Token no válido para este cliente' }, { status: 403 });
  }

  const { patientId, clientId } = decoded;

  // Guard: variables de entorno requeridas
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();

  // ── Próxima cita (no cancelada/completada/no_show, starts_at en el futuro) ─
  const { data: nextRows } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, service_mode, starts_at, ends_at, status')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .not('status', 'in', '("cancelled","no_show","completed","emergency_blocked")')
    .gt('starts_at', now)
    .order('starts_at', { ascending: true })
    .limit(1)
    .returns<AppointmentRow[]>();

  const nextRow = (nextRows ?? [])[0] ?? null;

  let nextAppointment: NextAppointmentData | null = null;
  if (nextRow) {
    const startsAt = new Date(nextRow.starts_at);
    const cancellable = isCancellableNow(startsAt, nextRow.status);
    const cancelToken = cancellable
      ? generateCancelToken({
          appointmentId: nextRow.id,
          patientId,
          clientId,
        })
      : null;

    nextAppointment = {
      id: nextRow.id,
      startsAt: nextRow.starts_at,
      endsAt: nextRow.ends_at,
      serviceId: nextRow.service_id,
      serviceName: resolveServiceName(nextRow.service_id),
      serviceMode: nextRow.service_mode as 'domicilio' | 'consultorio',
      status: nextRow.status,
      cancelToken,
    };
  }

  // ── Historial de citas (últimas 5 completadas/canceladas/no_show) ──────────
  const { data: pastRows } = await supabase
    .from('appointments')
    .select('id, patient_id, service_id, service_mode, starts_at, ends_at, status')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .in('status', ['completed', 'cancelled', 'no_show'])
    .order('starts_at', { ascending: false })
    .limit(5)
    .returns<AppointmentRow[]>();

  const pastAppointments: readonly PastAppointmentData[] = (pastRows ?? []).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    serviceId: row.service_id,
    serviceName: resolveServiceName(row.service_id),
    status: row.status as 'completed' | 'cancelled' | 'no_show',
  }));

  // ── Intakes completados del paciente ──────────────────────────────────────
  // Los campos de intake contienen datos médicos — nunca se loguean
  const { data: intakeRows } = await supabase
    .from('intakes')
    .select('id, appointment_id, fields, created_at')
    .eq('client_id', clientId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .returns<IntakeRow[]>();

  // Resolver serviceId de cada intake desde su cita asociada
  const intakeAppointmentIds = (intakeRows ?? []).map((i) => i.appointment_id);

  let appointmentServiceMap: Record<string, string> = {};
  if (intakeAppointmentIds.length > 0) {
    const { data: apptRows } = await supabase
      .from('appointments')
      .select('id, service_id')
      .eq('client_id', clientId)
      .in('id', intakeAppointmentIds)
      .returns<(AppointmentServiceRow & { id: string })[]>();

    appointmentServiceMap = Object.fromEntries(
      (apptRows ?? []).map((a) => [a.id, a.service_id ?? '']),
    );
  }

  const intakes: readonly IntakeData[] = (intakeRows ?? []).map((row) => {
    const serviceId = appointmentServiceMap[row.appointment_id] ?? null;
    return {
      id: row.id,
      appointmentId: row.appointment_id,
      serviceId,
      serviceName: serviceId ? resolveServiceName(serviceId) : null,
      fields: row.fields,
      createdAt: row.created_at,
    };
  });

  const response: PortalDataResponse = {
    nextAppointment,
    pastAppointments,
    intakes,
  };

  return NextResponse.json(response);
}
