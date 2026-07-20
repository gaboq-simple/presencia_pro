// ─── barberDay — el día del barbero, CON su propina ───────────────────────────
// Módulo BARBERO-ONLY (Paso 7 del rediseño). Es el ÚNICO read de `appointment_tips`:
// la propina es PRIVADA del dueño/asistente, y el aislamiento es estructural —
// tabla aparte (no columna de appointments, así el Realtime del dueño no la emite)
// + este único read scopeado por staff_id + lint (eslint.config.mjs, allowlist
// barbero) + repo-check (tests/tipsPrivacy.test.ts).
//
// 🔴 NO importar este módulo desde vistas/queries admin, dashboard ni reports.
// Server-only (usa service_role vía getServiceClient) — igual que dashboard.types.ts.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { getStaffDayAppointments, type DashboardAppointment } from '@/lib/dashboard.types';

// El tipo extendido vive ACÁ, no en DashboardAppointment (compartido con las
// vistas del dueño/asistente): fuera del módulo barbero, tipAmount ni siquiera
// existe a nivel de tipos.
export type BarberDayAppointment = DashboardAppointment & {
  /** Propina registrada por el barbero. null = sin registrar; 0 = propina de $0. */
  tipAmount: number | null;
};

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * Citas del día del barbero (delegado a getStaffDayAppointments, que ya fuerza
 * `.eq('staff_id')` server-side y acota el día a la tz del negocio) + la propina
 * por cita. El `.eq('staff_id')` en la query de tips es cinturón doble: aunque un
 * appointment_id ajeno se colara en la lista, jamás se leería la propina de otro.
 */
export async function getBarberDayAppointments(
  businessId: string,
  staffId: string,
  date: string,
  timezone?: string,
): Promise<BarberDayAppointment[]> {
  const appointments = await getStaffDayAppointments(businessId, staffId, date, timezone);
  if (appointments.length === 0) return [];

  const { data, error } = await tenantDb(getServiceClient(), businessId)
    .table('appointment_tips')
    .select('appointment_id, amount')
    .eq('staff_id', staffId)
    .in('appointment_id', appointments.map((a) => a.id));

  if (error) throw new Error(`getBarberDayAppointments tips failed: ${error.message}`);

  // NUMERIC llega como string por PostgREST → Number(). 0 es un monto válido
  // (por eso el lookup es has() y no truthiness).
  const tipByAppointment = new Map<string, number>(
    ((data ?? []) as Array<{ appointment_id: string; amount: string | number }>).map((r) => [
      r.appointment_id,
      Number(r.amount),
    ]),
  );

  return appointments.map((a) => ({
    ...a,
    tipAmount: tipByAppointment.has(a.id) ? (tipByAppointment.get(a.id) as number) : null,
  }));
}
