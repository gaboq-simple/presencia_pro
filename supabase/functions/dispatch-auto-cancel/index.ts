// ─── dispatch-auto-cancel ─────────────────────────────────────────────────────
// Edge Function (Deno). Marca como no_show las citas confirmadas que superaron
// el umbral de auto_cancel_after_minutes sin que el cliente llegara.
//
// Trigger: cron cada minuto — configura en Supabase Dashboard → Edge Functions → Schedule
//   Cron: * * * * *
//
// Lógica por cita:
//   1. deadline = COALESCE(adjusted_starts_at, starts_at) + auto_cancel_after_minutes
//   2. Si deadline < NOW() y status = 'confirmed' → marcar no_show (atomic guard)
//   3. Cancelar scheduled_notifications pendientes del appointment_id
//   4. Notificar waitlist: primer cliente en espera para esa fecha (best-effort)
//
// El trigger trg_update_visit_stats (migration 030) se encarga de incrementar
// noshow_count y evaluar is_flagged en customers automáticamente.
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

interface OverdueAppointment {
  id:                      string;
  staff_id:                string;
  starts_at:               string;
  adjusted_starts_at:      string | null;
  customer_id:             string | null;
  business_id:             string;
  auto_cancel_after_minutes: number;
  timezone:                string;
  whatsapp_phone_number_id: string | null;
}

// ─── Meta WhatsApp Cloud API ──────────────────────────────────────────────────

async function sendWhatsAppMeta(
  to:            string,
  body:          string,
  phoneNumberId: string,
): Promise<void> {
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
}

// ─── Template sending ─────────────────────────────────────────────────────────
// Replica el patrón de whatsapp-templates.ts para uso en Deno (sin imports Next.js).
//
// ⚠️  Registrar en Meta Business Manager antes del go-live:
//
// Template: staff_noshow_alert
//   Idioma:    Español (México) — es_MX | Categoría: UTILITY
//   Cuerpo:    "{{1}} no se presentó a su cita de {{2}} a las {{3}}."
//   Variables: {{1}} nombre del cliente | {{2}} nombre del servicio | {{3}} hora de la cita
//
// Template: waitlist_slot_available  (ya documentado en WHATSAPP-TEMPLATES.md)

const TEMPLATE_WAITLIST_SLOT_AVAILABLE = 'waitlist_slot_available';
const TEMPLATE_STAFF_NOSHOW_ALERT      = 'staff_noshow_alert';

async function sendMetaTemplate(
  phoneNumberId: string,
  to:            string,
  templateName:  string,
  bodyParams:    string[],
): Promise<{ success: boolean; error?: string }> {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:       templateName,
          language:   { code: 'es_MX' },
          components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }],
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Meta ${res.status}: ${errText}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendWithFallback(
  phoneNumberId: string,
  to:            string,
  templateName:  string,
  bodyParams:    string[],
  fallbackText:  string,
): Promise<{ success: boolean; usedFallback?: boolean; error?: string }> {
  const tmpl = await sendMetaTemplate(phoneNumberId, to, templateName, bodyParams);
  if (tmpl.success) return tmpl;

  console.warn(
    `[dispatch-auto-cancel] template '${templateName}' failed (${tmpl.error}), trying free-text fallback`,
  );

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: fallbackText } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, usedFallback: true, error: `Fallback Meta ${res.status}: ${errText}` };
    }
    return { success: true, usedFallback: true };
  } catch (err) {
    return { success: false, usedFallback: true, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

const DAYS_ES   = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function formatDateSpanish(isoStr: string, tz: string): string {
  const localDate = new Date(isoStr).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const [, monthStr, dayStr] = localDate.split('-');
  const dayNum    = parseInt(dayStr!, 10);
  const dayOfWeek = new Date(localDate + 'T12:00:00Z').getDay();
  const monthIdx  = parseInt(monthStr!, 10) - 1;
  return `${DAYS_ES[dayOfWeek]} ${dayNum} de ${MONTHS_ES[monthIdx]}`;
}

function formatTimeSpanish(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleTimeString('es-MX', {
    timeZone: tz,
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  });
}

// ─── notifyWaitlist ───────────────────────────────────────────────────────────
// Busca el primer cliente en lista de espera (status='waiting') para la fecha
// del slot liberado. Replica la lógica de notifyWaitlistOnCancel de Next.js.
// Best-effort — el llamador debe envolver en try/catch.

async function notifyWaitlist(
  supabase:    ReturnType<typeof createClient>,
  appt:        OverdueAppointment,
): Promise<void> {
  const slotStartsAt = appt.adjusted_starts_at ?? appt.starts_at;
  const slotDate     = slotStartsAt.split('T')[0]!;

  // ── Buscar primer cliente en espera para esa fecha ────────────────────────

  const { data: wlData } = await supabase
    .from('waitlist')
    .select('id, customer:customer_id(id, name, phone), service:service_id(name)')
    .eq('business_id', appt.business_id)
    .eq('requested_date', slotDate)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!wlData) return;

  const entry = wlData as unknown as {
    id:       string;
    customer: { id: string; name: string; phone: string } | null;
    service:  { name: string } | null;
  };

  if (!entry.customer) return;

  const notifiedAt = new Date();
  const expiresAt  = new Date(notifiedAt.getTime() + 30 * 60_000);

  // ── 1. Marcar como notificado ─────────────────────────────────────────────

  await supabase
    .from('waitlist')
    .update({
      status:      'notified',
      notified_at: notifiedAt.toISOString(),
      expires_at:  expiresAt.toISOString(),
    })
    .eq('id', entry.id);

  // ── Obtener nombre del staff (best-effort) ────────────────────────────────

  let staffName = '';
  if (appt.staff_id) {
    const { data: staffData } = await supabase
      .from('staff')
      .select('name')
      .eq('id', appt.staff_id)
      .maybeSingle();
    staffName = (staffData as { name: string } | null)?.name ?? '';
  }

  // ── 2. Programar expiración ───────────────────────────────────────────────

  await supabase.from('scheduled_notifications').insert({
    business_id:    appt.business_id,
    type:           'waitlist_expiry',
    scheduled_for:  expiresAt.toISOString(),
    customer_phone: entry.customer.phone,
    customer_id:    entry.customer.id,
    metadata: {
      waitlist_id:     entry.id,
      slot_starts_at:  slotStartsAt,
      slot_staff_id:   appt.staff_id ?? '',
      slot_staff_name: staffName,
      service_name:    entry.service?.name ?? '',
    },
  });

  // ── 3. Enviar WhatsApp — best-effort ──────────────────────────────────────

  const phoneNumberId = appt.whatsapp_phone_number_id;
  if (!phoneNumberId || !WHATSAPP_ACCESS_TOKEN) return;

  const serviceName = entry.service?.name ?? 'tu servicio';
  const dateStr     = formatDateSpanish(slotStartsAt, appt.timezone);
  const timeStr     = formatTimeSpanish(slotStartsAt, appt.timezone);
  const staffLabel  = staffName ? ` con ${staffName}` : '';

  const wlResult = await sendWithFallback(
    phoneNumberId,
    entry.customer.phone,
    TEMPLATE_WAITLIST_SLOT_AVAILABLE,
    [entry.customer.name, serviceName, dateStr, timeStr, staffName || 'disponible'],
    `Buenas noticias, ${entry.customer.name}! Se libero un lugar para ${serviceName} ` +
    `el ${dateStr} a las ${timeStr}${staffLabel}. ` +
    `Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.`,
  );
  if (!wlResult.success) {
    console.error('[dispatch-auto-cancel] notifyWaitlist WA send failed', {
      appointment_id: appt.id,
      customer_phone: entry.customer.phone,
      error:          wlResult.error,
    });
  }
}

// ─── processAppointment ───────────────────────────────────────────────────────
// Procesa una cita vencida: marca no_show, cancela reminders, notifica waitlist.
// Retorna true si se marcó no_show, false si fue reclamada por otra instancia.

async function processAppointment(
  supabase: ReturnType<typeof createClient>,
  appt:     OverdueAppointment,
): Promise<boolean> {
  // ── 1. Atomic guard — solo marcar si sigue 'confirmed' ───────────────────

  const { data: updated } = await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', appt.id)
    .eq('status', 'confirmed')
    .select('id');

  if (!updated || updated.length === 0) return false; // ya procesada

  // ── 2. Cancelar scheduled_notifications pendientes ────────────────────────
  // Marca failed_at para que el dispatcher no las envíe.

  await supabase
    .from('scheduled_notifications')
    .update({ failed_at: new Date().toISOString() })
    .eq('appointment_id', appt.id)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── 3. Notificar waitlist — best-effort ───────────────────────────────────

  try {
    await notifyWaitlist(supabase, appt);
  } catch (err) {
    console.error('[dispatch-auto-cancel] notifyWaitlist failed', {
      appointment_id: appt.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Notificar al staff — no-show alert (best-effort) ───────────────────

  if (appt.whatsapp_phone_number_id && WHATSAPP_ACCESS_TOKEN) {
    try {
      const { data: apptDetails } = await supabase
        .from('appointments')
        .select(`
          staff:staff_id(name, whatsapp_id),
          customer:customer_id(name),
          service:service_id(name)
        `)
        .eq('id', appt.id)
        .maybeSingle();

      const details = apptDetails as {
        staff:    { name: string; whatsapp_id: string } | null;
        customer: { name: string } | null;
        service:  { name: string } | null;
      } | null;

      const staffPhone   = details?.staff?.whatsapp_id;
      const customerName = details?.customer?.name ?? 'El cliente';
      const serviceName  = details?.service?.name  ?? 'la cita';
      const apptTime     = formatTimeSpanish(appt.adjusted_starts_at ?? appt.starts_at, appt.timezone);

      if (staffPhone) {
        const result = await sendWithFallback(
          appt.whatsapp_phone_number_id,
          staffPhone,
          TEMPLATE_STAFF_NOSHOW_ALERT,
          [customerName, serviceName, apptTime],
          `${customerName} no se presento a su cita de ${serviceName} a las ${apptTime}.`,
        );
        if (!result.success) {
          console.error('[dispatch-auto-cancel] staff noshow alert failed', {
            appointment_id: appt.id,
            staff_phone:    staffPhone,
            error:          result.error,
          });
        }
      }
    } catch (err) {
      console.error('[dispatch-auto-cancel] staff noshow alert error', {
        appointment_id: appt.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return true;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Buscar citas confirmadas cuyo deadline ya pasó ───────────────────────
  // deadline = COALESCE(adjusted_starts_at, starts_at) + auto_cancel_after_minutes
  // Se usa una RPC/SQL directo porque Supabase JS no soporta expresiones
  // aritméticas de intervalo en filtros — se hace con execute_sql vía postgrest.
  //
  // Alternativa portable: query amplio + filtrar en JS.
  // Usamos el filtro en JS para evitar depender de RPC custom.
  //
  // Ventana de búsqueda: citas que empezaron en los últimos 24h
  // (evita escanear toda la tabla; auto_cancel_after_minutes max razonable = 120).

  const windowStart = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const now         = new Date();

  const { data: rows, error: fetchError } = await supabase
    .from('appointments')
    .select(`
      id,
      staff_id,
      starts_at,
      adjusted_starts_at,
      customer_id,
      business_id,
      businesses (
        auto_cancel_after_minutes,
        timezone,
        whatsapp_phone_number_id
      )
    `)
    .eq('status', 'confirmed')
    .gte('starts_at', windowStart)
    .lte('starts_at', now.toISOString());

  if (fetchError) {
    console.error('[dispatch-auto-cancel] fetch error:', fetchError.message);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  const appointments = (rows ?? []) as unknown as Array<{
    id:                 string;
    staff_id:           string;
    starts_at:          string;
    adjusted_starts_at: string | null;
    customer_id:        string | null;
    business_id:        string;
    businesses: {
      auto_cancel_after_minutes: number;
      timezone:                  string;
      whatsapp_phone_number_id:  string | null;
    } | null;
  }>;

  // ── Filtrar en JS: solo las que superaron el deadline ────────────────────

  const overdue: OverdueAppointment[] = [];

  for (const row of appointments) {
    if (!row.businesses) continue;

    const baseTime   = row.adjusted_starts_at ?? row.starts_at;
    const deadline   = new Date(new Date(baseTime).getTime()
      + row.businesses.auto_cancel_after_minutes * 60_000);

    if (deadline < now) {
      overdue.push({
        id:                        row.id,
        staff_id:                  row.staff_id,
        starts_at:                 row.starts_at,
        adjusted_starts_at:        row.adjusted_starts_at,
        customer_id:               row.customer_id,
        business_id:               row.business_id,
        auto_cancel_after_minutes: row.businesses.auto_cancel_after_minutes,
        timezone:                  row.businesses.timezone,
        whatsapp_phone_number_id:  row.businesses.whatsapp_phone_number_id,
      });
    }
  }

  const summary = {
    function:  'dispatch-auto-cancel',
    timestamp: new Date().toISOString(),
    total:     0,
    sent:      0,
    failed:    0,
    skipped:   0,
    errors:    [] as string[],
  };

  try {
  for (const appt of overdue) {
    summary.total++;
    try {
      const marked = await processAppointment(supabase, appt);
      if (marked) {
        summary.sent++;
        console.log('[dispatch-auto-cancel] marked no_show', {
          appointment_id: appt.id,
          business_id:    appt.business_id,
        });
      } else {
        summary.skipped++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      summary.failed++;
      if (summary.errors.length < 5) summary.errors.push(errMsg);
      console.error('[dispatch-auto-cancel] processAppointment error', {
        appointment_id: appt.id,
        error:          errMsg,
      });
    }
  }

  console.log('[dispatch-auto-cancel] done', summary);
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
