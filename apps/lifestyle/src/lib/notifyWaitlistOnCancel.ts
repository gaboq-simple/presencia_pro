// ─── notifyWaitlistOnCancel ────────────────────────────────────────────────────
// Helper compartido: cuando se cancela una cita desde el panel (assistant-actions
// o PATCH /api/appointments), notifica al primer cliente en lista de espera que
// está esperando para la misma fecha.
//
// Best-effort — el llamador debe envolver en try/catch.
// Replicación intencional de la lógica de notifyWaitlist() del engine,
// necesaria porque los API routes de Next.js no pueden importar del engine
// directamente sin bundling.

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

const WL_DAYS   = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const WL_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function formatWlDate(isoStr: string, tz: string): string {
  const localDate = new Date(isoStr).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const [, monthStr, dayStr] = localDate.split('-');
  const dayNum    = parseInt(dayStr!, 10);
  const dayOfWeek = new Date(localDate + 'T12:00:00Z').getDay();
  const monthIdx  = parseInt(monthStr!, 10) - 1;
  return `${WL_DAYS[dayOfWeek]} ${dayNum} de ${WL_MONTHS[monthIdx]}`;
}

function formatWlTime(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleTimeString('es-MX', {
    timeZone: tz,
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  });
}

/**
 * Busca el primer cliente en lista de espera (status='waiting') para la fecha
 * del slot liberado y le notifica vía WhatsApp.
 *
 * Efectos:
 *   1. UPDATE waitlist SET status='notified', notified_at, expires_at (now+30min)
 *   2. INSERT scheduled_notifications type='waitlist_expiry'
 *   3. sendWhatsAppMeta al cliente — best-effort interno
 *
 * No lanza — el llamador debe envolver en try/catch best-effort.
 */
export async function notifyWaitlistOnCancel(
  supabase:     SupabaseClient,
  businessId:   string,
  slotStartsAt: string,   // ISO — hora del slot liberado
  slotStaffId:  string | null,
): Promise<void> {
  const slotDate = slotStartsAt.split('T')[0]!;

  // ── Buscar primer cliente en espera para esa fecha ────────────────────────

  const { data: wlData } = await supabase
    .from('waitlist')
    .select('id, customer:customer_id(id, name, phone), service:service_id(name)')
    .eq('business_id', businessId)
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

  await (supabase as any)
    .from('waitlist')
    .update({
      status:      'notified',
      notified_at: notifiedAt.toISOString(),
      expires_at:  expiresAt.toISOString(),
    })
    .eq('id', entry.id);

  // ── Obtener datos del negocio y nombre del staff en paralelo ──────────────

  const [bizResult, staffResult] = await Promise.all([
    supabase
      .from('businesses')
      .select('timezone, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle(),
    slotStaffId
      ? supabase.from('staff').select('name').eq('id', slotStaffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const biz           = bizResult.data as { timezone: string; whatsapp_phone_number_id: string } | null;
  const staffName     = (staffResult.data as { name: string } | null)?.name ?? '';
  const tz            = biz?.timezone ?? 'America/Mexico_City';
  const phoneNumberId = biz?.whatsapp_phone_number_id;

  // ── 2. Programar expiración ───────────────────────────────────────────────

  await (supabase as any).from('scheduled_notifications').insert({
    business_id:    businessId,
    type:           'waitlist_expiry',
    scheduled_for:  expiresAt.toISOString(),
    customer_phone: entry.customer.phone,
    customer_id:    entry.customer.id,
    metadata: {
      waitlist_id:     entry.id,
      slot_starts_at:  slotStartsAt,
      slot_staff_id:   slotStaffId ?? '',
      slot_staff_name: staffName,
      service_name:    entry.service?.name ?? '',
    },
  });

  // ── 3. Enviar WhatsApp — best-effort ──────────────────────────────────────

  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  if (!phoneNumberId || !accessToken) return;

  const serviceName = entry.service?.name ?? 'tu servicio';
  const dateStr     = formatWlDate(slotStartsAt, tz);
  const timeStr     = formatWlTime(slotStartsAt, tz);
  const staffLabel  = staffName ? ` con ${staffName}` : '';

  await sendWhatsAppMeta(
    {
      to:   entry.customer.phone,
      body:
        `Buenas noticias! Se libero un lugar para ${serviceName} ` +
        `el ${dateStr} a las ${timeStr}${staffLabel}. ` +
        `Lo tomamos? Responde SI en los proximos 30 minutos o el lugar se liberara.`,
    },
    { accessToken, phoneNumberId },
  );
}
