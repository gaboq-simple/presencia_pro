// ─── Staff Server Actions ─────────────────────────────────────────────────────
// Mutaciones de citas desde la vista del barbero.
// Cada acción verifica sesión + rol + pertenencia de la cita antes de mutar.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import type { DayAppointmentForStaff, ServiceRef, CustomerRef } from '@/lib/dashboard.types';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * Actualiza el status de una cita a 'completed' o 'no_show'.
 *
 * Invariantes de seguridad:
 *   - staffId siempre del servidor — de la sesión (PIN/token o Supabase Auth), nunca del cliente.
 *   - Verificación explícita: appointment.staff_id === staff autenticado.
 *   - Solo roles 'barber' y 'assistant' usan esta acción — admin usa actions.ts del dashboard.
 */
export async function updateAppointmentStatusAsBarber(
  appointmentId: string,
  status: 'completed' | 'no_show',
): Promise<void> {
  // 1. Verificar sesión activa — ls_session (PIN) o Supabase Auth (operador).
  //    Soporta al barbero por PIN, que antes quedaba fuera (auth.getUser() null → 401).
  const session = await getCurrentSession();
  if (!session || session.type !== 'business') throw new Error('Unauthorized');
  if (session.role !== 'barber' && session.role !== 'assistant') {
    throw new Error('Forbidden');
  }

  // 2. staffId y businessId de la sesión (server-derivados, nunca del cliente)
  const staffId = session.staff_id;
  if (!staffId) throw new Error('No staff_id en la sesión');
  const businessId = session.business_id;
  const supabase   = getServiceClient();
  const db         = tenantDb(supabase, businessId);

  // 3. Verificar que la cita pertenece al barbero autenticado (y a su negocio)
  const { data: appt, error: apptError } = await db
    .table('appointments')
    .select('id, staff_id')
    .eq('id', appointmentId)
    .maybeSingle();

  if (apptError || !appt) throw new Error('Appointment not found');
  if (appt.staff_id !== staffId) throw new Error('Forbidden');

  // 4. Actualizar — doble filtro: id + staff_id para integridad (business_id lo inyecta el helper).
  //    modified_by_staff_id firma el audit (actor_type='staff' + actor real, no 'unknown').
  const { error } = await db
    .table('appointments')
    .update({ status, modified_by_staff_id: staffId })
    .eq('id', appointmentId)
    .eq('staff_id', staffId);

  if (error) throw new Error(`updateAppointmentStatusAsBarber failed: ${error.message}`);

  revalidatePath('/staff');
}

// ─── getBarberWeekAppointments ────────────────────────────────────────────────
// Retorna todas las citas de un barbero para la semana que contiene anchorDate.
// Soporta ls_session (PIN) y Supabase Auth (operador).
// Retorna un mapa: 'YYYY-MM-DD' → DayAppointmentForStaff[].

type RawWeekRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  service: ServiceRef;
  customer: CustomerRef | null;
};

function toDateStr(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function getBarberWeekAppointments(
  anchorDate: string,  // 'YYYY-MM-DD' — cualquier día de la semana
): Promise<Record<string, DayAppointmentForStaff[]>> {
  // 1. Auth — ls_session (PIN) o Supabase Auth
  const session = await getCurrentSession();
  if (!session) throw new Error('Unauthorized');
  if (session.role !== 'barber') throw new Error('Forbidden');

  const staffId = session.staff_id;
  if (!staffId) throw new Error('No staff_id en la sesión');

  // 2. Calcular rango de la semana (lunes → domingo)
  const anchor = new Date(`${anchorDate}T12:00:00`);
  const day = anchor.getDay(); // 0=dom
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = toDateStr(monday);
  const weekEnd   = toDateStr(sunday);

  // 3. Query — todos los appointments del barbero en esa semana
  const supabase = getServiceClient();

  const { data, error } = await tenantDb(supabase, session.business_id)
    .table('appointments')
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      source,
      notes,
      service:service_id(id, name, duration_minutes, price, currency),
      customer:customer_id(id, name, phone)
    `)
    .eq('staff_id', staffId)
    .gte('starts_at', `${weekStart}T00:00:00`)
    .lte('starts_at', `${weekEnd}T23:59:59`)
    .order('starts_at');

  if (error) throw new Error(`getBarberWeekAppointments failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawWeekRow[];

  // 4. Agrupar por fecha local (YYYY-MM-DD de starts_at)
  const grouped: Record<string, DayAppointmentForStaff[]> = {};

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    grouped[toDateStr(d)] = [];
  }

  for (const row of rows) {
    const dateKey = row.starts_at.slice(0, 10);
    if (dateKey in grouped) {
      (grouped[dateKey] as DayAppointmentForStaff[]).push(
        row as unknown as DayAppointmentForStaff,
      );
    }
  }

  return grouped;
}
