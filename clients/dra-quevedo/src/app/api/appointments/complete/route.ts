// ─── POST /api/appointments/complete ─────────────────────────────────────────
// Marca una cita como completada. Actualiza last_visit, programa post_consulta
// y review_request, registra evento y notifica al especialista.
// Idempotente: si ya está completed retorna 200.
// Solo accesible con CRON_SECRET.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import {
  completeAppointment,
  getAppointment,
} from '@presenciapro/engine/scheduling';
import type { GoogleCredentials, AppointmentDeps } from '@presenciapro/engine/scheduling';
import { scheduleReminder, sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';
import { buildCompletedAppointmentNotification } from '@/lib/doctor-notifications';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  appointmentId: z.string().uuid(),
  clientId:      z.string().min(1),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const { appointmentId, clientId } = body;

  // Guard: clientId debe coincidir con esta instancia
  if (clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'client mismatch' }, { status: 403 });
  }

  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleSecret   = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefresh  = process.env['GOOGLE_REFRESH_TOKEN'];
  const accountSid     = process.env['WHATSAPP_ACCOUNT_SID'];
  const authToken      = process.env['WHATSAPP_AUTH_TOKEN'];
  const fromNumber     = process.env['WHATSAPP_FROM_NUMBER'];

  if (
    !supabaseUrl || !serviceRoleKey ||
    !googleClientId || !googleSecret || !googleRefresh ||
    !accountSid || !authToken || !fromNumber
  ) {
    return NextResponse.json({ error: 'missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const credentials: GoogleCredentials = {
    clientId: googleClientId,
    clientSecret: googleSecret,
    refreshToken: googleRefresh,
  };
  const deps: AppointmentDeps = { supabase, credentials, config: clientConfig };
  const whatsappCreds: WhatsAppCredentials = { accountSid, authToken, fromNumber };

  // ── Verificar estado actual ────────────────────────────────────────────────
  const appointment = await getAppointment({ appointmentId, clientId }, { supabase });
  if (!appointment) {
    return NextResponse.json({ error: 'appointment not found' }, { status: 404 });
  }

  // Idempotente: ya estaba completada
  if (appointment.status === 'completed') {
    return NextResponse.json({ appointmentId, status: 'completed' });
  }

  // Guard: solo se puede completar una cita confirmada
  if (appointment.status !== 'confirmed') {
    return NextResponse.json(
      { error: `cannot complete appointment with status '${appointment.status}'` },
      { status: 409 },
    );
  }

  // ── 1. Completar cita ──────────────────────────────────────────────────────
  await completeAppointment({ appointmentId, clientId }, deps);

  // ── 2. Actualizar last_visit del paciente ──────────────────────────────────
  if (appointment.patientId) {
    await supabase
      .from('patients')
      .update({ last_visit: new Date().toISOString() })
      .eq('id', appointment.patientId)
      .eq('client_id', clientId);
  }

  // ── Obtener teléfono del paciente ─────────────────────────────────────────
  const { data: patientRow } = await supabase
    .from('patients')
    .select('phone')
    .eq('id', appointment.patientId)
    .single();

  const patientPhone = (patientRow as { phone: string } | null)?.phone ?? null;
  const now = new Date();

  // ── 3. Programar post_consulta (1h después de ends_at) ────────────────────
  if (patientPhone) {
    const postConsultaFor = new Date(appointment.endsAt.getTime() + 60 * 60_000);
    // Guard: solo programar si el momento es futuro
    if (postConsultaFor > now) {
      await scheduleReminder(
        {
          clientId,
          appointmentId,
          patientPhone,
          patientEmail: null,
          type: 'post_consulta',
          channel: 'whatsapp',
          scheduledFor: postConsultaFor,
        },
        supabase,
      );
    }
  }

  // ── 4. Programar review_request solo si reviewUrl no está vacío ───────────
  if (patientPhone && clientConfig.postConsulta.reviewUrl) {
    const reviewFor = new Date(
      appointment.endsAt.getTime() +
        clientConfig.postConsulta.reviewRequestDelayHours * 60 * 60_000,
    );
    // Guard: solo programar si el momento es futuro
    if (reviewFor > now) {
      await scheduleReminder(
        {
          clientId,
          appointmentId,
          patientPhone,
          patientEmail: null,
          type: 'review_request',
          channel: 'whatsapp',
          scheduledFor: reviewFor,
        },
        supabase,
      );
    }
  }

  // ── 5. Registrar evento booking_completed ─────────────────────────────────
  await supabase.from('events').insert({
    client_id:  clientId,
    type:       'booking_completed',
    patient_id: appointment.patientId,
    metadata:   { appointment_id: appointmentId },
  });

  // ── 6. Notificar al especialista ──────────────────────────────────────────
  const specialist = clientConfig.specialists.find(
    (s) => s.id === appointment.specialistId,
  );
  if (specialist?.whatsapp && patientPhone) {
    await sendWhatsApp(
      {
        to: specialist.whatsapp,
        body: buildCompletedAppointmentNotification(
          appointment,
          patientPhone,
          clientConfig,
        ),
      },
      whatsappCreds,
    ).catch(() => { /* fire-and-forget — non-fatal */ });
  }

  return NextResponse.json({ appointmentId, status: 'completed' });
}
