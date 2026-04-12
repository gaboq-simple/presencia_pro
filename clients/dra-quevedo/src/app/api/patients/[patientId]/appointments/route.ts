// ─── API Route: POST /api/patients/[patientId]/appointments ───────────────────
// Creates an appointment from the patient profile drawer.
// Mirrors the bot's createAppointment flow:
//   1. Validate doctor session and patient ownership
//   2. Create appointment via scheduling.createAppointment()
//      (handles double-booking guard + Google Calendar sync atomically)
//   3. Send WhatsApp confirmation to patient (fire-and-forget)
//
// Auth:    active Supabase Auth session (doctor-facing, Authorization header)
// Returns: { appointmentId, startsAt, endsAt }

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createAppointment, SlotUnavailableError } from '@presenciapro/engine/scheduling';
import { sendWhatsApp } from '@presenciapro/engine/notifications';
import { isMedical } from '@presenciapro/engine/types';
import { clientConfig } from '@/config/client.config';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';

// ─── Schema ────────────────────────────────────────────────────────────────────

const BodySchema = z.object({
  serviceId:   z.string().min(1),
  serviceMode: z.enum(['domicilio', 'consultorio']),
  startsAt:    z.string().min(1),   // ISO 8601
  specialistId: z.string().min(1),
});

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
): Promise<Response> {
  // Guard: feature is medical-only
  if (!isMedical(clientConfig)) {
    return json({ error: 'Not available for this profile' }, 403);
  }

  // Guard: required env vars
  const supabaseUrl    = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey        = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleSecret   = process.env['GOOGLE_CLIENT_SECRET'];
  const googleRefresh  = process.env['GOOGLE_REFRESH_TOKEN'];

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !googleClientId || !googleSecret || !googleRefresh) {
    return json({ error: 'Server configuration error' }, 500);
  }

  // Guard: active doctor session
  const authHeader = request.headers.get('Authorization') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Guard: valid patientId
  const { patientId } = await params;
  if (!patientId) {
    return json({ error: 'Missing patientId' }, 400);
  }

  // Guard: valid body
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return json({ error: 'Solicitud inválida' }, 400);
  }

  const { serviceId, serviceMode, startsAt: startsAtIso, specialistId } = body;
  const startsAt = new Date(startsAtIso);

  if (isNaN(startsAt.getTime())) {
    return json({ error: 'Fecha inválida' }, 400);
  }

  const clientId = clientConfig.client.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Guard: patient must belong to this client
  const { data: patient, error: patErr } = await supabase
    .from('patients')
    .select('id, name, whatsapp_id')
    .eq('id', patientId)
    .eq('client_id', clientId)
    .single();

  if (patErr || !patient) {
    return json({ error: 'Paciente no encontrado' }, 404);
  }

  // Create appointment via scheduling engine (double-booking guard + GCal sync)
  try {
    const appointment = await createAppointment(
      {
        clientId,
        patientId,
        specialistId,
        serviceId,
        serviceMode,
        startsAt,
      },
      {
        supabase,
        credentials: {
          clientId:     googleClientId,
          clientSecret: googleSecret,
          refreshToken: googleRefresh,
        },
        config: clientConfig,
      },
    );

    // ── WhatsApp confirmation (fire-and-forget) ────────────────────────────
    const accountSid  = process.env['WHATSAPP_ACCOUNT_SID'];
    const authToken   = process.env['WHATSAPP_AUTH_TOKEN'];
    const fromNumber  = process.env['WHATSAPP_FROM_NUMBER'];
    const patientRow  = patient as { id: string; name: string; whatsapp_id: string };

    if (accountSid && authToken && fromNumber && patientRow.whatsapp_id) {
      const timezone  = clientConfig.client.timezone;
      const service   = clientConfig.services.find((s) => s.id === serviceId);
      const firstName = patientRow.name.split(' ')[0] ?? patientRow.name;

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

      const waCredentials: WhatsAppCredentials = { accountSid, authToken, fromNumber };

      void sendWhatsApp(
        {
          to: patientRow.whatsapp_id,
          body: [
            `Hola ${firstName}, tu cita ha sido agendada. 🌸`,
            '',
            `📅 Fecha: ${fecha}`,
            `🕐 Hora: ${hora}`,
            `💆 Servicio: ${service?.name ?? serviceId}`,
            '',
            'Si necesitas hacer algún cambio, escríbenos aquí.',
          ].join('\n'),
        },
        waCredentials,
      ).catch(() => {
        // fire-and-forget — no bloquea si WhatsApp falla
      });
    }

    return json(
      {
        appointmentId: appointment.id,
        startsAt:      appointment.startsAt.toISOString(),
        endsAt:        appointment.endsAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return json({ error: 'El horario seleccionado ya no está disponible' }, 409);
    }
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
