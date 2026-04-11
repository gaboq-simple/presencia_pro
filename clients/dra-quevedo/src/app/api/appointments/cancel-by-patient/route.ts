// ─── POST /api/appointments/cancel-by-patient ─────────────────────────────────
// Cancela una cita desde el link firmado del recordatorio 24h.
// Autenticación: JWT de cancelación (INTAKE_SECRET, type='cancel', TTL 24h).
// No requiere CRON_SECRET — es una ruta pública autenticada por JWT.
// Idempotente: si ya está cancelled retorna 200 sin repetir operaciones.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import {
  cancelAppointment,
  getAppointment,
  verifyCancelToken,
} from '@presenciapro/engine/scheduling';
import type { GoogleCredentials, AppointmentDeps } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  token: z.string().min(1),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // ── Verificar y decodificar el JWT de cancelación ─────────────────────────
  const decoded = verifyCancelToken(body.token);
  if (!decoded) {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
  }

  // Guard: el token debe ser para esta instancia
  if (decoded.clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'Token no válido para este cliente' }, { status: 403 });
  }

  const { appointmentId, clientId } = decoded;

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
    return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 });
  }

  // Idempotente: ya estaba cancelada
  if (appointment.status === 'cancelled') {
    return NextResponse.json({ appointmentId, status: 'cancelled' });
  }

  // Guard: solo cancelar citas pendientes o confirmadas
  if (appointment.status !== 'pending' && appointment.status !== 'confirmed') {
    return NextResponse.json(
      { error: `No se puede cancelar una cita con estado: ${appointment.status}` },
      { status: 409 },
    );
  }

  // ── 1. Cancelar en DB + Google Calendar ───────────────────────────────────
  await cancelAppointment({ appointmentId, clientId, reason: 'patient_cancel_link' }, deps);

  // ── 2. Cancelar scheduled_notifications pendientes de esta cita ───────────
  await supabase
    .from('scheduled_notifications')
    .update({
      sent_at: new Date().toISOString(),
      error_message: 'cancelled — appointment cancelled by patient via link',
    })
    .eq('appointment_id', appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── Obtener teléfono del paciente para notificaciones ─────────────────────
  const { data: patientRow } = await supabase
    .from('patients')
    .select('whatsapp_id')
    .eq('id', appointment.patientId)
    .single();

  const patientWhatsappId = (patientRow as { whatsapp_id: string } | null)?.whatsapp_id ?? null;

  // ── 3. Notificar al especialista ──────────────────────────────────────────
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
          `❌ Cita cancelada por paciente\n\n` +
          `Paciente: +${patientWhatsappId ?? appointment.patientId}\n` +
          `Servicio: ${service?.name ?? appointment.serviceId}\n` +
          `Fecha: ${fecha}\n` +
          `Razón: cancelación desde link de recordatorio`,
      },
      whatsappCreds,
    ).catch(() => { /* fire-and-forget — non-fatal */ });
  }

  return NextResponse.json({ appointmentId, status: 'cancelled' });
}
