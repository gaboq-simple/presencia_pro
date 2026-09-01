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
import { tenantDb } from '@/lib/tenantDb';
import { sendWaitlistOffer, type MetaConfig } from '@/lib/whatsapp-templates';

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
 *   3. sendWaitlistOffer (template + fallback) al cliente — best-effort interno
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
  const db = tenantDb(supabase, businessId);

  // ── Buscar primer cliente en espera para esa fecha ────────────────────────

  const { data: wlData } = await db
    .table('waitlist')
    .select('id, customer:customer_id(id, name, phone), service:service_id(name)')
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

  // ── Obtener datos del negocio y nombre del staff en paralelo ──────────────

  const [bizResult, staffResult] = await Promise.all([
    supabase
      .from('businesses')
      .select('timezone, whatsapp_phone_number_id')
      .eq('id', businessId)
      .maybeSingle(),
    slotStaffId
      ? db.table('staff').select('name').eq('id', slotStaffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const biz           = bizResult.data as { timezone: string; whatsapp_phone_number_id: string } | null;
  const staffName     = (staffResult.data as { name: string } | null)?.name ?? '';
  const tz            = biz?.timezone ?? 'America/Mexico_City';
  const phoneNumberId = biz?.whatsapp_phone_number_id;

  // ── 1. Ofrecer el lugar por WhatsApp — el envío va PRIMERO ────────────────
  //
  // 🔴 El orden es la corrección (S9-OPS-08). Antes esta función marcaba
  //    `status='notified'` + `notified_at` y agendaba la expiración a 30 min
  //    ANTES de intentar el envío, y después descartaba el resultado. Como
  //    `sendWaitlistOffer` **nunca lanza** (devuelve `TemplateSendResult`, ver
  //    `whatsapp-templates.ts:65`), un rechazo de Meta dejaba a la persona
  //    marcada como avisada, sin haberse enterado de nada, y con su lugar
  //    liberado media hora después. Peor: el `return` por credenciales
  //    faltantes salía DESPUÉS de esas dos escrituras, así que sin WhatsApp
  //    configurado —el estado de hoy, con la WABA sin verificar— cada
  //    cancelación quemaba al primero de la lista en silencio.
  //
  //    `notified_at` afirma un hecho del mundo igual que `sent_at`: que a
  //    alguien se le avisó. Regla dura de CLAUDE.md — no se escribe sin
  //    evidencia de ese hecho. Ahora los tres campos se escriben sólo cuando
  //    el mensaje salió, y si no salió la persona **sigue en `waiting`**, que
  //    es la verdad: su lugar no se ofreció y la próxima cancelación puede
  //    volver a intentarlo.
  //
  //    Nota sobre concurrencia: el UPDATE temprano PARECÍA reservar la fila,
  //    pero no lo hacía — filtraba sólo por `.eq('id')`, sin guarda por
  //    `status`, así que dos cancelaciones simultáneas ya podían pisarse.
  //    Mover el UPDATE no quita una garantía; quita la apariencia de una.

  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];

  const serviceName  = entry.service?.name ?? 'tu servicio';
  const dateStr      = formatWlDate(slotStartsAt, tz);
  const timeStr      = formatWlTime(slotStartsAt, tz);
  const customerName = entry.customer.name.trim().split(/\s+/)[0] ?? entry.customer.name;

  let sent  = false;
  let error: string | null = null;

  if (!phoneNumberId || !accessToken) {
    error = 'WhatsApp no configurado (falta phone_number_id o access token)';
  } else {
    const config: MetaConfig = { phoneNumberId, accessToken };
    try {
      const result = await sendWaitlistOffer(
        config,
        entry.customer.phone,
        customerName,
        serviceName,
        dateStr,
        timeStr,
        staffName || 'tu barbero',
      );
      sent  = result.success;
      error = result.success ? null : (result.error ?? 'error sin detalle');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  if (!sent) {
    // Ruidoso, no mudo: una oferta que no salió es justo lo que nadie ve.
    // La entrada queda en `waiting` — sin `notified_at` y sin expiración.
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'waitlist',
      event:       'offer_send_failed',
      business_id: businessId,
      waitlist_id: entry.id,
      error,
    }));
    return;
  }

  // ── 2. El envío salió: recién ahora se escriben los hechos ────────────────

  const notifiedAt = new Date();
  const expiresAt  = new Date(notifiedAt.getTime() + 30 * 60_000);

  await db
    .table('waitlist')
    .update({
      status:      'notified',
      notified_at: notifiedAt.toISOString(),
      expires_at:  expiresAt.toISOString(),
    })
    .eq('id', entry.id);

  // ── 3. Programar expiración ───────────────────────────────────────────────
  // Sólo tiene sentido si la persona se enteró: la ventana de 30 min es el
  // tiempo que tiene para contestar, y no se le puede correr el reloj a quien
  // nunca recibió el mensaje.

  await db.table('scheduled_notifications').insert({
    type:           'waitlist_expiry',
    scheduled_for:  expiresAt.toISOString(),
    customer_phone: entry.customer.phone,
    customer_id:    entry.customer.id,
    // Sin `sent_at`: esta fila es la expiración FUTURA, no un mensaje que salió.
    // Marcarla como enviada sería la misma mentira que este paso corrige, y de
    // paso la escondería del despachador (que busca `sent_at IS NULL`).
    metadata: {
      waitlist_id:     entry.id,
      slot_starts_at:  slotStartsAt,
      slot_staff_id:   slotStaffId ?? '',
      slot_staff_name: staffName,
      service_name:    entry.service?.name ?? '',
    },
  });
}
