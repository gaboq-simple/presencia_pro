// ─── State: CONFIRMED ─────────────────────────────────────────────────────────
// El cliente confirmó la cita. Este handler:
//   1. Crea el appointment en Supabase con source='bot'.
//   2. Actualiza/crea el customer con favorite_staff_id y favorite_service_id.
//   3. Notifica al barbero asignado vía sendWhatsAppMeta() — best-effort (try/catch).
//   4. Inserta fila en scheduled_notifications para reminder_1h.
//   5. Genera mensaje de confirmación vía Claude.
//   6. Transiciona a estado CONFIRMED (conversación completa).

import Anthropic from '@anthropic-ai/sdk';
import { callClaude, TIMEOUT_HAIKU_MS } from '../claudeClient';
import { modelForTask } from '../modelRouter';
import type { LifestyleBotContext } from '../../../types/lifestyle.types';
import { sendWhatsAppMeta } from '../../../notifications/whatsapp';
import { tenantDb } from '../../../tenantDb';
import { getCatalog, getStaffForService } from '../catalog';
import { DAYS_ES, MONTHS_ES } from '../copy';
import { buildMicroCopySystemPrompt } from '../prompt';
import { logBot, maskPhone } from '../../../utils/logger';
import { formatTimeHumanFromDate } from '../utils';
import type { LifestyleIncomingMessage, StateHandlerDeps, StateHandlerResult } from '../types';

export async function handleConfirmed(
  msg: LifestyleIncomingMessage,
  context: LifestyleBotContext,
  deps: StateHandlerDeps,
): Promise<StateHandlerResult> {
  const { business, supabase, anthropicKey } = deps;

  if (!context.serviceId || !context.staffId || !context.selectedSlot) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: 'Hubo un problema al agendar. ¿Qué servicio te interesa?',
    };
  }

  // ── Cargar datos del servicio ─────────────────────────────────────────────

  const catalog  = await getCatalog(business.id, supabase);
  const service  = catalog.find((s) => s.id === context.serviceId);
  if (!service) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context, serviceId: undefined },
      responseText: 'No encontré el servicio. ¿Cuál quieres elegir?',
    };
  }

  const startsAt = new Date(context.selectedSlot);
  const endsAt   = new Date(startsAt.getTime() + service.duration_minutes * 60_000);

  // ── Guard "no agendar en el pasado" ───────────────────────────────────────
  // Autoridad estricta: aunque getDayAvailability ya no ofrece horas pasadas,
  // la hora elegida puede cruzar "ahora" entre el ofrecimiento y la confirmación
  // (cliente que demora en responder). Referencia de "ahora" = msg.timestamp:
  // el instante real en que llega esta confirmación, que es el reloj canónico
  // del bot (mismo que usa el guard de office_hours en handler.ts). Comparamos
  // instantes absolutos (epoch) → TZ-agnóstico. Si ya pasó, NO se inserta.
  if (startsAt.getTime() <= msg.timestamp.getTime()) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'past_slot_rejected',
      business_id:    business.id,
      customer_phone: maskPhone(msg.customerPhone),
      staff_id:       context.staffId,
      starts_at:      startsAt.toISOString(),
    }));
    return {
      newState:   'SHOWING_SLOTS',
      newContext: {
        ...context,
        selectedSlot: undefined,
        pendingSlots: [],
      },
      responseText: 'Esa hora ya pasó. Déjame buscarte el siguiente horario disponible.',
    };
  }

  // ── Pre-check: verificar que el slot sigue disponible ────────────────────
  // Defense in depth: el constraint de DB (016_no_overlapping_appointments)
  // es la última línea de defensa, pero este check previo evita un INSERT
  // fallido y permite dar un mensaje más preciso al cliente.
  //
  // Usamos gte/lte con starts_at y ends_at (solapamiento parcial):
  //   starts_at < endsAt AND ends_at > startsAt
  // Equivalente a: NOT (ends_at <= startsAt OR starts_at >= endsAt)

  const { data: slotConflict } = await tenantDb(supabase, business.id)
    .table('appointments')
    .select('id')
    .eq('staff_id', context.staffId)
    .not('status', 'in', '("cancelled")')
    .lt('starts_at', endsAt.toISOString())
    .gt('ends_at',   startsAt.toISOString())
    .limit(1)
    .maybeSingle();

  if (slotConflict) {
    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'slot_conflict_precheck',
      business_id:    business.id,
      customer_phone: maskPhone(msg.customerPhone),
      staff_id:       context.staffId,
      starts_at:      startsAt.toISOString(),
    }));
    return {
      newState:   'SHOWING_SLOTS',
      newContext: {
        ...context,
        selectedSlot: undefined,
        pendingSlots: [],
      },
      responseText: 'Ese horario se acaba de ocupar. ¿Quieres que te busque otra opción?',
    };
  }

  // ── Crear cita ────────────────────────────────────────────────────────────

  const { data: apptData, error: apptError } = await tenantDb(supabase, business.id)
    .table('appointments')
    .insert({
      staff_id:     context.staffId,
      service_id:   context.serviceId,
      customer_id:  context.customerId ?? null,
      starts_at:    startsAt.toISOString(),
      ends_at:      endsAt.toISOString(),
      status:       'confirmed',
      source:       context.isWalkIn ? 'walkin' : 'bot',
      booking_name: context.bookingName ?? null,
    })
    .select('id')
    .single();

  // Detectar violación del constraint de solapamiento (23P01) o unicidad (23505).
  // Aunque el pre-check reduce la probabilidad, el constraint es la garantía final.
  if (apptError) {
    const pgCode = (apptError as unknown as { code?: string }).code;
    if (pgCode === '23P01' || pgCode === '23505') {
      console.error(JSON.stringify({
        ts:             new Date().toISOString(),
        service:        'bot',
        event:          'slot_conflict_constraint',
        business_id:    business.id,
        customer_phone: maskPhone(msg.customerPhone),
        staff_id:       context.staffId,
        starts_at:      startsAt.toISOString(),
        pg_code:        pgCode,
      }));
      return {
        newState:   'SHOWING_SLOTS',
        newContext: {
          ...context,
          selectedSlot: undefined,
          pendingSlots: [],
        },
        responseText: 'Ese horario se acaba de ocupar. ¿Quieres que te busque otra opción?',
      };
    }

    console.error(JSON.stringify({
      ts:             new Date().toISOString(),
      service:        'bot',
      event:          'appointment_insert_failed',
      business_id:    business.id,
      customer_phone: maskPhone(msg.customerPhone),
      error:          apptError.message,
    }));
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: 'Hubo un error al agendar tu cita. Por favor intenta de nuevo o contáctanos directamente.',
    };
  }

  if (!apptData) {
    return {
      newState:     'QUALIFYING_SERVICE',
      newContext:   { ...context },
      responseText: 'Hubo un error al agendar tu cita. Por favor intenta de nuevo o contáctanos directamente.',
    };
  }

  const appointmentId = (apptData as { id: string }).id;

  // ── Actualizar customer con favoritos ─────────────────────────────────────

  if (context.customerId) {
    await tenantDb(supabase, business.id)
      .table('customers')
      .update({
        favorite_staff_id:   context.staffId,
        favorite_service_id: context.serviceId,
      })
      .eq('id', context.customerId);
  }

  // ── Programar reminders (24h, 2h, 1h) ───────────────────────────────────
  // Solo se insertan los que quedan en el futuro — evita reminders inútiles
  // para citas agendadas con menos de 24h de anticipación.

  // Cargar staff UNA VEZ — reutilizado para notificación al barbero y reminders
  const allStaffForAppt = await getStaffForService(business.id, context.serviceId, supabase);
  const staffMemberForAppt = allStaffForAppt.find((s) => s.id === context.staffId);

  const staffLabel = staffMemberForAppt ? ` con ${staffMemberForAppt.name}` : '';
  const timeLabel  = formatTimeHumanFromDate(startsAt, business.timezone);
  const customerFirstName = context.bookingName?.trim().split(/\s+/)[0] ?? '';

  // Metadata for template-based sending in the dispatcher
  const reminderMeta: Record<string, string> = {
    customer_name: customerFirstName,
    service_name:  service.name,
    staff_name:    staffMemberForAppt?.name ?? '',
    time_str:      timeLabel,
    business_name: business.name,
  };

  const now = Date.now();

  type NotifRow = {
    appointment_id: string;
    customer_phone: string;
    type:           string;
    scheduled_for:  string;
    message_body:   string;
    metadata?:      Record<string, string>;
  };

  const remindersToInsert: NotifRow[] = [];

  const at24h = new Date(startsAt.getTime() - 24 * 60 * 60_000);
  if (at24h.getTime() > now) {
    remindersToInsert.push({
      appointment_id: appointmentId,
      customer_phone: msg.customerPhone,
      type:           'reminder_24h',
      scheduled_for:  at24h.toISOString(),
      message_body:
        `Hola, mañana tienes cita de ${service.name}${staffLabel}` +
        ` a las ${timeLabel} en ${business.name}. ¡Te esperamos!`,
      metadata:       reminderMeta,
    });
  }

  const at2h = new Date(startsAt.getTime() - 2 * 60 * 60_000);
  if (at2h.getTime() > now) {
    remindersToInsert.push({
      appointment_id: appointmentId,
      customer_phone: msg.customerPhone,
      type:           'reminder_2h',
      scheduled_for:  at2h.toISOString(),
      message_body:
        `Hola, en 2 horas tienes cita de ${service.name}${staffLabel}` +
        ` a las ${timeLabel} en ${business.name}. ¡Te esperamos!`,
      metadata:       reminderMeta,
    });
  }

  const at1h = new Date(startsAt.getTime() - 1 * 60 * 60_000);
  if (at1h.getTime() > now) {
    remindersToInsert.push({
      appointment_id: appointmentId,
      customer_phone: msg.customerPhone,
      type:           'reminder_1h',
      scheduled_for:  at1h.toISOString(),
      message_body:
        `Hola, te recordamos tu cita de ${service.name}${staffLabel}` +
        ` hoy a las ${timeLabel} en ${business.name}.`,
      metadata:       reminderMeta,
    });
  }

  if (remindersToInsert.length > 0) {
    try {
      const { error: notifError } = await tenantDb(supabase, business.id)
        .table('scheduled_notifications')
        .insert(remindersToInsert);
      if (notifError) throw notifError;
    } catch (err) {
      // Best-effort — el appointment ya fue creado exitosamente. Solo loguear.
      console.error(JSON.stringify({
        ts:             new Date().toISOString(),
        service:        'bot',
        event:          'scheduled_notification_insert_failed',
        business_id:    business.id,
        appointment_id: appointmentId,
        types:          remindersToInsert.map((r) => r.type),
        error:          err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // ── Notificar al barbero — best-effort ────────────────────────────────────

  try {
    const staffMember = staffMemberForAppt;

    if (staffMember?.whatsapp_id) {
      const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'] ?? '';
      if (!accessToken) {
        console.warn(JSON.stringify({
          ts:          new Date().toISOString(),
          service:     'bot',
          event:       'whatsapp_token_missing',
          context:     'staff_notification',
          business_id: business.id,
        }));
      }
      const startTime = formatTimeHumanFromDate(startsAt, business.timezone);
      const dateStr   = formatDate(startsAt, business.timezone);
      const notifBody =
        `📅 Nueva cita agendada:\n` +
        `Servicio: ${service.name}\n` +
        `Fecha: ${dateStr} a las ${startTime}\n` +
        `Desde: ${business.name} Bot`;

      await sendWhatsAppMeta(
        { to: staffMember.whatsapp_id, body: notifBody },
        {
          accessToken,
          phoneNumberId: business.whatsappPhoneNumberId,
        },
      );
    }
  } catch {
    // Best-effort — no bloquear el flujo si la notificación falla
  }

  // ── Generar mensaje de confirmación vía Claude ────────────────────────────

  const tz           = business.timezone;
  const staffName    = staffMemberForAppt?.name ?? 'tu barbero';
  const startTimeStr = formatTimeHumanFromDate(startsAt, tz);
  const dateStr      = formatDate(startsAt, tz);

  // Primer nombre del booking_name para el saludo final ("Listo, Gabriel!")
  const firstName = context.bookingName
    ? (context.bookingName.trim().split(/\s+/)[0] ?? null)
    : null;

  const confirmationText = await generateConfirmation(
    anthropicKey,
    // System corto: todos los datos de la cita viajan en el user prompt — el
    // system completo de 7 pasos + catálogo era ruido para redactar 4 líneas.
    buildMicroCopySystemPrompt(business),
    service.name,
    staffName,
    dateStr,
    startTimeStr,
    business.name,
    business.address,
    modelForTask('micro_copy'),
    business.id,
    msg.customerPhone,
    firstName,
  );

  const newContext: LifestyleBotContext = {
    ...context,
    appointmentId,
    followUpScheduled: true,
    pendingSlots:      [],
  };

  return {
    newState:     'CONFIRMED',
    newContext,
    responseText: confirmationText,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// DAYS_ES/MONTHS_ES viven en copy.ts (AUD-06).

function formatDate(d: Date, tz: string): string {
  const localDateStr = d.toLocaleDateString('en-CA', { timeZone: tz });  // YYYY-MM-DD
  const [, , dayStr] = localDateStr.split('-');
  const dayNum     = parseInt(dayStr!, 10);
  const dayOfWeek  = new Date(localDateStr + 'T12:00:00Z').getDay();
  const monthIdx   = parseInt(localDateStr.split('-')[1]!, 10) - 1;
  return `${DAYS_ES[dayOfWeek]} ${dayNum} de ${MONTHS_ES[monthIdx]}`;
}

async function generateConfirmation(
  apiKey:        string,
  system:        string,
  serviceName:   string,
  staffName:     string,
  dateStr:       string,
  timeStr:       string,
  businessName:  string,
  address:       string,
  model:         string,
  businessId:    string,
  customerPhone: string,
  firstName:     string | null,
): Promise<string> {
  const nameNote = firstName
    ? `- Nombre del cliente: ${firstName} — empieza el mensaje con "¡Listo, ${firstName}!"`
    : '- Empieza el mensaje con "¡Listo!"';

  const prompt =
    `La cita quedó confirmada. Genera un mensaje de confirmación corto y amigable con estos datos:\n` +
    `${nameNote}\n` +
    `- Servicio: ${serviceName}\n` +
    `- Barbero: ${staffName}\n` +
    `- Fecha: ${dateStr}\n` +
    `- Hora: ${timeStr}\n` +
    `- Negocio: ${businessName}\n` +
    `- Dirección: ${address}\n\n` +
    `Incluye un recordatorio de dónde está el negocio. Máximo 4 líneas. Sin markdown. Ortografía correcta: acentos y signos de apertura (¿ ¡).`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await callClaude({
      client,
      model,
      maxTokens: 200,
      system,
      messages:  [{ role: 'user', content: prompt }],
      timeoutMs: TIMEOUT_HAIKU_MS,
      context:   { businessId, customerPhone, state: 'CONFIRMED' },
    });

    logBot({
      ts:                new Date().toISOString(),
      service:           'bot',
      business_id:       businessId,
      customer_phone:    customerPhone,
      state_from:        'AWAITING_BOOKING_NAME',
      state_to:          'CONFIRMED',
      model_used:        model,
      tokens_input:      resp.usage.input_tokens,
      tokens_cache_read: resp.usage.cache_read_input_tokens ?? 0,
      tokens_output:     resp.usage.output_tokens,
    });

    const block = resp.content[0];
    return block?.type === 'text' ? block.text.trim() : buildFallbackConfirmation(serviceName, staffName, dateStr, timeStr, firstName);
  } catch {
    return buildFallbackConfirmation(serviceName, staffName, dateStr, timeStr, firstName);
  }
}

function buildFallbackConfirmation(
  service:    string,
  staff:      string,
  date:       string,
  time:       string,
  firstName:  string | null,
): string {
  const greeting = firstName ? `Listo, ${firstName}!` : 'Listo!';
  return `${greeting} Tu cita de ${service} con ${staff} está confirmada para el ${date} a las ${time}. ¡Te esperamos!`;
}
