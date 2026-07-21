// ─── Assistant Server Actions ──────────────────────────────────────────────────
// Mutaciones y fetches de citas desde la vista del asistente.
// Requieren sesión con role='assistant' | 'owner' | 'admin' | 'barber'.
//
// REGLA: service_role_key y getCurrentSession nunca salen al cliente.

'use server';

import { createClient } from '@supabase/supabase-js';
import { getCurrentSession, getBusinessTimezone } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import { getDayAppointments, queryStaffBlocksForDay, zonedWallTimeToUtc, localDayRangeUtc } from '@/lib/dashboard.types';
import { todayStrInTz } from '@/lib/dayWindow';
import type { DashboardAppointment, StaffBlockForDay } from '@/lib/dashboard.types';
import { sendWhatsAppMeta } from '@presenciapro/engine/notifications';
import { notifyWaitlistOnCancel } from '@/lib/notifyWaitlistOnCancel';
import {
  sendCancellationNotice,
  type MetaConfig,
} from '@/lib/whatsapp-templates';

// Ventana de gracia (debounce deslizante) del aviso de reagenda al cliente: el
// movimiento persiste al instante, pero el WhatsApp "tu cita se movió" se encola
// con este colchón y cada nuevo movimiento lo resetea → el cliente recibe UN solo
// mensaje con la posición final. Ver rescheduleAppointment.
const RESCHEDULE_NOTICE_GRACE_MIN = 4;

// Umbral de magnitud: solo se avisa al cliente si la posición FINAL se corrió al
// menos esto respecto de la ORIGINAL (antes del burst). Movimientos < umbral son
// microajustes operativos → no molestan al cliente.
const RESCHEDULE_NOTICE_MIN_DELTA_MIN = 30;

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
  const { data, error } = await tenantDb(supabase, session.business_id)
    .table('appointments')
    .select('staff_id')
    .eq('id', appointmentId)
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
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, status, starts_at, customer_id, staff_id')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'cancelled') return; // idempotente

  const { error } = await db
    .table('appointments')
    .update({
      status:               'cancelled',
      notes:                reason.trim() || null,
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw new Error(`cancelAppointment failed: ${error.message}`);

  // Cancelar recordatorios pendientes — best-effort, no interrumpe el flujo
  await db
    .table('scheduled_notifications')
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
      const { data: cust } = await db
        .table('customers')
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
        await db
          .table('scheduled_notifications')
          .insert({
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
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { error } = await db
    .table('appointments')
    .update({
      notes:                notes.trim() || null,
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw new Error(`updateAppointmentNotes failed: ${error.message}`);
}

// ─── Completar cita ───────────────────────────────────────────────────────────

export async function completeAppointment(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'completed') return; // idempotente

  const { error } = await db
    .table('appointments')
    .update({
      status:               'completed',
      // Instante REAL de cierre — fuente única del corrimiento del día (Paso 6).
      // El early-return idempotente de arriba preserva el timestamp de la PRIMERA
      // marcación: un re-tap no lo pisa.
      completed_at:         new Date().toISOString(),
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw new Error(`completeAppointment failed: ${error.message}`);
}

// ─── Registrar no-show ────────────────────────────────────────────────────────

export async function noShowAppointment(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'no_show') return; // idempotente

  const { error } = await db
    .table('appointments')
    .update({
      status:               'no_show',
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw new Error(`noShowAppointment failed: ${error.message}`);
}

// ─── Confirmar cita (pending → confirmed) ─────────────────────────────────────
// Botón "Confirmar" de la card del asistente (Paso 3B). Espejo de completeAppointment
// con guard atómico status='pending'.

export async function confirmAppointment(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.status === 'confirmed') return; // idempotente
  if (existing.status !== 'pending') return { error: 'Solo se puede confirmar una cita pendiente' };

  const { error } = await db
    .table('appointments')
    .update({
      status:               'confirmed',
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('status', 'pending'); // guard atómico contra carreras

  if (error) throw new Error(`confirmAppointment failed: ${error.message}`);
}

// ─── Marcar llegada del cliente ("Llegó") ─────────────────────────────────────
// Botón "Llegó" de la card (Paso 3B). Registra arrived_at = now; NO cambia status.
// Protege la cita del auto-cancel: dispatch-auto-cancel (fetch) y el RPC
// mark_appointment_no_show ignoran las citas con arrived_at IS NOT NULL.

export async function markArrived(appointmentId: string): Promise<{ error?: string } | void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, appointmentId);
  if (gate?.error) return gate;

  const { data: existing, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, status, arrived_at')
    .eq('id', appointmentId)
    .maybeSingle();

  if (fetchErr || !existing) return { error: 'Cita no encontrada' };
  if (existing.arrived_at) return; // idempotente
  if (['cancelled', 'completed', 'no_show'].includes(existing.status as string)) {
    return { error: 'La cita ya está cerrada' };
  }

  const { error } = await db
    .table('appointments')
    .update({
      arrived_at:           new Date().toISOString(),
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw new Error(`markArrived failed: ${error.message}`);
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
  allowPast?:    boolean;  // walk-in RETROACTIVO: la recepción confirmó "esta hora ya pasó,
                           // registrar igual". SOLO el walk-in con aviso lo pasa; el form de
                           // nueva cita NO → una hora pasada ahí se rechaza (visible). El bot
                           // usa el engine, no esta action, y tiene su propio piso de "no pasado".
};

// Gracia del guard de pasado: se rechaza una cita cuyo starts_at quedó más de un slot
// (15 min) por debajo de "ahora". Deja pasar el walk-in "ahora" (el slot en curso), pero
// atrapa lo claramente pasado. El walk-in retroactivo lo saltea con allowPast.
const PAST_GRACE_MS = 15 * 60 * 1000;

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
  const db = tenantDb(supabase, session.business_id);

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
    .select('require_customer_phone, max_appointments_per_staff_per_day, timezone')
    .eq('id', session.business_id)
    .maybeSingle();
  const bizCfg = bizCfgRaw as {
    require_customer_phone: boolean;
    max_appointments_per_staff_per_day: number;
    timezone: string | null;
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

  // ── Guard de pasado (fuente de verdad, visible) ──────────────────────────
  // Una cita cuya hora ya pasó (más de un slot) se rechaza acá — de cara al usuario,
  // no un fallo silencioso. Cierra el pasado para el form de "nueva cita" (que NO pasa
  // allowPast). El walk-in RETROACTIVO, cuando la recepción confirma el aviso "esta hora
  // ya pasó", pasa allowPast=true y lo saltea. Comparación por epoch (TZ-agnóstica): el
  // startsAt ya viene con offset del negocio desde el cliente.
  if (!input.allowPast && Date.parse(input.startsAt) < Date.now() - PAST_GRACE_MS) {
    return { error: 'Esa hora ya pasó' };
  }

  // ── Tope suave de citas/día por barbero (anti-inflado grosero) ───────────
  // Solo barbero. Cuenta sus citas NO canceladas del día destino; si alcanza el
  // tope configurable (businesses.max_appointments_per_staff_per_day, default 20),
  // rechaza ANTES de crear cliente/cita. NOTA: el tope frena el inflado GROSERO
  // (decenas de citas falsas), NO el fino (ej. tope-1/día) — eso lo cubre el
  // audit trail visible (fase posterior). Es complemento, no reemplazo.
  if (isBarber) {
    const maxPerStaffPerDay = bizCfg?.max_appointments_per_staff_per_day ?? 20;
    // El "día" del cap se acota a la tz del NEGOCIO, no a UTC. Dos correcciones:
    // (1) el día local del instante de la cita (no el slice de un ISO que puede venir
    //     en UTC), (2) la ventana [00:00, 24:00) locales vía localDayRangeUtc. Sin
    //     esto el cap medía un día corrido (no contaba las de la tarde / contaba las
    //     de ayer) → protegía la agenda mal.
    const tz = bizCfg?.timezone ?? 'America/Mexico_City';
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(input.startsAt));
    const { start, end } = localDayRangeUtc(localDay, tz);
    const { count } = await db
      .table('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', effectiveStaffId)
      .neq('status', 'cancelled')
      .gte('starts_at', start)
      .lt('starts_at', end);
    if ((count ?? 0) >= maxPerStaffPerDay) {
      // Validación de cara al usuario → return (los throw se redactan en prod).
      return { error: 'Alcanzaste el máximo de citas para ese día, contacta al admin' };
    }
  }

  if (name) {
    if (phone) {
      // Buscar por teléfono — identificador canónico
      const { data: existing } = await db
        .table('customers')
        .select('id, noshow_count, is_flagged')
        .eq('phone', phone)
        .maybeSingle();

      if (existing) {
        const row = existing as { id: string; noshow_count: number; is_flagged: boolean };
        customerId = row.id;
        if (row.is_flagged) {
          customerWarning = `Este cliente tiene ${row.noshow_count} no-show${row.noshow_count !== 1 ? 's' : ''} registrado${row.noshow_count !== 1 ? 's' : ''}`;
        }
      } else {
        const { data: created } = await db
          .table('customers')
          .insert({
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
      const { data: existing } = await db
        .table('customers')
        .select('id, noshow_count, is_flagged')
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
        const { data: created } = await db
          .table('customers')
          .insert({
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
  const { data, error } = await db
    .table('appointments')
    .insert({
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
  const db = tenantDb(supabase, session.business_id);
  const gate = await assertBarberOwnsAppointment(supabase, session, input.appointmentId);
  if (gate?.error) return gate;

  // Verificar que la cita pertenece al negocio y obtener datos necesarios
  const { data: raw, error: fetchErr } = await db
    .table('appointments')
    .select('id, business_id, staff_id, status, starts_at, customer_id, service:service_id(duration_minutes, name)')
    .eq('id', input.appointmentId)
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

  // Calcular nuevo rango — la hora que mandó el cliente es hora-de-pared del NEGOCIO
  // (todos los call-sites pasan hora local del negocio: el gesto del asistente, el
  // deshacer, y el input de la vista del barbero). Se interpreta en la tz del negocio
  // y se convierte a UTC. ANTES: `new Date('YYYY-MM-DDT00:00:00').setHours(...)` usaba
  // la tz del SERVIDOR (Vercel=UTC) → en prod la cita aterrizaba corrida ~6h (S6-DATA-01).
  const timezone     = await getBusinessTimezone(session.business_id);
  const startDate    = zonedWallTimeToUtc(input.newDate, `${input.newStartTime}:00`, timezone);
  const endDate      = new Date(startDate.getTime() + appt.service.duration_minutes * 60_000);

  const newStaffId   = input.newStaffId ?? appt.staff_id;
  const newStartsAt  = startDate.toISOString();
  const newEndsAt    = endDate.toISOString();

  // Pre-check de conflictos (el EXCLUDE constraint del DB es la red de seguridad).
  // Con force=true (la recepción forzó un solape intencional) se salta: el drop
  // marcará allow_overlap=true y quedará exenta del constraint.
  if (!input.force) {
    const { data: conflicts } = await db
      .table('appointments')
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

  const { error } = await db
    .table('appointments')
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
    .eq('id', input.appointmentId);

  if (error) throw new Error(`rescheduleAppointment failed: ${error.message}`);

  // Cancelar recordatorios obsoletos del horario anterior — best-effort. Acotado a
  // los reminder_* a propósito: el aviso de reagenda (reschedule_notice) ahora vive
  // PENDIENTE en esta misma tabla y su ciclo de vida lo maneja el bloque de abajo
  // (encolar/superseder/borrar) — este cancel NO debe tocarlo.
  await db
    .table('scheduled_notifications')
    .update({ failed_at: new Date().toISOString() })
    .eq('appointment_id', input.appointmentId)
    .in('type', ['reminder_24h', 'reminder_2h', 'reminder_1h'])
    .is('sent_at', null)
    .is('failed_at', null);

  // ── Aviso al cliente (política de magnitud + debounce) y reminders — best-effort ──
  // El movimiento YA se persistió arriba. Acá solo: (1) el aviso "tu cita se movió"
  // — encolado, NO inline — sujeto a umbral de 30 min y ventana deslizante; (2) los
  // reminders reprogramados a la nueva hora (independientes del aviso).
  try {
    let customerPhone: string | null = null;
    let customerName:  string | null = null;
    if (appt.customer_id) {
      const { data: cust } = await db
        .table('customers')
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
          .select('timezone, name')
          .eq('id', session.business_id)
          .maybeSingle(),
        db
          .table('staff')
          .select('name')
          .eq('id', newStaffId)
          .maybeSingle(),
      ]);
      const b            = bizResult.data as { timezone: string; name: string } | null;
      const tz           = b?.timezone ?? 'America/Mexico_City';
      const businessName = b?.name ?? '';
      const staffName    = (staffResult.data as { name: string } | null)?.name ?? '';
      const firstName    = customerName ? customerName.split(' ')[0]! : '';

      const nowMs      = Date.now();
      const newStart   = new Date(newStartsAt);
      const newTimeStr = formatApptTime(newStartsAt, tz);

      // ── Aviso de reagenda: encolar / superseder / borrar ──────────────────────
      // NO se manda inline. Se encola en scheduled_notifications; el dispatcher (cron,
      // solo prod) lo envía como texto libre cuando vence scheduled_for. La decisión
      // se evalúa SIEMPRE sobre la posición FINAL vs la ORIGINAL (la de antes del
      // burst, preservada en metadata.old_iso de la fila pendiente).
      const { data: pendingRows } = await db
        .table('scheduled_notifications')
        .select('id, metadata')
        .eq('appointment_id', input.appointmentId)
        .eq('type', 'reschedule_notice')
        .is('sent_at', null)
        .is('failed_at', null)
        .limit(1);
      const pending = (pendingRows?.[0] ?? null) as
        | { id: string; metadata: { old_iso?: string } | null }
        | null;

      // Origen del burst: el de la fila pendiente si existe; si no, la posición previa
      // a ESTE movimiento (= inicio del burst). Magnitud por instante (robusta a día).
      const originalIso = pending?.metadata?.old_iso ?? appt.starts_at;
      const deltaMin = Math.abs(Date.parse(newStartsAt) - Date.parse(originalIso)) / 60_000;

      if (deltaMin >= RESCHEDULE_NOTICE_MIN_DELTA_MIN) {
        // Amerita aviso: encolar (o actualizar el pendiente) con la hora FINAL,
        // preservando el origen del burst. Ventana deslizante → cada movimiento la
        // resetea, así el cliente recibe UN mensaje cuando la agenda se asienta.
        const graceIso   = new Date(nowMs + RESCHEDULE_NOTICE_GRACE_MIN * 60_000).toISOString();
        const oldDateStr = formatApptDate(originalIso, tz);
        const oldTimeStr = formatApptTime(originalIso, tz);
        const newDateStr = formatApptDate(newStartsAt, tz);
        const body =
          `Hola ${firstName}, tu cita del ${oldDateStr} a las ${oldTimeStr} fue movida al ` +
          `${newDateStr} a las ${newTimeStr} en ${businessName}. Si necesitas cambios, responde a este mensaje.`;

        if (pending) {
          await db
            .table('scheduled_notifications')
            .update({ scheduled_for: graceIso, message_body: body, metadata: { old_iso: originalIso } })
            .eq('id', pending.id);
        } else {
          await db.table('scheduled_notifications').insert({
            appointment_id: input.appointmentId,
            customer_phone: customerPhone,
            type:           'reschedule_notice',
            scheduled_for:  graceIso,
            message_body:   body,
            metadata:       { old_iso: originalIso },
          });
        }
      } else if (pending) {
        // La posición final quedó a < umbral del origen (incluye net-zero / deshacer)
        // → ya no amerita aviso: borrar el pendiente del burst. Sin fila = sin mensaje.
        await db.table('scheduled_notifications').delete().eq('id', pending.id);
      }

      // ── Reminders 24h/2h/1h para la nueva hora (independiente del aviso) ───────
      // Siempre reflejan la hora vigente de la cita; no son el mensaje "se movió".
      const reminderMeta: Record<string, string> = {
        customer_name: firstName,
        service_name:  appt.service?.name ?? '',
        staff_name:    staffName,
        time_str:      newTimeStr,
        business_name: businessName,
      };

      type ReminderRow = {
        business_id:    string;
        appointment_id: string;
        customer_phone: string;
        type:           string;
        scheduled_for:  string;
        message_body:   string;
        metadata:       Record<string, string>;
      };
      const reminderRows: ReminderRow[] = [];

      const at24h = new Date(newStart.getTime() - 24 * 60 * 60_000);
      if (at24h.getTime() > nowMs) {
        reminderRows.push({
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
        reminderRows.push({
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
        reminderRows.push({
          business_id:    session.business_id,
          appointment_id: input.appointmentId,
          customer_phone: customerPhone,
          type:           'reminder_1h',
          scheduled_for:  at1h.toISOString(),
          message_body:   `Hola, te recordamos tu cita hoy a las ${newTimeStr}.`,
          metadata:       reminderMeta,
        });
      }

      if (reminderRows.length > 0) {
        // Las filas ya traen business_id: session.business_id; el helper lo re-inyecta (idéntico).
        await db.table('scheduled_notifications').insert(reminderRows);
      }
    }
  } catch {
    // best-effort — la reagenda ya fue exitosa
  }
}

// ─── Staff blocks del día (para AvailabilityTimeline) ────────────────────────

// Re-export para retrocompatibilidad: el tipo ahora vive en @/lib/dashboard.types
// (junto al core queryStaffBlocksForDay). Los consumidores que lo importan desde
// aquí (AssistantLayout, AssistantControlDesk, AvailabilityTimeline) no cambian.
export type { StaffBlockForDay } from '@/lib/dashboard.types';

/**
 * Server action: bloques aprobados de todos los barberos del negocio para el día.
 * Deriva staffIds/tz de la sesión (scope por negocio) y delega en el core puro
 * queryStaffBlocksForDay. Firma sin cambios — /staff/gestion y AvailabilityTimeline
 * la siguen llamando igual. Solo status='approved' — los pending no afectan.
 */
export async function getStaffBlocksForDay(
  date: string,
): Promise<StaffBlockForDay[]> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();
  const db = tenantDb(supabase, session.business_id);

  // IDs de staff activo del negocio (scopeados por la sesión)
  const { data: staffData, error: staffErr } = await db
    .table('staff')
    .select('id')
    .eq('active', true);

  if (staffErr || !staffData) return [];

  const staffIds = (staffData as { id: string }[]).map((s) => s.id);
  if (staffIds.length === 0) return [];

  // tz del negocio para los límites del día
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', session.business_id)
    .maybeSingle();
  const tz = (bizRow as { timezone: string | null } | null)?.timezone ?? 'America/Mexico_City';

  return queryStaffBlocksForDay(staffIds, tz, date);
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
  const db = tenantDb(supabase, session.business_id);

  const q = query.trim();
  if (q.length < 2) return [];

  const { data: customers, error } = await db
    .table('customers')
    .select('id, name, phone')
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(5);

  if (error || !customers) return [];

  const rows = customers as { id: string; name: string; phone: string | null }[];

  // Por cada cliente, obtener visitas completadas + barbero más frecuente
  const results = await Promise.all(
    rows.map(async (c) => {
      const { data: appts } = await db
        .table('appointments')
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
  const db = tenantDb(supabase, session.business_id);

  // Leer estado previo para no enviar aviso si ya estaba en modo humano
  const { data: prevConv } = await db
    .table('bot_conversations')
    .select('session_mode')
    .eq('customer_phone', customerPhone)
    .maybeSingle();
  const prevMode = (prevConv as { session_mode: string } | null)?.session_mode;

  const { error } = await db
    .table('bot_conversations')
    .update({
      session_mode: 'human',
      taken_by:     takenBy,
      taken_at:     new Date().toISOString(),
    })
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
        await db
          .table('conversation_messages')
          .insert({
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

  const { error } = await tenantDb(supabase, session.business_id)
    .table('bot_conversations')
    .update({
      session_mode: 'bot',
      taken_by:     null,
      taken_at:     null,
    })
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
  const db = tenantDb(supabase, session.business_id);

  // ── Verificar que la conversación está bajo control humano ────────────────
  const { data: conv } = await db
    .table('bot_conversations')
    .select('session_mode')
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
  await db
    .table('conversation_messages')
    .insert({
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
  await db
    .table('bot_conversations')
    .update({ taken_at: new Date().toISOString() })
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
  const db = tenantDb(supabase, session.business_id);

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: existing, error: fetchErr } = await db
    .table('staff')
    .select('id')
    .eq('id', staffId)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Staff no encontrado');

  // staff_availability NO tiene business_id (se scopea por staff_id, ya validado
  // arriba contra el negocio) → queda crudo, fuera del helper. Ver tenantDb.ts.
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
  const db = tenantDb(supabase, session.business_id);

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: existing, error: fetchErr } = await db
    .table('staff')
    .select('id')
    .eq('id', data.staffId)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Staff no encontrado');

  const { data: result, error } = await db
    .table('staff_schedule_exceptions')
    .upsert(
      {
        staff_id:       data.staffId,
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

  const { error } = await tenantDb(supabase, session.business_id)
    .table('staff_schedule_exceptions')
    .delete()
    .eq('id', exceptionId);

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
  const db = tenantDb(supabase, session.business_id);

  // Verificar que el staff pertenece al negocio de la sesión
  const { data: staffRow, error: fetchErr } = await db
    .table('staff')
    .select('id')
    .eq('id', staffId)
    .maybeSingle();

  if (fetchErr || !staffRow) throw new Error('Staff no encontrado');

  let query = db
    .table('staff_schedule_exceptions')
    .select('id, staff_id, business_id, exception_date, available, start_time, end_time, reason, created_at')
    .eq('staff_id', staffId)
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
    // "Desde hoy en adelante" — hoy del NEGOCIO, no el día UTC del server: con el
    // naive, post-18:00 MX la lista omitía la excepción de HOY (recién marcada,
    // desaparecía del panel).
    const tz = await getBusinessTimezone(session.business_id);
    query = query.gte('exception_date', todayStrInTz(tz));
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

  const { data, error } = await tenantDb(supabase, business_id)
    .table('bot_conversations')
    .select(`
      customer_phone,
      session_mode,
      state,
      last_message,
      taken_by_staff:taken_by(name)
    `)
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

  const { data, error } = await tenantDb(supabase, business_id)
    .table('conversation_messages')
    .select('id, direction, body, sent_by, staff_id, created_at')
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
