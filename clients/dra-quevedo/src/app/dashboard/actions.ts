'use server';

// ─── Dashboard Server Actions ─────────────────────────────────────────────────
// All mutations the doctor can trigger from the dashboard.
// Each action:
//   1. Verifies the user's Supabase session (using cookie-aware client)
//   2. Performs the operation using the service role client (full DB access)
//   3. Revalidates /dashboard so the page re-renders with fresh data
//
// These actions are designed for doctor-initiated interactions, NOT for the
// automated cron pipeline (which uses CRON_SECRET and the existing API routes).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  completeAppointment,
  releaseEmergencySlot,
} from '@presenciapro/engine/scheduling';
import type {
  AppointmentDeps,
  EmergencyDeps,
  GoogleCredentials,
} from '@presenciapro/engine/scheduling';
import { clientConfig } from '@/config/client.config';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Verifies the current user's session. Redirects to /login if unauthenticated. */
async function assertAuthenticated() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
}

/** Creates a service-role Supabase client for data operations. */
function getServiceRoleClient() {
  return createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
}

/** Reads Google Calendar credentials from env. */
function getGoogleCredentials(): GoogleCredentials {
  return {
    clientId:     process.env['GOOGLE_CLIENT_ID']!,
    clientSecret: process.env['GOOGLE_CLIENT_SECRET']!,
    refreshToken: process.env['GOOGLE_REFRESH_TOKEN']!,
  };
}

// ─── completeAppointmentAction ────────────────────────────────────────────────

/**
 * Marks an appointment as completed.
 * Called when the doctor taps "Completar" on an appointment card.
 * Idempotent — safe to call if already completed.
 */
export async function completeAppointmentAction(appointmentId: string): Promise<void> {
  await assertAuthenticated();

  const supabase = getServiceRoleClient();
  const credentials = getGoogleCredentials();
  const deps: AppointmentDeps = { supabase, credentials, config: clientConfig };

  await completeAppointment(
    { appointmentId, clientId: clientConfig.client.id },
    deps,
  );

  // Update last_visit on the patient record
  const { data: appointment } = await supabase
    .from('appointments')
    .select('patient_id, ends_at')
    .eq('id', appointmentId)
    .single();

  if (appointment?.patient_id) {
    await supabase
      .from('patients')
      .update({ last_visit: new Date().toISOString() })
      .eq('id', appointment.patient_id)
      .eq('client_id', clientConfig.client.id);
  }

  revalidatePath('/dashboard');
}

// ─── markNoShowAction ─────────────────────────────────────────────────────────

/**
 * Marks an appointment as no_show.
 * Called when the doctor taps "No asistió" on an appointment card.
 * Also cancels any pending scheduled notifications for this appointment.
 * Idempotent — safe to call if already no_show.
 */
export async function markNoShowAction(appointmentId: string): Promise<void> {
  await assertAuthenticated();

  const supabase = getServiceRoleClient();

  // Guard: verify the appointment belongs to this client
  const { data: existing } = await supabase
    .from('appointments')
    .select('status, patient_id')
    .eq('id', appointmentId)
    .eq('client_id', clientConfig.client.id)
    .single();

  if (!existing) return;
  if (existing.status === 'no_show') {
    revalidatePath('/dashboard');
    return;
  }

  // Mark as no_show
  await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', appointmentId)
    .eq('client_id', clientConfig.client.id);

  // Cancel pending scheduled notifications so the patient doesn't receive them
  await supabase
    .from('scheduled_notifications')
    .update({
      sent_at: new Date().toISOString(),
      error_message: 'cancelled — appointment no_show',
    })
    .eq('appointment_id', appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // Record the event for analytics
  await supabase.from('events').insert({
    client_id:  clientConfig.client.id,
    type:       'no_show',
    patient_id: existing.patient_id,
    metadata:   { appointment_id: appointmentId, source: 'dashboard' },
  });

  revalidatePath('/dashboard');
}

// ─── releaseEmergencySlotAction ───────────────────────────────────────────────

/**
 * Releases an emergency_blocked slot so it becomes available for booking.
 * Deletes the private [BLOQUEADO] Google Calendar event and marks the
 * appointment as pending. Called from the emergency slot card in the dashboard.
 *
 * @param appointmentId — The UUID of the emergency_blocked appointment row.
 */
export async function releaseEmergencySlotAction(appointmentId: string): Promise<void> {
  await assertAuthenticated();

  const supabase = getServiceRoleClient();

  // Look up the appointment to get startsAt + specialistId for the engine call
  const { data } = await supabase
    .from('appointments')
    .select('starts_at, specialist_id, status')
    .eq('id', appointmentId)
    .eq('client_id', clientConfig.client.id)
    .single();

  if (!data || data.status !== 'emergency_blocked') return;

  const credentials = getGoogleCredentials();
  const deps: EmergencyDeps = { supabase, credentials, config: clientConfig };

  await releaseEmergencySlot(
    {
      clientId:     clientConfig.client.id,
      specialistId: data.specialist_id as string,
      startsAt:     new Date(data.starts_at as string),
    },
    deps,
  );

  revalidatePath('/dashboard');
}
