// ─── POST /api/appointments/no-show ──────────────────────────────────────────
// Marca una cita como no_show. Cancela notificaciones pendientes, registra
// evento y notifica al especialista. NO notifica al paciente.
// Idempotente: si ya está no_show retorna 200.
// Solo accesible con CRON_SECRET.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getAppointment } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';
import { buildNoShowNotification } from '@/lib/doctor-notifications';

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
  const accountSid     = process.env['WHATSAPP_ACCOUNT_SID'];
  const authToken      = process.env['WHATSAPP_AUTH_TOKEN'];
  const fromNumber     = process.env['WHATSAPP_FROM_NUMBER'];

  if (!supabaseUrl || !serviceRoleKey || !accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: 'missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const whatsappCreds: WhatsAppCredentials = { accountSid, authToken, fromNumber };

  // ── Verificar estado actual ────────────────────────────────────────────────
  const appointment = await getAppointment({ appointmentId, clientId }, { supabase });
  if (!appointment) {
    return NextResponse.json({ error: 'appointment not found' }, { status: 404 });
  }

  // Idempotente: ya estaba marcado como no_show
  if (appointment.status === 'no_show') {
    return NextResponse.json({ appointmentId, status: 'no_show' });
  }

  // ── 1. Marcar como no_show en DB ──────────────────────────────────────────
  await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', appointmentId)
    .eq('client_id', clientId);

  // ── 2. Cancelar scheduled_notifications pendientes de esta cita ───────────
  await supabase
    .from('scheduled_notifications')
    .update({
      sent_at:       new Date().toISOString(),
      error_message: 'cancelled — appointment no_show',
    })
    .eq('appointment_id', appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── 3. Registrar evento no_show ───────────────────────────────────────────
  await supabase.from('events').insert({
    client_id:  clientId,
    type:       'no_show',
    patient_id: appointment.patientId,
    metadata:   { appointment_id: appointmentId },
  });

  // ── 4. Obtener teléfono del paciente para notificar al especialista ────────
  const { data: patientRow } = await supabase
    .from('patients')
    .select('phone')
    .eq('id', appointment.patientId)
    .single();

  const patientPhone = (patientRow as { phone: string } | null)?.phone ?? null;

  // ── 5. Notificar al especialista (NO al paciente — decisión de la doctora) ─
  const specialist = clientConfig.specialists.find(
    (s) => s.id === appointment.specialistId,
  );
  if (specialist?.whatsapp && patientPhone) {
    await sendWhatsApp(
      {
        to: specialist.whatsapp,
        body: buildNoShowNotification(appointment, patientPhone, clientConfig),
      },
      whatsappCreds,
    ).catch(() => { /* fire-and-forget — non-fatal */ });
  }

  return NextResponse.json({ appointmentId, status: 'no_show' });
}
