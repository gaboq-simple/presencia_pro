// ─── Assistant Server Actions ──────────────────────────────────────────────────
// Mutaciones y fetches de citas desde la vista del asistente.
// Requieren sesión con role='assistant' | 'owner' | 'admin' | 'barber'.
//
// REGLA: service_role_key y getCurrentSession nunca salen al cliente.

'use server';

import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { getDayAppointments, localDayRangeUtc } from '@/lib/dashboard.types';
import type { DashboardAppointment } from '@/lib/dashboard.types';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';
import { notifyWaitlistOnCancel } from '@/lib/notifyWaitlistOnCancel';
import {
  sendCancellationNotice,
  sendRescheduleNotice,
  type MetaConfig,
} from '@/lib/whatsapp-templates';

// ─── Service client ───────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Helper de autorización ───────────────────────────────────────────────────

/**
 * Verifica sesión válida para la vista del asistente.
 * Acepta: assistant, owner, admin, barber.
 * Las sesiones de organización no aplican — el owner accede con token de sucursal.
 * Devuelve business_id, role y staff_id (para trazabilidad — Feature 5).
 */
async function requireAssistantSession(): Promise<{
  business_id: string;
  role: string;
  staff_id: string | null;
}> {
  const session = await getCurrentSession();
  if (!session) throw new Error('Unauthorized');
  if (session.type === 'organization') throw new Error('Forbidden');
  return {
    business_id: session.business_id,
    role: session.role,
    staff_id: session.staff_id,
  };
}

/**
 * Gate 2b — "solo mis citas". Si el actor es barbero, exige que la cita a mutar sea
 * suya; si no, Forbidden. Recepción/dueño (role !== 'barber') o token sin staff_id →
 * no-op (sin restricción — protege a la recepcionista). Mismo patrón que
 * updateAppointmentStatusAsBarber (staff/actions.ts): fetch + compare + rechazo.
 */
async function assertBarberOwnsAppointment(
  supabase: ReturnType<typeof getServiceClient>,
  session: { role: string; staff_id: string | null; business_id: string },
  appointmentId: string,
): Promise<{ error?: string } | void> {
  if (session.role !== 'barber' || !session.staff_id) return;
  const { data, error } = await supabase
    .from('appointments')
    .select('staff_id')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();
  // Mensajes de cara al usuario → return { error } (no se redactan en prod, a
  // diferencia de un throw). El gate 2b es informativo, no filtra nada sensible.
  if (error || !data) return { error: 'Cita no encontrada' };
  if ((data as { staff_id: string | null }).staff_id !== session.staff_id) {
    return { error: 'Solo puedes modificar tus propias citas' };
  }
}

// ─── Refresh — todas las citas del negocio para un día ───────────────────────

/**
 * Recarga las citas del negocio para el día dado.
 * Llamado desde AssistantLayout para polling periódico y post-mutación.
 */
export async function refreshAssistantAppointments(
  date: string,
): Promise<DashboardAppointment[]> {
  const session = await requireAssistantSession();
  return getDayAppointments(session.business_id, date);
}

// ─── Cancelar cita con razón ──────────────────────────────────────────────────

/**
 * Cancela una cita y opcionalmente guarda la razón en notes.
 * Verifica que la cita pertenece al negocio de la sesión activa.
 */
export async function cancelAppointment(
  appointmentId: string,
  reason: string,
): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status, starts_at, customer_id, staff_id')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'cancelled') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({
      status:               'cancelled',
      notes:                reason.trim() || null,
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`cancelAppointment failed: ${error.message}`);

  // Cancelar recordatorios pendientes — best-effort, no interrumpe el flujo
  await supabase
    .from('scheduled_notifications')
    .update({ failed_at: new Date().toISOString() })
    .eq('appointment_id', appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── Notificar al cliente por WhatsApp — best-effort ────────────────────
  try {
    const apptRow = existing as unknown as {
      id: string;
      business_id: string;
      status: string;
      starts_at: string;
      customer_id: string | null;
      staff_id: string | null;
    };

    let customerPhone: string | null = null;
    let customerName:  string | null = null;
    if (apptRow.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('phone, name')
        .eq('id', apptRow.customer_id)
        .maybeSingle();
      const c = cust as { phone: string | null; name: string } | null;
      customerPhone = c?.phone ?? null;
      customerName  = c?.name  ?? null;
    }

    if (customerPhone) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('timezone, whatsapp_phone_number_id, name')
        .eq('id', session.business_id)
        .maybeSingle();
      const b             = biz as { timezone: string; whatsapp_phone_number_id: string; name: string } | null;
      const tz            = b?.timezone ?? 'America/Mexico_City';
      const phoneNumberId = b?.whatsapp_phone_number_id;
      const accessToken   = process.env['WHATSAPP_ACCESS_TOKEN'];
      const businessName  = b?.name ?? '';

      if (phoneNumberId && accessToken) {
        const config: MetaConfig = { phoneNumberId, accessToken };
        const dateStr  = formatApptDate(apptRow.starts_at, tz);
        const timeStr  = formatApptTime(apptRow.starts_at, tz);
        const firstName = customerName ? customerName.split(' ')[0]! : '';

        await sendCancellationNotice(
          config,
          customerPhone,
          firstName,
          dateStr,
          timeStr,
          businessName,
        );

        const now = new Date().toISOString();
        await supabase
          .from('scheduled_notifications')
          .insert({
            business_id:    session.business_id,
            appointment_id: appointmentId,
            customer_phone: customerPhone,
            type:           'cancellation_notice',
            scheduled_for:  now,
            sent_at:        now,
          });
      }
    }
  } catch {
    // best-effort — la cancelación ya fue exitosa
  }

  // ── Notificar waitlist si hay clientes en espera para ese slot — best-effort
  try {
    const row = existing as unknown as { starts_at: string; staff_id: string | null };
    await notifyWaitlistOnCancel(supabase, session.business_id, row.starts_at, row.staff_id ?? null);
  } catch {
    // best-effort — la cancelación ya fue exitosa
  }
}

// ─── Actualizar notas inline ──────────────────────────────────────────────────

/**
 * Guarda las notas operativas de una cita.
 */
export async function updateAppointmentNotes(
  appointmentId: string,
  notes: string,
): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { error } = await supabase
    .from('appointments')
    .update({
      notes:                notes.trim() || null,
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`updateAppointmentNotes failed: ${error.message}`);
}

// ─── Completar cita ───────────────────────────────────────────────────────────

export async function completeAppointment(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'completed') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({
      status:               'completed',
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`completeAppointment failed: ${error.message}`);
}

// ─── Registrar no-show ────────────────────────────────────────────────────────

export async function noShowAppointment(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'no_show') return; // idempotente

  const { error } = await supabase
    .from('appointments')
    .update({
      status:               'no_show',
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`noShowAppointment failed: ${error.message}`);
}

// ─── Crear cita rápida ────────────────────────────────────────────────────────

type CreateAppointmentInput = {
  staffId:       string;
  serviceId:     string;
  startsAt:      string;  // ISO 8601 con offset
  endsAt:        string;  // ISO 8601 con offset
  source:        'walkin' | 'llamada' | 'manual';
  notes?:        string;
  customerName:  string;  // requerido — Feature 1
  customerPhone?: string; // opcional — Feature 1
  force?:        boolean;  // recepción FUERZA un solape intencional (S6-UI-02 PR-4):
                           // marca allow_overlap=true. Solo el panel del asistente lo pasa
                           // (requireAssistantSession) → el bot nunca puede forzar.
};

/**
 * Crea una nueva cita desde la vista del asistente.
 *
 * · business_id siempre del servidor.
 * · Si customerPhone: busca customer por (business_id, phone); si no existe, lo crea.
 * · Si solo customerName: busca por nombre exacto (ILIKE); si no existe, crea sin teléfono.
 * · Registra created_by_staff_id cuando la sesión es de barbero.
 * · Si el cliente tiene is_flagged=true, retorna warning con conteo de no-shows.
 */
export async function createAssistantAppointment(
  input: CreateAppointmentInput,
): Promise<{ id?: string; warning?: string; error?: string }> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // ── Gate de staff_id (REGLA DURA, seguridad) ─────────────────────────────
  // El barbero solo puede crear citas asignadas a SÍ MISMO: ignoramos el
  // input.staffId del cliente y forzamos su propio staff_id. Recepcionista /
  // owner / admin (y sesiones por token con staff_id null) conservan la
  // capacidad de asignar a cualquier barbero. Mismo predicado que el resto del
  // sistema de control (role==='barber' && staff_id presente).
  const isBarber = session.role === 'barber' && !!session.staff_id;
  const effectiveStaffId = isBarber ? session.staff_id! : input.staffId;

  // ── Config del negocio (controles de creación — migración 044) ───────────
  const { data: bizCfgRaw } = await supabase
    .from('businesses')
    .select('require_customer_phone, max_appointments_per_staff_per_day')
    .eq('id', session.business_id)
    .maybeSingle();
  const bizCfg = bizCfgRaw as {
    require_customer_phone: boolean;
    max_appointments_per_staff_per_day: number;
  } | null;

  // ── Customer lookup / create ─────────────────────────────────────────────
  let customerId: string | null = null;
  let customerWarning: string | undefined;
  const name  = input.customerName.trim();
  const phone = input.customerPhone?.trim() || null;

  // ── Nombre obligatorio (defensa en profundidad de la liga cita↔cliente) ──
  // Sin nombre no hay cliente al que ligar la cita → sin este guard, un caller
  // programático (o un bug de UI) crearía una cita con customer_id null, que el
  // detector de fugas del dashboard nunca vería. La UI ya lo valida; esto lo
  // asegura también a nivel action.
  if (!name) {
    // Validación de cara al usuario → return (los throw se redactan en prod).
    return { error: 'El nombre del cliente es obligatorio para agendar' };
  }

  // ── Teléfono obligatorio (política de negocio configurable) ──────────────
  // Si el negocio activó require_customer_phone, toda alta manual (cualquier
  // rol — barbero Y recepcionista) exige teléfono del cliente. Default FALSE →
  // preserva el walk-in con solo-nombre. Chequeo ANTES de crear cliente/cita.
  if ((bizCfg?.require_customer_phone ?? false) && !phone) {
    // Validación de cara al usuario → return (los throw se redactan en prod).
    return { error: 'Este negocio requiere el teléfono del cliente para agendar' };
  }

  // ── Tope suave de citas/día por barbero (anti-inflado grosero) ───────────
  // Solo barbero. Cuenta sus citas NO canceladas del día destino; si alcanza el
  // tope configurable (businesses.max_appointments_per_staff_per_day, default 20),
  // rechaza ANTES de crear cliente/cita. NOTA: el tope frena el inflado GROSERO
  // (decenas de citas falsas), NO el fino (ej. tope-1/día) — eso lo cubre el
  // audit trail visible (fase posterior). Es complemento, no reemplazo.
  if (isBarber) {
    const maxPerStaffPerDay = bizCfg?.max_appointments_per_staff_per_day ?? 20;
    const day = input.startsAt.slice(0, 10); // YYYY-MM-DD (misma convención que getDayAppointments)
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', effectiveStaffId)
      .neq('status', 'cancelled')
      .gte('starts_at', `${day}T00:00:00`)
      .lte('starts_at', `${day}T23:59:59`);
    if ((count ?? 0) >= maxPerStaffPerDay) {
      // Validación de cara al usuario → return (los throw se redactan en prod).
      return { error: 'Alcanzaste el máximo de citas para ese día, contacta al admin' };
    }
  }

  if (name) {
    if (phone) {
      // Buscar por teléfono — identificador canónico
      const { data: existing } = await supabase
        .from('customers')
        .select('id, noshow_count, is_flagged')
        .eq('business_id', session.business_id)
        .eq('phone', phone)
        .maybeSingle();

      if (existing) {
        const row = existing as { id: string; noshow_count: number; is_flagged: boolean };
        customerId = row.id;
        if (row.is_flagged) {
          customerWarning = `Este cliente tiene ${row.noshow_count} no-show${row.noshow_count !== 1 ? 's' : ''} registrado${row.noshow_count !== 1 ? 's' : ''}`;
        }
      } else {
        const { data: created } = await supabase
          .from('customers')
          .insert({
            business_id:   session.business_id,
            name,
            phone,
            consent_at:    new Date().toISOString(),
            consented_via: 'manual_registration',
          })
          .select('id')
          .single();
        customerId = (created as { id: string } | null)?.id ?? null;
      }
    } else {
      // Solo nombre: buscar por nombre exacto (less reliable)
      const { data: existing } = await supabase
        .from('customers')
        .select('id, noshow_count, is_flagged')
        .eq('business_id', session.business_id)
        .ilike('name', name)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const row = existing as { id: string; noshow_count: number; is_flagged: boolean };
        customerId = row.id;
        if (row.is_flagged) {
          customerWarning = `Este cliente tiene ${row.noshow_count} no-show${row.noshow_count !== 1 ? 's' : ''} registrado${row.noshow_count !== 1 ? 's' : ''}`;
        }
      } else {
        // Crear sin teléfono (phone es nullable desde migration 023)
        const { data: created } = await supabase
          .from('customers')
          .insert({
            business_id:   session.business_id,
            name,
            phone:         null,
            consent_at:    new Date().toISOString(),
            consented_via: 'manual_registration',
          })
          .select('id')
          .single();
        customerId = (created as { id: string } | null)?.id ?? null;
      }
    }
  }

  // ── Insertar cita ─────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      business_id:          session.business_id,
      staff_id:             effectiveStaffId,
      service_id:           input.serviceId,
      customer_id:          customerId,
      starts_at:            input.startsAt,
      ends_at:              input.endsAt,
      status:               'confirmed',
      source:               input.source,
      notes:                input.notes?.trim() || null,
      created_by_staff_id:  session.staff_id,
      // Solo un solape FORZADO conscientemente por la recepción queda exento del
      // constraint. El bot no llega acá (requireAssistantSession) → nunca fuerza.
      allow_overlap:        input.force === true,
    })
    .select('id')
    .single();

  if (error) {
    // Solape sin forzar (23P01) → mensaje de cara al usuario, no un throw crudo.
    if ((error as { code?: string }).code === '23P01') {
      return { error: 'Ese horario se encima con otra cita' };
    }
    throw new Error(`createAssistantAppointment failed: ${error.message}`);
  }

  return { id: (data as { id: string }).id, warning: customerWarning };
}

// ─── Reagendar cita ───────────────────────────────────────────────────────────

type RescheduleInput = {
  appointmentId: string;
  newDate:       string;   // 'YYYY-MM-DD' en hora local del cliente
  newStartTime:  string;   // 'HH:MM'
  newStaffId?:   string;   // si cambia el barbero; si omitido, mantiene el actual
  force?:        boolean;  // recepción FUERZA un solape intencional (S6-UI-02 PR-3):
                           // salta el pre-check de solape y marca allow_overlap=true
                           // (exenta del constraint). Los flujos automáticos nunca lo usan.
};

/**
 * Cambia la hora (y opcionalmente el barbero) de una cita existente.
 * Calcula el nuevo ends_at basándose en la duración del servicio.
 * Verifica conflictos de horario antes de actualizar.
 * Registra modified_by_staff_id para trazabilidad.
 */
export async function rescheduleAppointment(input: RescheduleInput): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const gate = await assertBarberOwnsAppointment(supabase, session, input.appointmentId);
  if (gate?.error) return gate;

  // Verificar que la cita pertenece al negocio y obtener datos necesarios
  const { data: raw, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, staff_id, status, starts_at, customer_id, service:service_id(duration_minutes, name)')
    .eq('id', input.appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !raw) return { error: 'Cita no encontrada' };

  const appt = raw as unknown as {
    id: string;
    business_id: string;
    staff_id: string;
    status: string;
    starts_at: string;
    customer_id: string | null;
    service: { duration_minutes: number; name: string };
  };

  if (!['pending', 'confirmed'].includes(appt.status)) {
    return { error: 'Solo se pueden reagendar citas pendientes o confirmadas' };
  }

  // Calcular nuevo rango — usar hora local que mandó el cliente
  const [hh, mm] = input.newStartTime.split(':').map(Number);
  const startDate = new Date(`${input.newDate}T00:00:00`);
  startDate.setHours(hh ?? 0, mm ?? 0, 0, 0);
  const endDate = new Date(startDate.getTime() + appt.service.duration_minutes * 60_000);

  const newStaffId   = input.newStaffId ?? appt.staff_id;
  const newStartsAt  = startDate.toISOString();
  const newEndsAt    = endDate.toISOString();

  // Pre-check de conflictos (el EXCLUDE constraint del DB es la red de seguridad).
  // Con force=true (la recepción forzó un solape intencional) se salta: el drop
  // marcará allow_overlap=true y quedará exenta del constraint.
  if (!input.force) {
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id')
      .eq('staff_id', newStaffId)
      .neq('id', input.appointmentId)
      .neq('status', 'cancelled')
      .lt('starts_at', newEndsAt)
      .gt('ends_at', newStartsAt)
      .limit(1);

    if (conflicts && conflicts.length > 0) {
      return { error: 'El nuevo horario tiene conflicto con otra cita' };
    }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      starts_at:            newStartsAt,
      ends_at:              newEndsAt,
      staff_id:             newStaffId,
      status:               'confirmed',
      // Solo un solape FORZADO por la recepción queda exento del constraint.
      // Un reacomodo limpio resetea el flag (allow_overlap=false).
      allow_overlap:        input.force === true,
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', input.appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`rescheduleAppointment failed: ${error.message}`);

  // Cancelar recordatorios obsoletos del horario anterior — best-effort
  await supabase
    .from('scheduled_notifications')
    .update({ failed_at: new Date().toISOString() })
    .eq('appointment_id', input.appointmentId)
    .is('sent_at', null)
    .is('failed_at', null);

  // ── Notificar al cliente y programar nuevos reminders — best-effort ───
  try {
    let customerPhone: string | null = null;
    let customerName:  string | null = null;
    if (appt.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('phone, name')
        .eq('id', appt.customer_id)
        .maybeSingle();
      const c = cust as { phone: string | null; name: string } | null;
      customerPhone = c?.phone ?? null;
      customerName  = c?.name  ?? null;
    }

    if (customerPhone) {
      const [bizResult, staffResult] = await Promise.all([
        supabase
          .from('businesses')
          .select('timezone, whatsapp_phone_number_id, name')
          .eq('id', session.business_id)
          .maybeSingle(),
        supabase
          .from('staff')
          .select('name')
          .eq('id', newStaffId)
          .maybeSingle(),
      ]);
      const b             = bizResult.data as { timezone: string; whatsapp_phone_number_id: string; name: string } | null;
      const tz            = b?.timezone ?? 'America/Mexico_City';
      const phoneNumberId = b?.whatsapp_phone_number_id;
      const accessToken   = process.env['WHATSAPP_ACCESS_TOKEN'];
      const businessName  = b?.name ?? '';
      const staffName     = (staffResult.data as { name: string } | null)?.name ?? '';

      if (phoneNumberId && accessToken) {
        const config: MetaConfig = { phoneNumberId, accessToken };
        const oldDateStr = formatApptDate(appt.starts_at, tz);
        const oldTimeStr = formatApptTime(appt.starts_at, tz);
        const newDateStr = formatApptDate(newStartsAt, tz);
        const newTimeStr = formatApptTime(newStartsAt, tz);
        const firstName  = customerName ? customerName.split(' ')[0]! : '';

        await sendRescheduleNotice(
          config,
          customerPhone,
          firstName,
          oldDateStr,
          oldTimeStr,
          newDateStr,
          newTimeStr,
          businessName,
        );

        const nowIso = new Date().toISOString();
        const nowMs  = Date.now();
        const newStart = new Date(newStartsAt);

        // Metadata for template-based sending in the dispatcher
        const reminderMeta: Record<string, string> = {
          customer_name: firstName,
          service_name:  appt.service?.name ?? '',
          staff_name:    staffName,
          time_str:      newTimeStr,
          business_name: businessName,
        };

        // Log del envio + nuevos reminders
        type NotifRow = {
          business_id:    string;
          appointment_id: string;
          customer_phone: string;
          type:           string;
          scheduled_for:  string;
          sent_at?:       string;
          message_body:   string;
          metadata?:      Record<string, string>;
        };

        const notifRows: NotifRow[] = [
          {
            business_id:    session.business_id,
            appointment_id: input.appointmentId,
            customer_phone: customerPhone,
            type:           'reschedule_notice',
            scheduled_for:  nowIso,
            sent_at:        nowIso,
            message_body:   `Hola ${firstName}, tu cita del ${oldDateStr} a las ${oldTimeStr} fue movida al ${newDateStr} a las ${newTimeStr} en ${businessName}. Si necesitas cambios, responde a este mensaje.`,
          },
        ];

        // Nuevos reminders para la nueva fecha (solo si quedan en el futuro)
        const at24h = new Date(newStart.getTime() - 24 * 60 * 60_000);
        if (at24h.getTime() > nowMs) {
          notifRows.push({
            business_id:    session.business_id,
            appointment_id: input.appointmentId,
            customer_phone: customerPhone,
            type:           'reminder_24h',
            scheduled_for:  at24h.toISOString(),
            message_body:   `Hola, manana tienes tu cita a las ${newTimeStr}. Te esperamos!`,
            metadata:       reminderMeta,
          });
        }

        const at2h = new Date(newStart.getTime() - 2 * 60 * 60_000);
        if (at2h.getTime() > nowMs) {
          notifRows.push({
            business_id:    session.business_id,
            appointment_id: input.appointmentId,
            customer_phone: customerPhone,
            type:           'reminder_2h',
            scheduled_for:  at2h.toISOString(),
            message_body:   `Hola, en 2 horas tienes tu cita a las ${newTimeStr}. Te esperamos!`,
            metadata:       reminderMeta,
          });
        }

        const at1h = new Date(newStart.getTime() - 1 * 60 * 60_000);
        if (at1h.getTime() > nowMs) {
          notifRows.push({
            business_id:    session.business_id,
            appointment_id: input.appointmentId,
            customer_phone: customerPhone,
            type:           'reminder_1h',
            scheduled_for:  at1h.toISOString(),
            message_body:   `Hola, te recordamos tu cita hoy a las ${newTimeStr}.`,
            metadata:       reminderMeta,
          });
        }

        await supabase.from('scheduled_notifications').insert(notifRows);
      }
    }
  } catch {
    // best-effort — la reagenda ya fue exitosa
  }
}

// ─── Staff blocks del día (para AvailabilityTimeline) ────────────────────────

export type StaffBlockForDay = {
  staffId: string;
  startsAt: string;  // ISO 8601 UTC
  endsAt: string;    // ISO 8601 UTC
};

/**
 * Retorna los bloques aprobados de todos los barberos del negocio para el día dado.
 * Solo status='approved' — los pending no afectan la operación.
 */
export async function getStaffBlocksForDay(
  date: string,
): Promise<StaffBlockForDay[]> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // 1. IDs de staff activo del negocio
  const { data: staffData, error: staffErr } = await supabase
    .from('staff')
    .select('id')
    .eq('business_id', session.business_id)
    .eq('active', true);

  if (staffErr || !staffData) return [];

  const staffIds = (staffData as { id: string }[]).map((s) => s.id);
  if (staffIds.length === 0) return [];

  // 2. Bloques aprobados que se solapan con el día — límites en la TZ del negocio
  //    (no UTC), si no se perdían los bloqueos de la tarde/noche (≥18:00 en UTC-6).
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', session.business_id)
    .maybeSingle();
  const tz = (bizRow as { timezone: string | null } | null)?.timezone ?? 'America/Mexico_City';
  const { start: dayStart, end: dayEnd } = localDayRangeUtc(date, tz);

  const { data, error } = await supabase
    .from('staff_blocks')
    .select('staff_id, starts_at, ends_at')
    .in('staff_id', staffIds)
    .eq('status', 'approved')
    .lt('starts_at', dayEnd)
    .gt('ends_at', dayStart);

  if (error || !data) return [];

  return (data as { staff_id: string; starts_at: string; ends_at: string }[]).map((b) => ({
    staffId: b.staff_id,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
  }));
}

// ─── Buscar cliente ───────────────────────────────────────────────────────────

export type CustomerSearchResult = {
  id: string;
  name: string;
  phone: string | null;
  totalVisits: number;
  lastVisit: string | null;
  preferredStaff: string | null;
};

/**
 * Busca clientes del negocio por nombre o teléfono (ILIKE).
 * Devuelve hasta 5 resultados con conteo de visitas y barbero preferido.
 */
export async function searchCustomers(
  query: string,
): Promise<CustomerSearchResult[]> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const q = query.trim();
  if (q.length < 2) return [];

  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('business_id', session.business_id)
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(5);

  if (error || !customers) return [];

  const rows = customers as { id: string; name: string; phone: string | null }[];

  // Por cada cliente, obtener visitas completadas + barbero más frecuente
  const results = await Promise.all(
    rows.map(async (c) => {
      const { data: appts } = await supabase
        .from('appointments')
        .select('starts_at, staff:staff_id(name)')
        .eq('customer_id', c.id)
        .eq('status', 'completed')
        .order('starts_at', { ascending: false });

      const list = (appts ?? []) as unknown as { starts_at: string; staff: { name: string } | null }[];
      const totalVisits = list.length;
      const lastVisit   = list[0]?.starts_at ?? null;

      // Staff más frecuente
      const staffCounts = new Map<string, number>();
      for (const a of list) {
        const sName = a.staff?.name;
        if (sName) staffCounts.set(sName, (staffCounts.get(sName) ?? 0) + 1);
      }
      const preferredStaff =
        staffCounts.size > 0
          ? [...staffCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
          : null;

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        totalVisits,
        lastVisit,
        preferredStaff,
      };
    }),
  );

  return results;
}

// ─── Handoff: tomar control de conversación ───────────────────────────────────

/**
 * Transfiere el control de una conversación del bot al staff.
 * Los mensajes entrantes del cliente se persistirán en conversation_messages
 * pero NO pasarán al FSM mientras session_mode = 'human'.
 * El auto-release ocurre si taken_at supera 30 min sin actividad del staff.
 */
export async function takeoverConversation(customerPhone: string): Promise<void> {
  const session = await requireAssistantSession();
  // Identidad del handoff: el barbero (login por PIN) se atribuye a su staff_id;
  // la recepción/asistente (login por token, sin staff_id) toma control A NIVEL
  // NEGOCIO → taken_by NULL. Cualquier otro rol sin identidad válida se rechaza.
  const isBarber = session.role === 'barber' && !!session.staff_id;
  const isAssistant = session.role === 'assistant';
  if (!isBarber && !isAssistant) {
    throw new Error('Se requiere identificación de staff para tomar control');
  }
  const takenBy = isBarber ? session.staff_id : null;
  const supabase = getServiceClient();

  // Leer estado previo para no enviar aviso si ya estaba en modo humano
  const { data: prevConv } = await supabase
    .from('bot_conversations')
    .select('session_mode')
    .eq('business_id', session.business_id)
    .eq('customer_phone', customerPhone)
    .maybeSingle();
  const prevMode = (prevConv as { session_mode: string } | null)?.session_mode;

  const { error } = await supabase
    .from('bot_conversations')
    .update({
      session_mode: 'human',
      taken_by:     takenBy,
      taken_at:     new Date().toISOString(),
    })
    .eq('business_id', session.business_id)
    .eq('customer_phone', customerPhone);

  if (error) throw new Error(`takeoverConversation failed: ${error.message}`);

  console.log(JSON.stringify({
    ts:             new Date().toISOString(),
    service:        'handoff',
    event:          'handoff_entered_human_mode',
    business_id:    session.business_id,
    customer_phone: customerPhone,
    trigger:        'staff_takeover',
    staff_id:       session.staff_id,
  }));

  // Enviar aviso al cliente solo la primera vez que entra en modo humano
  if (prevMode !== 'human') {
    try {
      const { data: biz } = await supabase
        .from('businesses')
        .select('whatsapp_phone_number_id')
        .eq('id', session.business_id)
        .maybeSingle();
      const phoneNumberId = (biz as { whatsapp_phone_number_id: string } | null)?.whatsapp_phone_number_id;
      const accessToken   = process.env['WHATSAPP_ACCESS_TOKEN'];
      if (phoneNumberId && accessToken) {
        const TAKEOVER_MSG = 'Un momento, te comunico con nuestro equipo.';
        await sendWhatsAppMeta(
          { to: customerPhone, body: TAKEOVER_MSG },
          { accessToken, phoneNumberId },
        );
        await supabase
          .from('conversation_messages')
          .insert({
            business_id:    session.business_id,
            customer_phone: customerPhone,
            direction:      'outbound',
            body:           TAKEOVER_MSG,
            sent_by:        'bot',
            staff_id:       null,
          })
          .then(() => {/* best-effort */}, () => {/* best-effort */});
      }
    } catch { /* best-effort — no bloquear el takeover si falla el envío */ }
  }
}

// ─── Handoff: devolver control al bot ────────────────────────────────────────

/**
 * Devuelve el control de la conversación al bot FSM.
 * Idempotente: si ya está en modo 'bot', no falla.
 */
export async function releaseConversation(customerPhone: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { error } = await supabase
    .from('bot_conversations')
    .update({
      session_mode: 'bot',
      taken_by:     null,
      taken_at:     null,
    })
    .eq('business_id', session.business_id)
    .eq('customer_phone', customerPhone);

  if (error) throw new Error(`releaseConversation failed: ${error.message}`);
}

// ─── Handoff: enviar mensaje desde el panel ───────────────────────────────────

/**
 * Envía un mensaje de WhatsApp directo al cliente desde el panel del staff.
 * Solo disponible cuando session_mode = 'human' — el staff debe haber tomado
 * control con takeoverConversation() antes de poder enviar.
 *
 * Cada envío exitoso resetea taken_at en bot_conversations, renovando los
 * 30 minutos de auto-release mientras el staff esté activamente chateando.
 */
export async function sendMessageFromPanel(
  customerPhone: string,
  message: string,
): Promise<{ sent: boolean }> {
  const session = await requireAssistantSession();
  // Mismo criterio de identidad que el takeover: barbero (staff_id) o
  // recepción/asistente del negocio. El mensaje del asistente se persiste
  // sent_by:'human' con staff_id NULL (autoría a nivel negocio).
  const isBarber = session.role === 'barber' && !!session.staff_id;
  const isAssistant = session.role === 'assistant';
  if (!isBarber && !isAssistant) {
    throw new Error('Se requiere identificación de staff para enviar mensajes');
  }
  const supabase = getServiceClient();

  // ── Verificar que la conversación está bajo control humano ────────────────
  const { data: conv } = await supabase
    .from('bot_conversations')
    .select('session_mode')
    .eq('business_id', session.business_id)
    .eq('customer_phone', customerPhone)
    .maybeSingle();

  if (!conv || (conv as { session_mode: string }).session_mode !== 'human') {
    throw new Error('Toma control de la conversación antes de enviar mensajes directos');
  }

  // ── Obtener whatsapp_phone_number_id del negocio ──────────────────────────
  const { data: biz } = await supabase
    .from('businesses')
    .select('whatsapp_phone_number_id')
    .eq('id', session.business_id)
    .maybeSingle();

  const phoneNumberId = (biz as { whatsapp_phone_number_id: string } | null)?.whatsapp_phone_number_id;
  if (!phoneNumberId) throw new Error('No se encontró configuración de WhatsApp para este negocio');

  // ── Enviar vía Meta Cloud API — best-effort ───────────────────────────────
  let sent = false;
  try {
    const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
    if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
    const result = await sendWhatsAppMeta(
      { to: customerPhone, body: message },
      { accessToken, phoneNumberId },
    );
    sent = result.success;
  } catch {
    // best-effort — persistir de todos modos para trazabilidad
  }

  // ── Persistir en conversation_messages ────────────────────────────────────
  await supabase
    .from('conversation_messages')
    .insert({
      business_id:    session.business_id,
      customer_phone: customerPhone,
      direction:      'outbound',
      body:           message,
      sent_by:        'human',
      staff_id:       isBarber ? session.staff_id : null,
    })
    .then(() => {/* best-effort */}, () => {/* best-effort */});

  // ── Resetear timer de auto-release ────────────────────────────────────────
  // Cada mensaje del staff renueva los 30 min del takeover, evitando
  // que se pierda el control en medio de una conversación activa.
  await supabase
    .from('bot_conversations')
    .update({ taken_at: new Date().toISOString() })
    .eq('business_id', session.business_id)
    .eq('customer_phone', customerPhone)
    .eq('session_mode', 'human'); // guard: solo si sigue en modo humano

  return { sent };
}

// ─── Gestión de horario semanal ───────────────────────────────────────────────

type AvailabilitySlot = {
  day_of_week: number;
  start_time:  string;
  end_time:    string;
  break_start?: string | null;
  break_end?:   string | null;
  is_active?:   boolean;
};

/**
 * Reemplaza el horario semanal recurrente de un barbero.
 * DELETE existing + INSERT new. Array vacío = descanso total.
 * Admite los campos de migration 025: break_start, break_end, is_active.
 */
export async function updateStaffSchedule(
  staffId: string,
  availability: AvailabilitySlot[],
): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: existing, error: fetchErr } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Staff no encontrado');

  const { error: deleteError } = await supabase
    .from('staff_availability')
    .delete()
    .eq('staff_id', staffId);

  if (deleteError) throw new Error(`updateStaffSchedule delete failed: ${deleteError.message}`);

  if (availability.length > 0) {
    const rows = availability.map((slot) => ({
      staff_id:    staffId,
      day_of_week: slot.day_of_week,
      start_time:  slot.start_time,
      end_time:    slot.end_time,
      break_start: slot.break_start ?? null,
      break_end:   slot.break_end   ?? null,
      is_active:   slot.is_active   ?? true,
    }));

    const { error: insertError } = await supabase
      .from('staff_availability')
      .insert(rows);

    if (insertError) throw new Error(`updateStaffSchedule insert failed: ${insertError.message}`);
  }
}

// ─── Gestión de excepciones de horario ───────────────────────────────────────

type ScheduleExceptionInput = {
  staffId:        string;
  exceptionDate:  string;  // 'YYYY-MM-DD'
  available:      boolean;
  startTime?:     string | null;  // 'HH:MM' — solo si available=true + horario especial
  endTime?:       string | null;
  reason?:        string | null;
};

export type ScheduleException = {
  id:             string;
  staff_id:       string;
  business_id:    string;
  exception_date: string;
  available:      boolean;
  start_time:     string | null;
  end_time:       string | null;
  reason:         string | null;
  created_at:     string;
};

/**
 * Crea o actualiza una excepción de horario para una fecha específica.
 * UPSERT por (staff_id, exception_date) — respeta la UNIQUE constraint.
 */
export async function createScheduleException(
  data: ScheduleExceptionInput,
): Promise<ScheduleException> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: existing, error: fetchErr } = await supabase
    .from('staff')
    .select('id')
    .eq('id', data.staffId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Staff no encontrado');

  const { data: result, error } = await supabase
    .from('staff_schedule_exceptions')
    .upsert(
      {
        staff_id:       data.staffId,
        business_id:    session.business_id,
        exception_date: data.exceptionDate,
        available:      data.available,
        start_time:     data.startTime  ?? null,
        end_time:       data.endTime    ?? null,
        reason:         data.reason     ?? null,
      },
      { onConflict: 'staff_id,exception_date' },
    )
    .select('id, staff_id, business_id, exception_date, available, start_time, end_time, reason, created_at')
    .single();

  if (error) throw new Error(`createScheduleException failed: ${error.message}`);

  return result as ScheduleException;
}

/**
 * Elimina una excepción de horario.
 * El AND business_id garantiza que solo se puede borrar del negocio propio.
 */
export async function deleteScheduleException(exceptionId: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { error } = await supabase
    .from('staff_schedule_exceptions')
    .delete()
    .eq('id', exceptionId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`deleteScheduleException failed: ${error.message}`);
}

/**
 * Obtiene las excepciones de horario de un barbero.
 * Si se pasa month ('YYYY-MM'), filtra ese mes.
 * Si no, retorna todas las excepciones futuras (exception_date >= hoy).
 */
export async function getScheduleExceptions(
  staffId: string,
  month?: string,
): Promise<ScheduleException[]> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: staffRow, error: fetchErr } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !staffRow) throw new Error('Staff no encontrado');

  let query = supabase
    .from('staff_schedule_exceptions')
    .select('id, staff_id, business_id, exception_date, available, start_time, end_time, reason, created_at')
    .eq('staff_id', staffId)
    .eq('business_id', session.business_id)
    .order('exception_date', { ascending: true });

  if (month) {
    // Rango del mes: 'YYYY-MM' → primer día y primer día del mes siguiente
    const [year, mon] = month.split('-').map(Number);
    const from = `${year}-${String(mon).padStart(2, '0')}-01`;
    const nextMonth = mon === 12 ? 1 : mon + 1;
    const nextYear  = mon === 12 ? year + 1 : year;
    const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    query = query.gte('exception_date', from).lt('exception_date', to);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    query = query.gte('exception_date', today);
  }

  const { data, error } = await query;
  if (error) throw new Error(`getScheduleExceptions failed: ${error.message}`);

  return (data ?? []) as ScheduleException[];
}

// ─── Chat panel: conversaciones activas ───────────────────────────────────────

export type ConversationSummary = {
  customerPhone: string;
  sessionMode:   'bot' | 'human' | 'paused';
  state:         string;
  takenByName:   string | null;
  lastMessage:   string;  // ISO timestamptz
};

/**
 * Retorna las conversaciones activas del negocio, ordenadas:
 *   human → paused → bot. Dentro de cada grupo, por last_message DESC.
 */
export async function getActiveConversations(): Promise<ConversationSummary[]> {
  const { business_id } = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('bot_conversations')
    .select(`
      customer_phone,
      session_mode,
      state,
      last_message,
      taken_by_staff:taken_by(name)
    `)
    .eq('business_id', business_id)
    .order('last_message', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getActiveConversations failed: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    customer_phone:  string;
    session_mode:    string;
    state:           string;
    last_message:    string;
    taken_by_staff:  { name: string } | null;
  }>;

  // Ordenar: human primero, paused segundo, bot al final
  const ORDER: Record<string, number> = { human: 0, paused: 1, bot: 2 };
  rows.sort((a, b) => (ORDER[a.session_mode] ?? 3) - (ORDER[b.session_mode] ?? 3));

  return rows.map((r) => ({
    customerPhone: r.customer_phone,
    sessionMode:   r.session_mode as 'bot' | 'human' | 'paused',
    state:         r.state,
    takenByName:   r.taken_by_staff?.name ?? null,
    lastMessage:   r.last_message,
  }));
}

// ─── Chat panel: historial de mensajes ────────────────────────────────────────

export type ConversationMessage = {
  id:        string;
  direction: 'inbound' | 'outbound';
  body:      string;
  sentBy:    'bot' | 'human' | 'customer';
  staffId:   string | null;
  createdAt: string;  // ISO timestamptz
};

/**
 * Retorna los últimos 100 mensajes de una conversación específica,
 * ordenados por created_at ASC (cronológico).
 */
export async function getConversationMessages(
  customerPhone: string,
): Promise<ConversationMessage[]> {
  const { business_id } = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, direction, body, sent_by, staff_id, created_at')
    .eq('business_id', business_id)
    .eq('customer_phone', customerPhone)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) throw new Error(`getConversationMessages failed: ${error.message}`);

  return ((data ?? []) as Array<{
    id:         string;
    direction:  string;
    body:       string;
    sent_by:    string;
    staff_id:   string | null;
    created_at: string;
  }>).map((r) => ({
    id:        r.id,
    direction: r.direction as 'inbound' | 'outbound',
    body:      r.body,
    sentBy:    r.sent_by as 'bot' | 'human' | 'customer',
    staffId:   r.staff_id,
    createdAt: r.created_at,
  }));
}

// ─── Helpers de formato para notificaciones del panel ─────────────────────────

const DAYS_ES_PANEL   = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES_PANEL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatApptDate(isoStr: string, tz: string): string {
  const localDateStr = new Date(isoStr).toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const [, monthStr, dayStr] = localDateStr.split('-');
  const dayNum    = parseInt(dayStr!, 10);
  const dayOfWeek = new Date(localDateStr + 'T12:00:00Z').getDay();
  const monthIdx  = parseInt(monthStr!, 10) - 1;
  return `${DAYS_ES_PANEL[dayOfWeek]} ${dayNum} de ${MONTHS_ES_PANEL[monthIdx]}`;
}

function formatApptTime(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleTimeString('es-MX', {
    timeZone: tz,
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  });
}
