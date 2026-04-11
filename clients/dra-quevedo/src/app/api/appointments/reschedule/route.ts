// ─── POST /api/appointments/reschedule ────────────────────────────────────────
// Reagenda una cita a una nueva fecha y hora desde el dashboard del médico.
//
// Transacción (orden elegido para maximizar consistencia):
//   1. Validar sesión del médico y propiedad de la cita
//   2. Validar que el nuevo slot no tiene double-booking
//   3. Crear nuevo evento en Google Calendar
//   4. Actualizar starts_at, ends_at, google_event_id en Supabase
//   5. Eliminar viejo evento de Google Calendar
//   6. Notificar al paciente por WhatsApp (fire-and-forget)
//
// Rollback:
//   - Si falla el paso 3 (crear GCal): nada se modificó → retorna error
//   - Si falla el paso 4 (actualizar DB): eliminar el GCal creado en paso 3 → retorna error
//   - Si falla el paso 5 (eliminar viejo GCal): log, no es fatal (evento colgante limpiable)
//
// Auth: sesión Supabase del médico (cookie). No usa CRON_SECRET.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getGoogleAccessToken } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { clientConfig } from '@/config/client.config';

// ─── Google Calendar helpers ───────────────────────────────────────────────────

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

async function createCalendarEvent(params: {
  calendarId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  accessToken: string;
}): Promise<string> {
  const body = {
    summary: params.title,
    start: { dateTime: params.startsAt.toISOString(), timeZone: params.timezone },
    end:   { dateTime: params.endsAt.toISOString(),   timeZone: params.timezone },
  };

  const res = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar createEvent failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

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

  if (!res.ok && res.status !== 410) {
    const text = await res.text();
    throw new Error(`Google Calendar deleteEvent failed (${res.status}): ${text}`);
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  appointmentId: z.string().uuid(),
  newStartsAt:   z.string().min(1),   // ISO 8601 — validated via new Date() below
  newEndsAt:     z.string().min(1),   // ISO 8601 — validated via new Date() below
  clientId:      z.string().min(1),
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

  const { appointmentId, newStartsAt, newEndsAt, clientId } = body;

  // Guard: clientId debe coincidir con esta instancia
  if (clientId !== clientConfig.client.id) {
    return NextResponse.json({ error: 'client mismatch' }, { status: 403 });
  }

  const newStart = new Date(newStartsAt);
  const newEnd   = new Date(newEndsAt);

  // Guard: fechas deben ser válidas
  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 });
  }

  // Guard: newEndsAt debe ser posterior a newStartsAt
  if (newEnd.getTime() <= newStart.getTime()) {
    return NextResponse.json({ error: 'La hora de fin debe ser posterior a la de inicio' }, { status: 400 });
  }

  // ── Leer env vars ─────────────────────────────────────────────────────────
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
    .select(
      'id, client_id, patient_id, specialist_id, service_id, starts_at, ends_at, google_event_id, status',
    )
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
    ends_at: string;
    google_event_id: string | null;
    status: string;
  };

  // Guard: validar propiedad del cliente
  if (appt.client_id !== clientId) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  // Guard: solo citas activas pueden reagendarse
  const cancellableStatuses = ['pending', 'pending_confirmation', 'confirmed'];
  if (!cancellableStatuses.includes(appt.status)) {
    return NextResponse.json(
      { error: `No se puede reagendar una cita con status '${appt.status}'` },
      { status: 422 },
    );
  }

  // ── Validar que el nuevo slot no tiene double-booking ────────────────────
  // Excluimos la propia cita (appointmentId) para no bloquearnos a nosotros mismos.
  const { data: conflicts } = await supabase
    .from('appointments')
    .select('id')
    .eq('client_id', clientId)
    .eq('specialist_id', appt.specialist_id)
    .neq('id', appointmentId)
    .neq('status', 'cancelled')
    .lt('starts_at', newEnd.toISOString())
    .gt('ends_at', newStart.toISOString());

  if (conflicts && conflicts.length > 0) {
    return NextResponse.json({ error: 'El horario seleccionado ya está ocupado' }, { status: 409 });
  }

  // ── Resolver specialist para Google Calendar ──────────────────────────────
  const specialist = clientConfig.specialists.find((s) => s.id === appt.specialist_id);
  if (!specialist) {
    return NextResponse.json({ error: 'Especialista no encontrado en la configuración' }, { status: 500 });
  }

  const service = clientConfig.services.find((s) => s.id === appt.service_id);

  // ── Obtener access token de Google ────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken({
      clientId,
      googleClientId,
      clientSecret: googleSecret,
      refreshToken: googleRefresh,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error de autenticación con Google' },
      { status: 500 },
    );
  }

  // ── Paso 3: Crear nuevo evento en Google Calendar ─────────────────────────
  let newEventId: string;
  try {
    newEventId = await createCalendarEvent({
      calendarId: specialist.calendarId,
      title:      `Cita — ${service?.name ?? appt.service_id}`,
      startsAt:   newStart,
      endsAt:     newEnd,
      timezone:   clientConfig.client.timezone,
      accessToken,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al crear el evento en Google Calendar' },
      { status: 500 },
    );
  }

  // ── Paso 4: Actualizar Supabase ───────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      starts_at:       newStart.toISOString(),
      ends_at:         newEnd.toISOString(),
      google_event_id: newEventId,
    })
    .eq('id', appointmentId);

  if (updateError) {
    // Rollback: eliminar el nuevo evento de Google Calendar
    await deleteCalendarEvent(specialist.calendarId, newEventId, accessToken).catch(() => {
      // Log implícito — el evento colgante se puede limpiar manualmente
    });

    return NextResponse.json({ error: 'Error al actualizar la cita en la base de datos' }, { status: 500 });
  }

  // ── Paso 5: Eliminar viejo evento de Google Calendar ─────────────────────
  if (appt.google_event_id) {
    await deleteCalendarEvent(specialist.calendarId, appt.google_event_id, accessToken).catch(() => {
      // No es fatal — el evento viejo quedará en el calendario pero la cita
      // ya está actualizada correctamente en DB. Se puede limpiar manualmente.
    });
  }

  // ── Paso 6: Notificar al paciente por WhatsApp (fire-and-forget) ──────────
  if (appt.patient_id && accountSid && authToken && fromNumber) {
    const { data: patientRow } = await supabase
      .from('patients')
      .select('name, whatsapp_id')
      .eq('id', appt.patient_id)
      .maybeSingle();

    const patient = patientRow as { name: string; whatsapp_id: string } | null;

    if (patient?.whatsapp_id) {
      const timezone = clientConfig.client.timezone;

      const fecha = newStart.toLocaleDateString('es-MX', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });

      const hora = newStart.toLocaleTimeString('es-MX', {
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
            `Hola ${firstName}, tu cita ha sido reprogramada.`,
            '',
            `📅 Nueva fecha: ${fecha}`,
            `🕐 Hora: ${hora}`,
            `💆 Servicio: ${service?.name ?? appt.service_id}`,
            '',
            'Si necesitas hacer algún cambio adicional, escríbenos aquí.',
          ].join('\n'),
        },
        whatsappCreds,
      ).catch(() => {
        // fire-and-forget — no bloquea si WhatsApp falla
      });
    }
  }

  return NextResponse.json({
    appointmentId,
    newStartsAt: newStart.toISOString(),
    newEndsAt:   newEnd.toISOString(),
  });
}
