// ─── WhatsApp Webhook — dra-quevedo ──────────────────────────────────────────
// Recibe webhooks de WhatsApp Business API (Meta).
// Retorna 200 inmediatamente — Meta requiere respuesta en < 5 segundos.
// El procesamiento del mensaje ocurre en background con `after()`.

import { after } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleIncomingMessage, updateConversation, getConversation } from '@presenciapro/engine/bot';
import type { IncomingMessage } from '@presenciapro/engine/bot';
import { createAppointment } from '@presenciapro/engine/scheduling';
import type { Appointment, GoogleCredentials } from '@presenciapro/engine/scheduling';
import { sendWhatsApp, scheduleReminder } from '@presenciapro/engine/notifications';
import type { WhatsAppCredentials } from '@presenciapro/engine/notifications';
import { generateIntakeUrl } from '@presenciapro/engine/intake';
import { clientConfig } from '@/config/client.config';
import { buildNewAppointmentNotification } from '@/lib/doctor-notifications';

// ─── Meta payload types ───────────────────────────────────────────────────────

type MetaTextMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: 'text';
  text: { body: string };
};

type MetaMessage = MetaTextMessage | { type: string };

type MetaWebhookPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        messages?: MetaMessage[];
      };
    }>;
  }>;
};

// ─── Signature verification ───────────────────────────────────────────────────

async function verifySignature(request: Request, rawBody: string): Promise<boolean> {
  const signature = request.headers.get('x-hub-signature-256');
  if (!signature) return false;

  const appSecret = process.env['WHATSAPP_APP_SECRET'];
  if (!appSecret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedSignature =
    'sha256=' +
    Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  // Constant-time comparison to prevent timing attacks
  return signature === expectedSignature;
}

// ─── Message extraction ───────────────────────────────────────────────────────

function extractTextMessages(payload: MetaWebhookPayload): MetaTextMessage[] {
  const messages: MetaTextMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      for (const msg of change.value.messages ?? []) {
        if (msg.type === 'text') {
          messages.push(msg as MetaTextMessage);
        }
        // Non-text messages (images, stickers, audio) are intentionally ignored
      }
    }
  }

  return messages;
}

// ─── Patient resolution ───────────────────────────────────────────────────────

/**
 * Busca o crea un paciente por teléfono. Devuelve su UUID.
 * UNIQUE(client_id, phone) garantiza que el upsert retorna el registro existente
 * si el paciente ya tiene citas previas.
 */
async function resolvePatientId(
  supabase: SupabaseClient,
  clientId: string,
  phone: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('patients')
    .upsert(
      { client_id: clientId, phone },
      { onConflict: 'client_id,phone' },
    )
    .select('id')
    .single();

  if (error) throw new Error(`resolvePatientId: ${error.message}`);
  return (data as { id: string }).id;
}

// ─── GET — Meta webhook verification ─────────────────────────────────────────

export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

// ─── POST — Incoming messages ─────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  // Verify Meta signature before processing anything
  const isValid = await verifySignature(request, rawBody);
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Guard: only process whatsapp_business_account events
  if (payload.object !== 'whatsapp_business_account') {
    return new Response('OK', { status: 200 });
  }

  const textMessages = extractTextMessages(payload);

  if (textMessages.length > 0) {
    // Sort by timestamp to process in arrival order
    const sorted = [...textMessages].sort(
      (a, b) => Number(a.timestamp) - Number(b.timestamp),
    );

    // Process in background — never block the 200 response
    after(async () => {
      // ── Infrastructure: leer env vars una vez por batch ─────────────────
      const supabaseUrl        = process.env['NEXT_PUBLIC_SUPABASE_URL'];
      const serviceRoleKey     = process.env['SUPABASE_SERVICE_ROLE_KEY'];
      const accountSid         = process.env['WHATSAPP_ACCOUNT_SID'];
      const authToken          = process.env['WHATSAPP_AUTH_TOKEN'];
      const fromNumber         = process.env['WHATSAPP_FROM_NUMBER'];
      const googleClientId     = process.env['GOOGLE_CLIENT_ID'];
      const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
      const googleRefreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
      const cronSecret         = process.env['CRON_SECRET'];
      const baseUrl            = process.env['NEXT_PUBLIC_SITE_URL']
        ?? `https://${clientConfig.client.domain}`;

      if (
        !supabaseUrl || !serviceRoleKey ||
        !accountSid || !authToken || !fromNumber ||
        !googleClientId || !googleClientSecret || !googleRefreshToken
      ) {
        console.error('[bot] missing required env vars — aborting message processing');
        return;
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const whatsappCreds: WhatsAppCredentials = { accountSid, authToken, fromNumber };
      const googleCreds: GoogleCredentials = {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        refreshToken: googleRefreshToken,
      };

      for (const msg of sorted) {
        const incoming: IncomingMessage = {
          from: msg.from,
          body: msg.text.body,
          clientId: clientConfig.client.id,
          timestamp: new Date(Number(msg.timestamp) * 1000),
        };

        try {
          const botResponse = await handleIncomingMessage(incoming, clientConfig);

          // ── 1. Enviar respuesta al paciente ──────────────────────────────
          await sendWhatsApp(
            { to: incoming.from, body: botResponse.message },
            whatsappCreds,
          );

          // ── 2. Ejecutar acción opcional ──────────────────────────────────
          const action = botResponse.action;

          if (action?.type === 'CREATE_APPOINTMENT') {
            const botData = action.data;

            // patientPhone → UUID: lookup/upsert en tabla patients
            const patientId = await resolvePatientId(
              supabase,
              clientConfig.client.id,
              botData.patientPhone,
            );

            const appointment = await createAppointment(
              {
                clientId: clientConfig.client.id,
                patientId,
                specialistId: botData.specialistId,
                serviceId: botData.serviceId,
                serviceMode: botData.serviceMode,
                startsAt: botData.startsAt,
              },
              { supabase, credentials: googleCreds, config: clientConfig },
            );

            // Persistir appointmentId y transicionar estado de conversación
            const conv = await getConversation(clientConfig.client.id, incoming.from);
            if (conv) {
              const nextStep = clientConfig.scheduling.confirmationRequired
                ? 'AWAITING_CONFIRMATION'
                : 'COMPLETED';
              await updateConversation(conv.id, {
                state: nextStep,
                context: { appointmentId: appointment.id },
              });
            }

            // Recordatorios — solo si no requiere confirmación.
            // Si confirmationRequired: los programa api/appointments/confirm tras recibir el SÍ.
            if (!clientConfig.scheduling.confirmationRequired) {
              for (const hours of clientConfig.scheduling.reminderSchedule) {
                const scheduledFor = new Date(
                  appointment.startsAt.getTime() - hours * 60 * 60_000,
                );
                // Guard: solo programar si el momento del recordatorio es futuro
                if (scheduledFor > new Date()) {
                  await scheduleReminder(
                    {
                      clientId: clientConfig.client.id,
                      appointmentId: appointment.id,
                      patientPhone: botData.patientPhone,
                      patientEmail: null,
                      type: 'appointment_reminder',
                      channel: 'whatsapp',
                      scheduledFor,
                    },
                    supabase,
                  );
                }
              }
            }

            // Notificación a la doctora (hueco B.5)
            const specialist = clientConfig.specialists.find(
              (s) => s.id === botData.specialistId,
            );
            if (specialist?.whatsapp) {
              await sendWhatsApp(
                {
                  to: specialist.whatsapp,
                  body: buildNewAppointmentNotification(
                    appointment,
                    botData.patientPhone,
                    clientConfig,
                  ),
                },
                whatsappCreds,
              );
            }

          } else if (action?.type === 'SEND_INTAKE_LINK') {
            // Resolve patient_id from the appointment to build the signed intake URL
            const { data: apptRow } = await supabase
              .from('appointments')
              .select('patient_id')
              .eq('id', action.appointmentId)
              .eq('client_id', clientConfig.client.id)
              .single();

            const resolvedPatientId = (apptRow as { patient_id: string } | null)?.patient_id;
            if (resolvedPatientId) {
              const intakeUrl = generateIntakeUrl({
                appointmentId: action.appointmentId,
                patientId: resolvedPatientId,
                clientId: clientConfig.client.id,
              });
              await sendWhatsApp(
                {
                  to: incoming.from,
                  body: `Para completar tu cita, por favor llena este breve formulario médico antes de tu consulta 📋\n\n${intakeUrl}\n\nTiene validez por 48 horas.`,
                },
                whatsappCreds,
              );
            }

          } else if (action?.type === 'CONFIRM_APPOINTMENT') {
            await fetch(`${baseUrl}/api/appointments/confirm`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cronSecret ?? ''}`,
              },
              body: JSON.stringify({
                appointmentId: action.appointmentId,
                clientId: clientConfig.client.id,
              }),
            }).catch((err) => {
              console.error('[bot] confirm fetch error:', err);
            });

          } else if (action?.type === 'CANCEL_APPOINTMENT') {
            await fetch(`${baseUrl}/api/appointments/cancel`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cronSecret ?? ''}`,
              },
              body: JSON.stringify({
                appointmentId: action.appointmentId,
                clientId: clientConfig.client.id,
                reason: action.reason,
              }),
            }).catch((err) => {
              console.error('[bot] cancel fetch error:', err);
            });
          }

        } catch (err) {
          // Processing errors are non-fatal — Meta already got its 200
          console.error('[bot] handleIncomingMessage error:', err);
        }
      }
    });
  }

  // Meta requires 200 in < 5 seconds — always return before processing completes
  return new Response('OK', { status: 200 });
}
