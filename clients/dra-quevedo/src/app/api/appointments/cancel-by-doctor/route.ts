// ─── POST /api/appointments/cancel-by-doctor ──────────────────────────────────
// Cancela una cita desde el dashboard del médico.
// Distinto de /cancel (bot/sistema) y /cancel-by-patient (paciente):
//   - Autenticado con sesión de Supabase Auth del médico (no CRON_SECRET)
//   - El médico puede cancelar en cualquier momento (sin ventana de cancelación)
//   - No registra evento de penalización — es cancelación operativa del doctor
//
// Transacción:
//   1. Marca appointments.status = 'cancelled' en Supabase
//   2. Elimina evento de Google Calendar
//   3. Envía WhatsApp al paciente (fire-and-forget — no bloquea si falla)
//
// Rollback: si Google Calendar falla DESPUÉS de actualizar la DB,
// se revierte el status en Supabase y se retorna error.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getGoogleAccessToken } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Google Calendar — delete event ───────────────────────────────────────────

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  // 204 = success, 410 = already gone — both acceptable (idempotent)
  if (!res.ok && res.status !== 410) {
    const text = await res.text();
    throw new Error(`Google Calendar DELETE failed (${res.status}): ${text}`);
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  appointmentId: z.string().uuid(),
  clientId: z.string().min(1),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // ── Verificar sesión del médico ───────────────────────────────────────────
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // ── Validar body ─────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const { appointmentId, clientId } = body;

  // Guard: clientId debe coincidir con esta instancia
  if (clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'client mismatch' }, { status: 403 });
  }

  // ── Leer env vars de infraestructura ─────────────────────────────────────
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleSecret   = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefresh  = process.env['GOOGLE_REFRESH_TOKEN'];
  const accountSid     = process.env['WHATSAPP_ACCOUNT_SID'];
  const authToken      = process.env['WHATSAPP_AUTH_TOKEN'];
  const fromNumber     = process.env['WHATSAPP_FROM_NUMBER'];

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleSecret || !googleRefresh) {
    return NextResponse.json({ error: 'Configuración de servidor incompleta' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ── Leer la cita y verificar propiedad ───────────────────────────────────
  const { data: apptRow, error: fetchError } = await supabase
    .from('appointments')
    .select('id, client_id, patient_id, specialist_id, service_id, starts_at, google_event_id, status')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchError || !apptRow) {
    return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 });
  }

  const appt = apptRow as {
    id: string;
    client_id: string;
    patient_id: string | null;
    specialist_id: string;
    service_id: string;
    starts_at: string;
    google_event_id: string | null;
    status: string;
  };

  // Guard: validar que la cita pertenece a este cliente
  if (appt.client_id !== clientId) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // Idempotente
  if (appt.status === 'cancelled') {
    return NextResponse.json({ appointmentId, status: 'cancelled' });
  }

  // ── 1. Actualizar status en Supabase ─────────────────────────────────────
  const { error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId);

  if (updateError) {
    return NextResponse.json({ error: 'Error al actualizar la cita' }, { status: 500 });
  }

  // ── 2. Eliminar evento de Google Calendar ─────────────────────────────────
  if (appt.google_event_id) {
    const specialist = clientConfig.specialists.find((s) => s.id === appt.specialist_id);

    if (specialist) {
      try {
        const accessToken = await getGoogleAccessToken({
          clientId,
          googleClientId,
          clientSecret: googleSecret,
          refreshToken: googleRefresh,
        });

        await deleteCalendarEvent(specialist.calendarId, appt.google_event_id, accessToken);
      } catch {
        // Rollback: revertir el status en Supabase
        await supabase
          .from('appointments')
          .update({ status: appt.status })
          .eq('id', appointmentId);

        return NextResponse.json(
          { error: 'Error al eliminar el evento del calendario. La cita no fue cancelada.' },
          { status: 500 },
        );
      }
    }
  }

  // ── 3. Notificar al paciente por WhatsApp (fire-and-forget) ───────────────
  if (appt.patient_id && accountSid && authToken && fromNumber) {
    const { data: patientRow } = await supabase
      .from('patients')
      .select('name, whatsapp_id')
      .eq('id', appt.patient_id)
      .maybeSingle();

    const patient = patientRow as { name: string; phone: string } | null;

    if (patient?.whatsapp_id) {
      const timezone = clientConfig.client.timezone;
      const startsAt = new Date(appt.starts_at);

      const fecha = startsAt.toLocaleDateString('es-MX', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });

      const hora = startsAt.toLocaleTimeString('es-MX', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const firstName = patient.name.split(' ')[0] ?? patient.name;
      const whatsappCreds: WhatsAppCredentials = { accountSid, authToken, fromNumber };

      await sendWhatsApp(
        {
          to: patient.whatsapp_id,
          body: [
            `Hola ${firstName}, tu cita del ${fecha} a las ${hora} ha sido cancelada.`,
            '',
            'Cuando quieras reagendar, escríbenos aquí. 😊',
          ].join('\n'),
        },
        whatsappCreds,
      ).catch(() => {
        // fire-and-forget — no bloquea si WhatsApp falla
      });
    }
  }

  return NextResponse.json({ appointmentId, status: 'cancelled' });
}
