// ─── Staff Server Actions ─────────────────────────────────────────────────────
// Mutaciones de citas desde la vista del barbero.
// Cada acción verifica sesión + rol + pertenencia de la cita antes de mutar.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession, getBusinessTimezone } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc } from '@/lib/dayWindow';
import {
  type DayAppointmentForStaff,
  type ServiceRef,
  type CustomerRef,
} from '@/lib/dashboard.types';
import {
  getBarberDayAppointments,
  getBarberWeekTipTotal,
  type BarberDayAppointment,
} from '@/lib/barberDay';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── refreshStaffDayAppointments ──────────────────────────────────────────────
// Recarga las citas del día del BARBERO autenticado (solo las suyas) para el
// polling y el refresh post-mutación del shell. Análogo a
// refreshAssistantAppointments, pero acotado a session.staff_id — nunca devuelve
// citas del negocio que no sean del barbero. Desde el Paso 7 devuelve el modelo
// barbero (con tipAmount) vía getBarberDayAppointments — solo esta ruta lo trae.

export async function refreshStaffDayAppointments(
  date: string,
): Promise<BarberDayAppointment[]> {
  const session = await getCurrentSession();
  if (!session || session.type !== 'business') throw new Error('Unauthorized');
  if (session.role !== 'barber') throw new Error('Forbidden');
  const staffId = session.staff_id;
  if (!staffId) throw new Error('No staff_id en la sesión');

  return getBarberDayAppointments(session.business_id, staffId, date);
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

// ─── setAppointmentTip ────────────────────────────────────────────────────────
// Propina de una cita (Paso 7). PRIVADA del dueño/asistente — ver lib/barberDay.ts
// y la migración 20260720000000_appointment_tips (aislamiento estructural).
// Gate espejo de assertBarberOwnsAppointment (patrón S6-SEC-02): el rechazo
// ESPERADO devuelve { error } (no throw — Next redacta los throw en prod); el bug
// real throwea. Gate: cita del negocio de la sesión + del barbero + status
// 'completed'. "Del día" NO es parte del gate — es de la superficie (la UI solo
// ofrece el día); el dato es del barbero sin importar la fecha.
// tipAmount === null = des-registrar (borra la fila). 0 = propina de $0.
// 🔴 Sin traza en ningún audit admin-legible: el monto no debe aparecer en
// registros que el dueño pueda leer (v1: sin traza alguna).

const MAX_TIP = 99_999_999.99; // techo de NUMERIC(10,2)

export async function setAppointmentTip(
  appointmentId: string,
  tipAmount: number | null,
): Promise<{ error?: string } | void> {
  const session = await getCurrentSession();
  if (!session || session.type !== 'business') throw new Error('Unauthorized');
  if (session.role !== 'barber') throw new Error('Forbidden');
  const staffId = session.staff_id;
  if (!staffId) throw new Error('No staff_id en la sesión');

  if (
    tipAmount !== null &&
    (!Number.isFinite(tipAmount) || tipAmount < 0 || tipAmount > MAX_TIP)
  ) {
    return { error: 'Monto de propina inválido' };
  }

  const db = tenantDb(getServiceClient(), session.business_id);

  const { data: appt, error: apptError } = await db
    .table('appointments')
    .select('id, staff_id, status')
    .eq('id', appointmentId)
    .maybeSingle();

  if (apptError) throw new Error(`setAppointmentTip lookup failed: ${apptError.message}`);
  if (!appt) return { error: 'Cita no encontrada' };
  const row = appt as { id: string; staff_id: string; status: string };
  if (row.staff_id !== staffId) return { error: 'Solo puedes modificar tus propias citas' };
  if (row.status !== 'completed') {
    return { error: 'Solo se registra propina en citas terminadas' };
  }

  if (tipAmount === null) {
    const { error } = await db
      .table('appointment_tips')
      .delete()
      .eq('appointment_id', appointmentId)
      .eq('staff_id', staffId);
    if (error) throw new Error(`setAppointmentTip delete failed: ${error.message}`);
  } else {
    const amount = Math.round(tipAmount * 100) / 100; // centavos exactos, sin ruido float
    const { error } = await db
      .table('appointment_tips')
      .upsert(
        {
          appointment_id: appointmentId,
          staff_id: staffId,
          amount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'appointment_id' },
      );
    if (error) throw new Error(`setAppointmentTip upsert failed: ${error.message}`);
  }

  revalidatePath('/staff');
}

// ─── refreshBarberWeekTipTotal ────────────────────────────────────────────────
// Acumulado semanal de propinas para el bloque "Tus propinas" de Cierre.
// Mismo gate barbero-only que setAppointmentTip: la propina no tiene lectura
// fuera del módulo barbero (dueño/asistente → Forbidden).

export async function refreshBarberWeekTipTotal(anchorDate: string): Promise<number> {
  const session = await getCurrentSession();
  if (!session || session.type !== 'business') throw new Error('Unauthorized');
  if (session.role !== 'barber') throw new Error('Forbidden');
  const staffId = session.staff_id;
  if (!staffId) throw new Error('No staff_id en la sesión');

  const timezone = await getBusinessTimezone(session.business_id);
  return getBarberWeekTipTotal(session.business_id, staffId, anchorDate, timezone);
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

  // 3. Query — todos los appointments del barbero en esa semana.
  // La ventana se acota a la tz del negocio (lunes 00:00 → lunes siguiente 00:00
  // locales), no a UTC. Sin esto, un negocio UTC-6 perdía las citas ≥18:00 locales
  // (caían al día UTC siguiente) y la semana quedaba con huecos falsos.
  const timezone = await getBusinessTimezone(session.business_id);
  const weekStartUtc = localDayRangeUtc(weekStart, timezone).start;   // lunes 00:00 local
  const weekEndUtc   = localDayRangeUtc(weekEnd, timezone).end;       // martes 00:00 local (fin exclusivo del domingo)
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
    .gte('starts_at', weekStartUtc)
    .lt('starts_at', weekEndUtc)
    .order('starts_at');

  if (error) throw new Error(`getBarberWeekAppointments failed: ${error.message}`);

  const rows = (data ?? []) as unknown as RawWeekRow[];

  // 4. Agrupar por fecha LOCAL del negocio (no el slice UTC de starts_at, que metía
  //    una cita de las 19:00 MX en el día siguiente).
  const localDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  const grouped: Record<string, DayAppointmentForStaff[]> = {};

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    grouped[toDateStr(d)] = [];
  }

  for (const row of rows) {
    const dateKey = localDateFmt.format(new Date(row.starts_at)); // 'YYYY-MM-DD' local
    if (dateKey in grouped) {
      (grouped[dateKey] as DayAppointmentForStaff[]).push(
        row as unknown as DayAppointmentForStaff,
      );
    }
  }

  return grouped;
}
