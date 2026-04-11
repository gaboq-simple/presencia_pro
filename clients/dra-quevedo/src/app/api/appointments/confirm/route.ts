// ─── POST /api/appointments/confirm ──────────────────────────────────────────
// Transiciona una cita de pending_confirmation → confirmed.
// Idempotente: si ya está confirmed retorna 200. Si está cancelled retorna 409.
// Después de confirmar, programa los recordatorios definidos en reminderSchedule.
// Solo accesible con CRON_SECRET — llamado por el bot vía fetch() interno.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import {
  confirmAppointment,
  getAppointment,
  generateCancelUrl,
} from '@presenciapro/engine/scheduling';
import type { GoogleCredentials, AppointmentDeps } from '@presenciapro/engine/scheduling';
import { scheduleReminder } from '@presenciapro/engine/notifications';
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

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleSecret || !googleRefresh) {
    return NextResponse.json({ error: 'missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const credentials: GoogleCredentials = {
    clientId: googleClientId,
    clientSecret: googleSecret,
    refreshToken: googleRefresh,
  };
  const deps: AppointmentDeps = { supabase, credentials, config: clientConfig };

  // ── Verificar estado actual ────────────────────────────────────────────────
  const appointment = await getAppointment({ appointmentId, clientId }, { supabase });
  if (!appointment) {
    return NextResponse.json({ error: 'appointment not found' }, { status: 404 });
  }

  // Idempotente: ya estaba confirmada
  if (appointment.status === 'confirmed') {
    return NextResponse.json({ appointmentId, status: 'confirmed' });
  }

  // Conflicto: ya estaba cancelada
  if (appointment.status === 'cancelled') {
    return NextResponse.json(
      { error: 'appointment is already cancelled' },
      { status: 409 },
    );
  }

  // ── Confirmar ─────────────────────────────────────────────────────────────
  await confirmAppointment({ appointmentId, clientId }, deps);

  // ── Programar recordatorios post-confirmación ─────────────────────────────
  // Obtener teléfono del paciente — está en la tabla patients, no en appointments
  const { data: patientRow } = await supabase
    .from('patients')
    .select('whatsapp_id')
    .eq('id', appointment.patientId)
    .single();

  const patientWhatsappId = (patientRow as { whatsapp_id: string } | null)?.whatsapp_id ?? null;
  const now = new Date();

  for (const hours of clientConfig.scheduling.reminderSchedule) {
    const scheduledFor = new Date(appointment.startsAt.getTime() - hours * 60 * 60_000);
    // Guard: solo programar si el momento del recordatorio es futuro
    if (scheduledFor > now && patientWhatsappId) {
      // Recordatorio de 24h incluye link firmado de cancelación
      let messageBody: string | undefined;
      if (hours === 24 && appointment.patientId) {
        const cancelUrl = generateCancelUrl({
          appointmentId,
          patientId: appointment.patientId,
          clientId,
        });
        const fecha = new Intl.DateTimeFormat('es-MX', {
          timeZone: 'America/Mexico_City',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }).format(appointment.startsAt);
        messageBody =
          `Hola 👋 Te recordamos tu cita mañana *${fecha}*.\n\n` +
          `Si necesitas cancelar, puedes hacerlo aquí (válido 24h):\n${cancelUrl}`;
      }

      await scheduleReminder(
        {
          clientId,
          appointmentId,
          patientWhatsappId,
          patientEmail: null,
          type: 'appointment_reminder',
          channel: 'whatsapp',
          scheduledFor,
          ...(messageBody !== undefined && { messageBody }),
        },
        supabase,
      );
    }
  }

  return NextResponse.json({ appointmentId, status: 'confirmed' });
}
