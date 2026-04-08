// ─── dispatch-notifications ────────────────────────────────────────────────────
// Edge Function (Deno). Despacha recordatorios pendientes de scheduled_notifications.
//
// Trigger: cron cada minuto — configura en Supabase Dashboard → Edge Functions → Schedule
//   Cron: * * * * *
//
// Variables de entorno requeridas (Supabase Secrets):
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasea RLS)
//   TWILIO_ACCOUNT_SID        — credencial Twilio para WhatsApp
//   TWILIO_AUTH_TOKEN         — credencial Twilio
//   TWILIO_FROM_NUMBER        — número origen registrado en Twilio (solo dígitos, sin +)
//   RESEND_API_KEY            — credencial Resend para email
//   RESEND_FROM_EMAIL         — dirección origen en Resend (ej: citas@presenciapro.com)

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO_ACCOUNT_SID        = Deno.env.get('TWILIO_ACCOUNT_SID')        ?? '';
const TWILIO_AUTH_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')         ?? '';
const TWILIO_FROM_NUMBER        = Deno.env.get('TWILIO_FROM_NUMBER')        ?? '';
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY')            ?? '';
const RESEND_FROM_EMAIL         = Deno.env.get('RESEND_FROM_EMAIL')         ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  client_id: string;
  appointment_id: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  type: string;
  channel: 'whatsapp' | 'email';
  /** Cuerpo pre-construido desde Next.js (links firmados, etc.). Tiene prioridad si está presente. */
  message_body: string | null;
  // Joined from appointments + patients:
  patient_name: string | null;
  starts_at: string | null;
  specialist_id: string | null;
  service_mode: string | null;
}

// ─── Message builder ──────────────────────────────────────────────────────────
// Versión simplificada sin ClientConfig (specialist name y service name no están en DB).
// El mensaje incluye fecha/hora y nombre del paciente cuando están disponibles.
// Para mensajes con branding completo, pre-construir message_body al llamar scheduleReminder().

function buildMessage(
  type: string,
  patientName: string | null,
  startsAt: string | null,
  timezone = 'America/Mexico_City',
): string {
  const name  = patientName ?? 'Paciente';
  const fecha = startsAt
    ? new Intl.DateTimeFormat('es-MX', {
        timeZone: timezone,
        weekday: 'long',
        day:     'numeric',
        month:   'long',
        hour:    '2-digit',
        minute:  '2-digit',
      }).format(new Date(startsAt))
    : '';

  switch (type) {
    case 'appointment_reminder':
      return (
        `Hola ${name} 👋 Te recordamos tu cita el *${fecha}*.\n\n` +
        `Si necesitas cancelar o reagendar, contáctanos con anticipación.`
      );
    case 'appointment_confirmation':
      return (
        `Hola ${name}, tu cita del *${fecha}* está pendiente de confirmación.\n\n` +
        `Responde *SÍ* para confirmar o *NO* para cancelar.`
      );
    case 'appointment_confirmed':
      return `✅ ¡Cita confirmada! Te esperamos el *${fecha}*.`;
    case 'appointment_cancelled':
      return (
        `Tu cita del *${fecha}* ha sido cancelada.\n\n` +
        `Si deseas reagendar, con gusto te ayudamos.`
      );
    case 'review_request':
      return (
        `Hola ${name}, esperamos que tu cita haya sido de tu agrado. 🙏\n\n` +
        `¿Nos regalas un minuto para dejarnos tu opinión?`
      );
    case 'reactivation':
      return `Hola ${name}, ¿te gustaría agendar una nueva cita? Quedamos a tus órdenes. 🌸`;
    case 'post_consulta':
      // TODO(config): Usar postConsultaMessage del clientConfig cuando esté disponible en DB.
      // Por ahora la Edge Function no tiene acceso al config del cliente — mensaje genérico.
      return (
        `Hola ${name} 🌸 Gracias por tu cita. ` +
        `Recuerda seguir las indicaciones post-tratamiento. Quedamos a tus órdenes si tienes alguna duda.`
      );
    default:
      return `Hola ${name}, tienes un mensaje de tu médico.`;
  }
}

// ─── WhatsApp (Twilio) ────────────────────────────────────────────────────────

async function sendWhatsApp(to: string, body: string): Promise<string | null> {
  // btoa() está disponible nativamente en Deno — no usa Buffer (Node.js API)
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: `whatsapp:+${TWILIO_FROM_NUMBER}`,
      To:   `whatsapp:+${to}`,
      Body: body,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio ${res.status}: ${err}`);
  }

  const data = await res.json() as { sid: string };
  return data.sid;
}

// ─── Email (Resend) ───────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string): Promise<string | null> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    RESEND_FROM_EMAIL,
      to:      [to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err}`);
  }

  const data = await res.json() as { id: string };
  return data.id;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch pending notifications (LIMIT 50 para evitar timeout de Edge Function) ──
  const { data: rows, error: fetchError } = await supabase
    .from('scheduled_notifications')
    .select(`
      id,
      client_id,
      appointment_id,
      patient_phone,
      patient_email,
      type,
      channel,
      message_body,
      appointments (
        starts_at,
        specialist_id,
        service_mode,
        patients ( name )
      )
    `)
    .is('sent_at', null)
    .is('failed_at', null)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (fetchError) {
    console.error('[dispatch-notifications] fetch error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const notifications = rows as unknown as Array<{
    id: string;
    client_id: string;
    appointment_id: string | null;
    patient_phone: string | null;
    patient_email: string | null;
    type: string;
    channel: 'whatsapp' | 'email';
    message_body: string | null;
    appointments: {
      starts_at: string;
      specialist_id: string;
      service_mode: string;
      patients: { name: string } | null;
    } | null;
  }>;

  const summary = { dispatched: 0, failed: 0, skipped: 0 };

  for (const row of notifications ?? []) {
    // ── Idempotencia: reclamar la fila atomicamente ─────────────────────────
    // UPDATE ... WHERE id = ? AND sent_at IS NULL garantiza que si dos workers
    // procesan el mismo batch, solo uno reclama cada fila.
    const { data: claimed } = await supabase
      .from('scheduled_notifications')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('sent_at', null)
      .is('failed_at', null)
      .select('id');

    if (!claimed || claimed.length === 0) {
      // Otro worker ya reclamó esta fila
      summary.skipped++;
      continue;
    }

    const patientName = row.appointments?.patients?.name ?? null;
    const startsAt    = row.appointments?.starts_at      ?? null;

    // message_body pre-construido tiene prioridad sobre el mensaje genérico
    const message = row.message_body ?? buildMessage(row.type, patientName, startsAt);

    try {
      if (row.channel === 'whatsapp' && row.patient_phone) {
        await sendWhatsApp(row.patient_phone, message);

      } else if (row.channel === 'email' && row.patient_email) {
        const subject = startsAt
          ? `Recordatorio de tu cita — ${new Date(startsAt).toLocaleDateString('es-MX')}`
          : 'Mensaje de tu médico';
        await sendEmail(row.patient_email, subject, message);

      } else {
        // Datos de contacto ausentes — marcar como fallido sin reintentar
        await supabase
          .from('scheduled_notifications')
          .update({
            sent_at:       null,
            failed_at:     new Date().toISOString(),
            error_message: 'Sin datos de contacto (patient_phone / patient_email nulos)',
          })
          .eq('id', row.id);
        summary.failed++;
        continue;
      }

      // Envío exitoso — sent_at ya fue seteado en el claim anterior
      console.log('[dispatch-notifications] sent', {
        id:        row.id,
        client_id: row.client_id,
        type:      row.type,
        channel:   row.channel,
        appointment_id: row.appointment_id,
      });
      summary.dispatched++;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Envío falló — revertir claimed: limpiar sent_at y registrar failed_at
      await supabase
        .from('scheduled_notifications')
        .update({
          sent_at:       null,
          failed_at:     new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq('id', row.id);

      console.error('[dispatch-notifications] send failed', {
        id:           row.id,
        client_id:    row.client_id,
        type:         row.type,
        channel:      row.channel,
        errorMessage,
      });
      summary.failed++;
    }
  }

  console.log('[dispatch-notifications] done', summary);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
