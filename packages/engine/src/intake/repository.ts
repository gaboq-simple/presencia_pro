// ─── Intake Repository ────────────────────────────────────────────────────────
// Persists intake records to Supabase and uploads signature images to Storage.
// All operations include client_id in every query — never mix data between clients.

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyIntakeToken } from './tokens';
import type { Intake } from './types';

// ─── Row shape (from Supabase) ────────────────────────────────────────────────

type IntakeRow = {
  id: string;
  client_id: string;
  patient_id: string;
  appointment_id: string;
  fields: Record<string, unknown>;
  signature_url: string | null;
  signed_at: string | null;
  created_at: string;
};

function rowToIntake(row: IntakeRow): Intake {
  return {
    id: row.id,
    clientId: row.client_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    fields: row.fields,
    signatureUrl: row.signature_url,
    signedAt: row.signed_at ? new Date(row.signed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

// ─── saveIntake ───────────────────────────────────────────────────────────────

/**
 * Verifies the token, uploads the signature (if provided), and inserts an intake
 * record in Supabase. Idempotent: if an intake already exists for the appointment,
 * the existing record is returned without modification.
 *
 * Also updates `appointments.intake_id` to link the appointment to this intake.
 *
 * @throws if the token is invalid or expired
 */
export async function saveIntake(params: {
  token: string;
  fields: Record<string, unknown>;
  signatureDataUrl?: string;
  supabase: SupabaseClient;
}): Promise<Intake> {
  const { token, fields, signatureDataUrl, supabase } = params;

  // Guard: verify token before doing any DB work
  const decoded = verifyIntakeToken(token);
  if (!decoded) {
    throw new Error('Invalid or expired intake token');
  }

  const { appointmentId, patientId, clientId } = decoded;

  // Guard: idempotent — return existing intake if already submitted
  const { data: existing } = await supabase
    .from('intakes')
    .select('id, client_id, patient_id, appointment_id, fields, signature_url, signed_at, created_at')
    .eq('appointment_id', appointmentId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (existing) {
    return rowToIntake(existing as IntakeRow);
  }

  // ── Upload signature if provided ─────────────────────────────────────────
  let signatureUrl: string | null = null;

  if (signatureDataUrl) {
    // Strip the data URL prefix: "data:image/png;base64,..."
    const base64Data = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const storagePath = `${clientId}/${appointmentId}.png`;

    const { error: uploadError } = await supabase.storage
      .from('intake-signatures')
      .upload(storagePath, buffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (!uploadError) {
      signatureUrl = storagePath;
    }
    // Guard: upload errors are non-fatal — intake is saved without signature rather than failing
  }

  // ── Insert intake record ─────────────────────────────────────────────────
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from('intakes')
    .insert({
      client_id: clientId,
      patient_id: patientId,
      appointment_id: appointmentId,
      fields,
      signature_url: signatureUrl,
      signed_at: now,
    })
    .select('id, client_id, patient_id, appointment_id, fields, signature_url, signed_at, created_at')
    .single();

  if (insertError || !inserted) {
    throw new Error(`saveIntake: insert failed — ${insertError?.message ?? 'no data returned'}`);
  }

  const intake = rowToIntake(inserted as IntakeRow);

  // ── Link appointment → intake ────────────────────────────────────────────
  await supabase
    .from('appointments')
    .update({ intake_id: intake.id })
    .eq('id', appointmentId)
    .eq('client_id', clientId);

  return intake;
}

// ─── getIntakeForAppointment ──────────────────────────────────────────────────

/**
 * Retrieves the intake record for a given appointment, or null if not yet submitted.
 */
export async function getIntakeForAppointment(params: {
  appointmentId: string;
  clientId: string;
  supabase: SupabaseClient;
}): Promise<Intake | null> {
  const { appointmentId, clientId, supabase } = params;

  const { data } = await supabase
    .from('intakes')
    .select('id, client_id, patient_id, appointment_id, fields, signature_url, signed_at, created_at')
    .eq('appointment_id', appointmentId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (!data) return null;
  return rowToIntake(data as IntakeRow);
}
