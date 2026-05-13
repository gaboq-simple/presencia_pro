// ─── Assistant Server Actions ──────────────────────────────────────────────────
// Mutaciones y fetches de citas desde la vista del asistente.
// Requieren sesión con role='assistant' | 'owner' | 'admin'.
//
// REGLA: service_role_key y getCurrentSession nunca salen al cliente.

'use server';

import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { getDayAppointments } from '@/lib/dashboard.types';
import type { DashboardAppointment } from '@/lib/dashboard.types';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Helper de autorización ───────────────────────────────────────────────────

/**
 * Verifica sesión de asistente/owner/admin sobre una sucursal individual.
 * Las sesiones de organización no aplican a la vista staff — el owner
 * accede a cada sucursal con el token de esa sucursal.
 */
async function requireAssistantSession(): Promise<{ business_id: string; role: string }> {
  const session = await getCurrentSession();
  if (!session) throw new Error('Unauthorized');
  if (session.role === 'barber') throw new Error('Forbidden');
  if (session.type === 'organization') throw new Error('Forbidden');
  return { business_id: session.business_id, role: session.role };
}

// ─── Refresh — todas las citas del negocio para un día ───────────────────────

/**
 * Recarga las citas del negocio para el día dado.
 * Llamado desde AssistantLayout para polling periódico y post-mutación.
 */
export async function refreshAssistantAppointments(
  date: string,
): Promise<DashboardAppointment[]> {
  const session = await requireAssistantSession();
  return getDayAppointments(session.business_id, date);
}

// ─── Cancelar cita con razón ──────────────────────────────────────────────────

/**
 * Cancela una cita y opcionalmente guarda la razón en notes.
 * Verifica que la cita pertenece al negocio de la sesión activa.
 */
export async function cancelAppointment(
  appointmentId: string,
  reason: string,
): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // Verificar que la cita pertenece al negocio
  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
  if (existing.status === 'cancelled') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      notes: reason.trim() || null,
    })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`cancelAppointment failed: ${error.message}`);
}

// ─── Actualizar notas inline ──────────────────────────────────────────────────

/**
 * Guarda las notas operativas de una cita.
 * Verifica que la cita pertenece al negocio de la sesión activa.
 */
export async function updateAppointmentNotes(
  appointmentId: string,
  notes: string,
): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { error } = await supabase
    .from('appointments')
    .update({ notes: notes.trim() || null })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`updateAppointmentNotes failed: ${error.message}`);
}

// ─── Completar cita ───────────────────────────────────────────────────────────

/**
 * Marca una cita como completada.
 * Verifica que la cita pertenece al negocio de la sesión activa.
 */
export async function completeAppointment(appointmentId: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
  if (existing.status === 'completed') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'completed' })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`completeAppointment failed: ${error.message}`);
}

// ─── Registrar no-show ────────────────────────────────────────────────────────

/**
 * Marca una cita como no asistida (no-show).
 * Verifica que la cita pertenece al negocio de la sesión activa.
 */
export async function noShowAppointment(appointmentId: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
  if (existing.status === 'no_show') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`noShowAppointment failed: ${error.message}`);
}

// ─── Crear cita rápida ────────────────────────────────────────────────────────

type CreateAppointmentInput = {
  staffId:   string;
  serviceId: string;
  startsAt:  string;  // ISO 8601 con offset
  endsAt:    string;  // ISO 8601 con offset
  source:    'walkin' | 'llamada' | 'manual';
  notes?:    string;
};

/**
 * Crea una nueva cita desde la vista del asistente.
 * business_id siempre del servidor — nunca del cliente.
 */
export async function createAssistantAppointment(
  input: CreateAppointmentInput,
): Promise<{ id: string }> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      business_id: session.business_id,
      staff_id:    input.staffId,
      service_id:  input.serviceId,
      customer_id: null,
      starts_at:   input.startsAt,
      ends_at:     input.endsAt,
      status:      'confirmed',  // asistente crea citas directamente como confirmadas
      source:      input.source,
      notes:       input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`createAssistantAppointment failed: ${error.message}`);

  return { id: (data as { id: string }).id };
}
