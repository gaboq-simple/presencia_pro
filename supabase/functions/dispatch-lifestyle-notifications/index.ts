// ─── dispatch-lifestyle-notifications ────────────────────────────────────────
// Edge Function (Deno). Despacha recordatorios pendientes de la tabla
// scheduled_notifications de lifestyle.
//
// Trigger: cron cada minuto — configura en Supabase Dashboard → Edge Functions → Schedule
//   Cron: * * * * *
//
// Tipos manejados:
//   reminder_1h     — recordatorio 1h antes de la cita
//   reminder_2h     — recordatorio 2h antes (futuro)
//   reminder_24h    — recordatorio 24h antes (futuro)
//   follow_up       — seguimiento post-cita (futuro)
//   review_request  — solicitud de reseña 24h después de la visita
//   waitlist_expiry — expiración de notificación de lista de espera (30 min)
//
// Envío: Meta WhatsApp Business Cloud API (no Twilio).
// Credenciales resueltas desde businesses.whatsapp_phone_number_id.
//
// Variables de entorno requeridas (Supabase Secrets):
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasea RLS)
//   WHATSAPP_ACCESS_TOKEN     — System User Token de Meta Business Account

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Env ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WHATSAPP_ACCESS_TOKEN     = Deno.env.get('WHATSAPP_ACCESS_TOKEN')     ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationRow {
  id:             string;
  business_id:    string;
  appointment_id: string | null;
  customer_phone: string | null;
  customer_id:    string | null;
  type:           string;
  message_body:   string | null;
  metadata:       Record<string, string> | null;
  // Joined:
  whatsapp_phone_number_id: string | null;
  business_name:            string | null;
  review_url:               string | null;
}

// ─── Meta WhatsApp Cloud API ──────────────────────────────────────────────────

async function sendWhatsAppMeta(
  to:            string,
  body:          string,
  phoneNumberId: string,
): Promise<string> {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta WA ${res.status}: ${err}`);
  }

  const data = await res.json() as { messages?: Array<{ id: string }> };
  return data.messages?.[0]?.id ?? '';
}

// ─── Fallback message builder ─────────────────────────────────────────────────

function buildFallbackMessage(
  type:         string,
  businessName: string | null,
): string {
  switch (type) {
    case 'reminder_1h':
    case 'reminder_2h':
    case 'reminder_24h':
      return `Hola, te recordamos tu próxima cita${businessName ? ` en ${businessName}` : ''}. ¡Te esperamos! 💈`;
    case 'follow_up':
      return `Hola, gracias por tu visita. ¿Cómo te fue?`;
    case 'review_request':
      return `Hola, ¿nos regalas tu opinión sobre tu cita?`;
    default:
      return `Tienes un mensaje de ${businessName ?? 'tu negocio'}.`;
  }
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function formatDateSpanish(d: Date): string {
  return `${DAYS_ES[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
}

function formatTimeHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── handleWaitlistExpiry ─────────────────────────────────────────────────────
// Expira la entrada notificada, busca el siguiente en lista de espera y
// le envía una notificación si existe.
// Best-effort: errores no afectan otras notificaciones del mismo ciclo.

type WaitlistNotifRow = {
  id:          string;
  business_id: string;
  metadata:    Record<string, string> | null;
  businesses:  { whatsapp_phone_number_id: string } | null;
};

async function handleWaitlistExpiry(
  supabase: ReturnType<typeof createClient>,
  row:      WaitlistNotifRow,
): Promise<void> {
  const metadata   = row.metadata;
  const waitlistId = metadata?.waitlist_id;

  if (!waitlistId) {
    console.warn('[waitlist_expiry] missing waitlist_id in metadata', { id: row.id });
    return;
  }

  // ── 1. Leer entry — solo procesar si sigue en 'notified' ─────────────────

  const { data: wlData } = await supabase
    .from('waitlist')
    .select('id, business_id, requested_date')
    .eq('id', waitlistId)
    .eq('status', 'notified')
    .maybeSingle();

  if (!wlData) return; // ya confirmado o expirado

  const entry = wlData as { id: string; business_id: string; requested_date: string };

  // ── 2. Expirar con UPDATE condicional (guard contra race condition) ────────

  const { data: expired } = await supabase
    .from('waitlist')
    .update({ status: 'expired' })
    .eq('id', waitlistId)
    .eq('status', 'notified')
    .select('id');

  if (!expired || expired.length === 0) return;

  // ── 3. Buscar siguiente en espera para el mismo negocio y fecha ───────────

  const { data: nextData } = await supabase
    .from('waitlist')
    .select('id, customer:customer_id(id, name, phone), service:service_id(name)')
    .eq('business_id', entry.business_id)
    .eq('requested_date', entry.requested_date)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextData) return; // no hay más en lista de espera — slot libre para el bot

  const next = nextData as {
    id:       string;
    customer: { id: string; name: string; phone: string } | null;
    service:  { name: string } | null;
  };

  if (!next.customer) return;

  const notifiedAt = new Date();
  const expiresAt  = new Date(notifiedAt.getTime() + 30 * 60_000);

  // ── 4. Marcar siguiente como 'notified' ───────────────────────────────────

  await supabase
    .from('waitlist')
    .update({
      status:      'notified',
      notified_at: notifiedAt.toISOString(),
      expires_at:  expiresAt.toISOString(),
    })
    .eq('id', next.id);

  // ── 5. Programar nueva expiración heredando datos del slot ────────────────

  await supabase.from('scheduled_notifications').insert({
    business_id:    entry.business_id,
    type:           'waitlist_expiry',
    scheduled_for:  expiresAt.toISOString(),
    customer_phone: next.customer.phone,
    customer_id:    next.customer.id,
    metadata: {
      waitlist_id:     next.id,
      slot_starts_at:  metadata?.slot_starts_at  ?? '',
      slot_staff_id:   metadata?.slot_staff_id   ?? '',
      slot_staff_name: metadata?.slot_staff_name ?? '',
      service_name:    next.service?.name ?? metadata?.service_name ?? '',
    },
  });

  // ── 6. Enviar WhatsApp al siguiente — best-effort ─────────────────────────

  const phoneNumberId = row.businesses?.whatsapp_phone_number_id;
  if (!phoneNumberId) return;

  try {
    const slotDate    = new Date(metadata?.slot_starts_at ?? '');
    const validDate   = !isNaN(slotDate.getTime());
    const dateStr     = validDate ? formatDateSpanish(slotDate) : entry.requested_date;
    const timeStr     = validDate ? ` a las ${formatTimeHHMM(slotDate)}` : '';
    const staffName   = metadata?.slot_staff_name ?? 'tu barbero';
    const serviceName = next.service?.name ?? metadata?.service_name ?? 'tu servicio';

    const message =
      `¡Buenas noticias! Se liberó un lugar para ${serviceName} ` +
      `el ${dateStr}${timeStr} con ${staffName} 💈\n` +
      `¿Lo tomamos? Responde SÍ en los próximos 30 minutos o el lugar se liberará.`;

    await sendWhatsAppMeta(next.customer.phone, message, phoneNumberId);
  } catch (err) {
    console.error('[waitlist_expiry] WA send failed', err instanceof Error ? err.message : String(err));
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Fetch notificaciones pendientes (LIMIT 50) ──────────────────────────

  const { data: rows, error: fetchError } = await supabase
    .from('scheduled_notifications')
    .select(`
      id,
      business_id,
      appointment_id,
      customer_phone,
      customer_id,
      type,
      message_body,
      metadata,
      businesses (
        whatsapp_phone_number_id,
        name,
        review_url
      )
    `)
    .is('sent_at', null)
    .is('failed_at', null)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (fetchError) {
    console.error('[dispatch-lifestyle-notifications] fetch error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const notifications = (rows ?? []) as unknown as Array<{
    id:             string;
    business_id:    string;
    appointment_id: string | null;
    customer_phone: string | null;
    customer_id:    string | null;
    type:           string;
    message_body:   string | null;
    metadata:       Record<string, string> | null;
    businesses: {
      whatsapp_phone_number_id: string;
      name:                     string;
      review_url:               string | null;
    } | null;
  }>;

  const summary = { dispatched: 0, failed: 0, skipped: 0 };

  for (const row of notifications) {
    // ── Claim atómico — idempotencia ────────────────────────────────────────
    const { data: claimed } = await supabase
      .from('scheduled_notifications')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('sent_at', null)
      .is('failed_at', null)
      .select('id');

    if (!claimed || claimed.length === 0) {
      summary.skipped++;
      continue;
    }

    // ── waitlist_expiry — lógica de expiración y re-notificación ─────────
    if (row.type === 'waitlist_expiry') {
      try {
        await handleWaitlistExpiry(supabase, {
          id:          row.id,
          business_id: row.business_id,
          metadata:    row.metadata,
          businesses:  row.businesses
            ? { whatsapp_phone_number_id: row.businesses.whatsapp_phone_number_id }
            : null,
        });
        summary.dispatched++;
      } catch (err) {
        console.error('[waitlist_expiry] unhandled error', err instanceof Error ? err.message : String(err));
        summary.failed++;
      }
      continue;
    }

    const phoneNumberId  = row.businesses?.whatsapp_phone_number_id ?? null;
    const businessName   = row.businesses?.name ?? null;
    const customerPhone  = row.customer_phone;

    // Sin teléfono destino o sin credenciales → fallo sin reintentar
    if (!customerPhone || !phoneNumberId) {
      await supabase
        .from('scheduled_notifications')
        .update({
          sent_at:   null,
          failed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      summary.failed++;
      console.warn('[dispatch-lifestyle-notifications] missing phone or phoneNumberId', { id: row.id });
      continue;
    }

    // Usar message_body pre-construido si está disponible
    const message = row.message_body ?? buildFallbackMessage(row.type, businessName);

    try {
      await sendWhatsAppMeta(customerPhone, message, phoneNumberId);

      console.log('[dispatch-lifestyle-notifications] sent', {
        id:          row.id,
        type:        row.type,
        business_id: row.business_id,
      });
      summary.dispatched++;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Revertir claim y registrar fallo
      await supabase
        .from('scheduled_notifications')
        .update({
          sent_at:   null,
          failed_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      console.error('[dispatch-lifestyle-notifications] send failed', {
        id:          row.id,
        type:        row.type,
        errorMessage,
      });
      summary.failed++;
    }
  }

  console.log('[dispatch-lifestyle-notifications] done', summary);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
});
