// ─── dispatch-lifestyle-notifications ────────────────────────────────────────
// Edge Function (Deno). Despacha recordatorios pendientes de la tabla
// scheduled_notifications de lifestyle.
//
// Trigger: cron cada minuto — configura en Supabase Dashboard → Edge Functions → Schedule
//   Cron: * * * * *
//
// Tipos manejados:
//   reminder_1h     — recordatorio 1h antes de la cita
//   reminder_2h     — recordatorio 2h antes
//   reminder_24h    — recordatorio 24h antes
//   follow_up       — seguimiento post-cita
//   review_request  — solicitud de resena 24h despues de la visita
//   waitlist_expiry — expiracion de notificacion de lista de espera (30 min)
//
// Envio: Meta WhatsApp Business Cloud API.
// Usa Message Templates aprobados para envios proactivos fuera de la ventana
// de 24h de conversacion, con fallback a texto libre (message_body).
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

// ─── Template name registry (mirrors whatsapp-templates.ts) ─────────────────

const TEMPLATE_NAMES: Record<string, string> = {
  reminder_24h:   'appointment_reminder_24h',
  reminder_2h:    'appointment_reminder_2h',
  reminder_1h:    'appointment_reminder_1h',
  follow_up:      'appointment_follow_up',
  review_request: 'appointment_review_request',
};

// ─── Meta WhatsApp Cloud API — Template send ────────────────────────────────

interface TemplateTextParameter {
  type: 'text';
  text: string;
}

interface TemplateComponent {
  type: 'body';
  parameters: TemplateTextParameter[];
}

interface MetaResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; code?: number };
}

/**
 * Envia un mensaje usando un Meta Message Template aprobado.
 * Retorna true si el envio fue exitoso.
 */
async function sendTemplateMessage(
  to:            string,
  phoneNumberId: string,
  templateName:  string,
  components:    TemplateComponent[],
): Promise<boolean> {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name:     templateName,
        language: { code: 'es_MX' },
        components,
      },
    }),
  });

  if (!res.ok) {
    const data = await res.json() as MetaResponse;
    console.warn(`[template] '${templateName}' failed: ${data.error?.message ?? `HTTP ${res.status}`}`);
    return false;
  }

  return true;
}

/**
 * Envia un mensaje de texto libre (type: 'text').
 * Funciona dentro de la ventana de 24h. Falla con 131026 si >24h.
 */
async function sendFreeText(
  to:            string,
  body:          string,
  phoneNumberId: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
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
}

// ─── Template param builder ─────────────────────────────────────────────────

function params(...values: string[]): TemplateComponent {
  return {
    type:       'body',
    parameters: values.map((text) => ({ type: 'text' as const, text })),
  };
}

// ─── Build template components by notification type ─────────────────────────

/**
 * Construye los componentes del template a partir de metadata y datos del row.
 * Retorna null si no hay suficientes datos para el template.
 */
function buildTemplateComponents(
  type:         string,
  meta:         Record<string, string> | null,
  businessName: string,
  reviewUrl:    string | null,
): { templateName: string; components: TemplateComponent[] } | null {
  const templateName = TEMPLATE_NAMES[type];
  if (!templateName) return null;

  const customerName = meta?.customer_name || '';
  const serviceName  = meta?.service_name  || '';
  const staffName    = meta?.staff_name    || '';
  const timeStr      = meta?.time_str      || '';

  switch (type) {
    case 'reminder_24h':
    case 'reminder_2h':
    case 'reminder_1h':
      // Template: Hola {{1}}, ... cita de {{2}} con {{3}} a las {{4}} en {{5}}.
      if (!customerName || !serviceName || !staffName || !timeStr || !businessName) return null;
      return { templateName, components: [params(customerName, serviceName, staffName, timeStr, businessName)] };

    case 'follow_up':
      // Template: Hola {{1}}, gracias por tu visita a {{2}}. ...
      if (!customerName || !businessName) return null;
      return { templateName, components: [params(customerName, businessName)] };

    case 'review_request':
      // Template: Hola {{1}}, gracias por visitarnos en {{2}}. ... {{3}}
      if (!customerName || !businessName || !reviewUrl) return null;
      return { templateName, components: [params(customerName, businessName, reviewUrl)] };

    default:
      return null;
  }
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
      return `Hola, te recordamos tu proxima cita${businessName ? ` en ${businessName}` : ''}. Te esperamos!`;
    case 'follow_up':
      return `Hola, gracias por tu visita. Como te fue?`;
    case 'review_request':
      return `Hola, nos regalas tu opinion sobre tu cita?`;
    default:
      return `Tienes un mensaje de ${businessName ?? 'tu negocio'}.`;
  }
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'] as const;
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function formatDateSpanish(d: Date, tz: string): string {
  const localDate = d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const [, monthStr, dayStr] = localDate.split('-');
  const dayNum    = parseInt(dayStr!, 10);
  const dayOfWeek = new Date(localDate + 'T12:00:00Z').getDay();
  const monthIdx  = parseInt(monthStr!, 10) - 1;
  return `${DAYS_ES[dayOfWeek]} ${dayNum} de ${MONTHS_ES[monthIdx]}`;
}

function formatTimeHHMM(d: Date, tz: string): string {
  return d.toLocaleTimeString('es-MX', {
    timeZone: tz,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
}

// ─── handleWaitlistExpiry ─────────────────────────────────────────────────────

type WaitlistNotifRow = {
  id:          string;
  business_id: string;
  metadata:    Record<string, string> | null;
  businesses:  { whatsapp_phone_number_id: string; name: string } | null;
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

  if (!wlData) return;

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

  if (!nextData) return;

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

  // ── 5. Programar nueva expiracion heredando datos del slot ────────────────

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

  // ── 6. Enviar WhatsApp al siguiente — template primero, fallback texto ───

  const phoneNumberId = row.businesses?.whatsapp_phone_number_id;
  const businessName  = row.businesses?.name ?? '';
  if (!phoneNumberId) return;

  try {
    const slotDate    = new Date(metadata?.slot_starts_at ?? '');
    const validDate   = !isNaN(slotDate.getTime());
    const dateStr     = validDate ? formatDateSpanish(slotDate) : entry.requested_date;
    const timeStr     = validDate ? formatTimeHHMM(slotDate) : '';
    const staffName   = metadata?.slot_staff_name ?? 'tu barbero';
    const serviceName = next.service?.name ?? metadata?.service_name ?? 'tu servicio';
    const customerName = next.customer.name.trim().split(/\s+/)[0] ?? next.customer.name;

    // Intentar template primero
    const templateSent = await sendTemplateMessage(
      next.customer.phone,
      phoneNumberId,
      'waitlist_slot_available',
      [params(customerName, serviceName, dateStr, timeStr || '(por confirmar)', staffName)],
    );

    if (!templateSent) {
      // Fallback a texto libre
      const fallbackMsg =
        `Buenas noticias, ${customerName}! Se libero un lugar para ${serviceName} ` +
        `el ${dateStr}${timeStr ? ` a las ${timeStr}` : ''} con ${staffName}.\n` +
        `Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.`;
      await sendFreeText(next.customer.phone, fallbackMsg, phoneNumberId);
    }
  } catch (err) {
    console.error('[waitlist_expiry] WA send failed', err instanceof Error ? err.message : String(err));
  }
}

// ─── Send with template-first strategy ──────────────────────────────────────

/**
 * Intenta enviar via template aprobado. Si falla (template no aprobado o
 * faltan datos de metadata), cae al texto libre (message_body o fallback).
 */
async function sendWithTemplateFallback(
  customerPhone: string,
  phoneNumberId: string,
  type:          string,
  messageBody:   string | null,
  metadata:      Record<string, string> | null,
  businessName:  string,
  reviewUrl:     string | null,
): Promise<void> {
  // 1. Intentar template si hay datos suficientes
  const tmpl = buildTemplateComponents(type, metadata, businessName, reviewUrl);
  if (tmpl) {
    const sent = await sendTemplateMessage(customerPhone, phoneNumberId, tmpl.templateName, tmpl.components);
    if (sent) return; // exito con template
    console.warn(`[dispatch] template '${tmpl.templateName}' failed, falling back to free-text`);
  }

  // 2. Fallback a texto libre (message_body pre-construido o generico)
  const fallback = messageBody ?? buildFallbackMessage(type, businessName);
  await sendFreeText(customerPhone, fallback, phoneNumberId);
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
        timezone,
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
      timezone:                 string;
      review_url:               string | null;
    } | null;
  }>;

  const summary = {
    function:  'dispatch-lifestyle-notifications',
    timestamp: new Date().toISOString(),
    total:     0,
    sent:      0,
    failed:    0,
    skipped:   0,
    errors:    [] as string[],
  };

  try {
  for (const row of notifications) {
    summary.total++;
    // ── Claim atomico — idempotencia ────────────────────────────────────────
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

    // ── waitlist_expiry — logica de expiracion y re-notificacion ─────────
    if (row.type === 'waitlist_expiry') {
      try {
        await handleWaitlistExpiry(supabase, {
          id:          row.id,
          business_id: row.business_id,
          metadata:    row.metadata,
          businesses:  row.businesses
            ? { whatsapp_phone_number_id: row.businesses.whatsapp_phone_number_id, name: row.businesses.name }
            : null,
        });
        summary.sent++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[waitlist_expiry] unhandled error', errMsg);
        summary.failed++;
        if (summary.errors.length < 5) summary.errors.push(errMsg);
      }
      continue;
    }

    const phoneNumberId  = row.businesses?.whatsapp_phone_number_id ?? null;
    const businessName   = row.businesses?.name ?? '';
    const customerPhone  = row.customer_phone;

    // Sin telefono destino o sin credenciales -> fallo sin reintentar
    if (!customerPhone || !phoneNumberId) {
      await supabase
        .from('scheduled_notifications')
        .update({
          sent_at:   null,
          failed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      summary.failed++;
      if (summary.errors.length < 5) summary.errors.push(`missing_phone_or_id:${row.id}`);
      console.warn('[dispatch-lifestyle-notifications] missing phone or phoneNumberId', { id: row.id });
      continue;
    }

    try {
      await sendWithTemplateFallback(
        customerPhone,
        phoneNumberId,
        row.type,
        row.message_body,
        row.metadata,
        businessName,
        row.businesses?.review_url ?? null,
      );

      console.log('[dispatch-lifestyle-notifications] sent', {
        id:          row.id,
        type:        row.type,
        business_id: row.business_id,
      });
      summary.sent++;

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
      if (summary.errors.length < 5) summary.errors.push(errorMessage);
    }
  }

  console.log('[dispatch-lifestyle-notifications] done', summary);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
  } finally {
    console.log(`[CRON-SUMMARY] ${JSON.stringify(summary)}`);
    if (summary.failed > 0) {
      console.error(`[CRON-ALERT] ${summary.function}: ${summary.failed}/${summary.total} fallos`);
    }
  }
});
