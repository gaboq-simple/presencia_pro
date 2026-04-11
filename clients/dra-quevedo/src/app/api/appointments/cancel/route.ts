// ─── POST /api/appointments/cancel ───────────────────────────────────────────
// Cancela una cita: DB + Google Calendar, notificaciones pendientes, alertas.
// Idempotente: si ya está cancelled retorna 200 sin repetir operaciones.
// Solo accesible con CRON_SECRET — llamado por el bot o por release-expired.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import {
  cancelAppointment,
  getAppointment,
} from '@presenciapro/engine/scheduling';
import type { GoogleCredentials, AppointmentDeps } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  appointmentId: z.string().uuid(),
  clientId: z.string().min(1),
  reason: z.string().optional(),
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

  const { appointmentId, clientId, reason } = body;

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

  // ── Leer cita antes de cancelar ───────────────────────────────────────────
  const appointment = await getAppointment({ appointmentId, clientId }, { supabase });
  if (!appointment) {
    return NextResponse.json({ error: 'appointment not found' }, { status: 404 });
  }

  // Idempotente: ya estaba cancelada
  if (appointment.status === 'cancelled') {
    return NextResponse.json({ appointmentId, status: 'cancelled' });
  }

  // ── 1. Cancelar en DB + Google Calendar ───────────────────────────────────
  await cancelAppointment({ appointmentId, clientId, reason }, deps);

  // ── 2. Cancelar scheduled_notifications pendientes de esta cita ───────────
  await supabase
    .from('scheduled_notifications')
    .update({
      sent_at: new Date().toISOString(),
      error_message: 'cancelled — appointment cancelled',
    })
    .eq('appointment_id', appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── 3. Registrar last_minute_cancellation si aplica ───────────────────────
  // Aplica cuando la razón es confirmation_timeout y la cita era próxima.
  // cancelAppointment() ya registra cancellation_within_window para cancelaciones
  // normales; este evento es específico de timeouts de confirmación.
  const nowMs = Date.now();
  const msUntilAppointment = appointment.startsAt.getTime() - nowMs;
  const windowMs = clientConfig.scheduling.cancellationWindowHours * 60 * 60_000;
  const isLastMinute = msUntilAppointment > 0 && msUntilAppointment < windowMs;

  if (isLastMinute && reason === 'confirmation_timeout') {
    await supabase.from('events').insert({
      client_id: clientId,
      type: 'last_minute_cancellation',
      patient_id: appointment.patientId,
      metadata: {
        appointment_id: appointmentId,
        reason,
        hours_before: Math.round(msUntilAppointment / 3_600_000),
      },
    });
  }

  // ── Obtener teléfono del paciente para notificaciones ─────────────────────
  const { data: patientRow } = await supabase
    .from('patients')
    .select('whatsapp_id')
    .eq('id', appointment.patientId)
    .single();

  const patientWhatsappId = (patientRow as { whatsapp_id: string } | null)?.whatsapp_id ?? null;

  // ── 4. Notificar al paciente ───────────────────────────────────────────────
  if (patientWhatsappId) {
    await sendWhatsApp(
      {
        to: patientWhatsappId,
        body: 'Tu cita ha sido cancelada. Si quieres agendar en otro momento, escríbenos y con gusto te ayudamos.',
      },
      whatsappCreds,
    ).catch(() => { /* fire-and-forget — non-fatal */ });
  }

  // ── 5. Notificar a la doctora ─────────────────────────────────────────────
  const service    = clientConfig.services.find((s) => s.id === appointment.serviceId);
  const specialist = clientConfig.specialists.find((s) => s.id === appointment.specialistId);

  if (specialist?.whatsapp) {
    const fecha = new Intl.DateTimeFormat('es-MX', {
      timeZone: clientConfig.client.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(appointment.startsAt);

    await sendWhatsApp(
      {
        to: specialist.whatsapp,
        body:
          `❌ Cita cancelada\n\n` +
          `Paciente: +${patientWhatsappId ?? appointment.patientId}\n` +
          `Servicio: ${service?.name ?? appointment.serviceId}\n` +
          `Fecha: ${fecha}\n` +
          `Razón: ${reason ?? 'no especificada'}`,
      },
      whatsappCreds,
    ).catch(() => { /* fire-and-forget — non-fatal */ });
  }

  return NextResponse.json({ appointmentId, status: 'cancelled' });
}
