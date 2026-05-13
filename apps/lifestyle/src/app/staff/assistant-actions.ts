// ─── Assistant Server Actions ──────────────────────────────────────────────────
// Mutaciones y fetches de citas desde la vista del asistente.
// Requieren sesión con role='assistant' | 'owner' | 'admin' | 'barber'.
//
// REGLA: service_role_key y getCurrentSession nunca salen al cliente.

'use server';

import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import { getDayAppointments } from '@/lib/dashboard.types';
import type { DashboardAppointment } from '@/lib/dashboard.types';

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
): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
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
}

// ─── Actualizar notas inline ──────────────────────────────────────────────────

/**
 * Guarda las notas operativas de una cita.
 */
export async function updateAppointmentNotes(
  appointmentId: string,
  notes: string,
): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

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

export async function completeAppointment(appointmentId: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
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

export async function noShowAppointment(appointmentId: string): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, status')
    .eq('id', appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !existing) throw new Error('Cita no encontrada');
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
};

/**
 * Crea una nueva cita desde la vista del asistente.
 *
 * · business_id siempre del servidor.
 * · Si customerPhone: busca customer por (business_id, phone); si no existe, lo crea.
 * · Si solo customerName: busca por nombre exacto (ILIKE); si no existe, crea sin teléfono.
 * · Registra created_by_staff_id cuando la sesión es de barbero.
 */
export async function createAssistantAppointment(
  input: CreateAppointmentInput,
): Promise<{ id: string }> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // ── Customer lookup / create ─────────────────────────────────────────────
  let customerId: string | null = null;
  const name  = input.customerName.trim();
  const phone = input.customerPhone?.trim() || null;

  if (name) {
    if (phone) {
      // Buscar por teléfono — identificador canónico
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('business_id', session.business_id)
        .eq('phone', phone)
        .maybeSingle();

      if (existing) {
        customerId = (existing as { id: string }).id;
      } else {
        const { data: created } = await supabase
          .from('customers')
          .insert({ business_id: session.business_id, name, phone })
          .select('id')
          .single();
        customerId = (created as { id: string } | null)?.id ?? null;
      }
    } else {
      // Solo nombre: buscar por nombre exacto (less reliable)
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('business_id', session.business_id)
        .ilike('name', name)
        .limit(1)
        .maybeSingle();

      if (existing) {
        customerId = (existing as { id: string }).id;
      } else {
        // Crear sin teléfono (phone es nullable desde migration 023)
        const { data: created } = await supabase
          .from('customers')
          .insert({ business_id: session.business_id, name, phone: null })
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
      staff_id:             input.staffId,
      service_id:           input.serviceId,
      customer_id:          customerId,
      starts_at:            input.startsAt,
      ends_at:              input.endsAt,
      status:               'confirmed',
      source:               input.source,
      notes:                input.notes?.trim() || null,
      created_by_staff_id:  session.staff_id,
    })
    .select('id')
    .single();

  if (error) throw new Error(`createAssistantAppointment failed: ${error.message}`);

  return { id: (data as { id: string }).id };
}

// ─── Reagendar cita ───────────────────────────────────────────────────────────

type RescheduleInput = {
  appointmentId: string;
  newDate:       string;   // 'YYYY-MM-DD' en hora local del cliente
  newStartTime:  string;   // 'HH:MM'
  newStaffId?:   string;   // si cambia el barbero; si omitido, mantiene el actual
};

/**
 * Cambia la hora (y opcionalmente el barbero) de una cita existente.
 * Calcula el nuevo ends_at basándose en la duración del servicio.
 * Verifica conflictos de horario antes de actualizar.
 * Registra modified_by_staff_id para trazabilidad.
 */
export async function rescheduleAppointment(input: RescheduleInput): Promise<void> {
  const session = await requireAssistantSession();
  const supabase = getServiceClient();

  // Verificar que la cita pertenece al negocio y obtener datos necesarios
  const { data: raw, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, business_id, staff_id, status, service:service_id(duration_minutes)')
    .eq('id', input.appointmentId)
    .eq('business_id', session.business_id)
    .maybeSingle();

  if (fetchErr || !raw) throw new Error('Cita no encontrada');

  const appt = raw as unknown as {
    id: string;
    business_id: string;
    staff_id: string;
    status: string;
    service: { duration_minutes: number };
  };

  if (!['pending', 'confirmed'].includes(appt.status)) {
    throw new Error('Solo se pueden reagendar citas pendientes o confirmadas');
  }

  // Calcular nuevo rango — usar hora local que mandó el cliente
  const [hh, mm] = input.newStartTime.split(':').map(Number);
  const startDate = new Date(`${input.newDate}T00:00:00`);
  startDate.setHours(hh ?? 0, mm ?? 0, 0, 0);
  const endDate = new Date(startDate.getTime() + appt.service.duration_minutes * 60_000);

  const newStaffId   = input.newStaffId ?? appt.staff_id;
  const newStartsAt  = startDate.toISOString();
  const newEndsAt    = endDate.toISOString();

  // Pre-check de conflictos (el EXCLUDE constraint del DB es la red de seguridad)
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
    throw new Error('El nuevo horario tiene conflicto con otra cita');
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      starts_at:            newStartsAt,
      ends_at:              newEndsAt,
      staff_id:             newStaffId,
      status:               'confirmed',
      modified_by_staff_id: session.staff_id,
      modified_at:          new Date().toISOString(),
    })
    .eq('id', input.appointmentId)
    .eq('business_id', session.business_id);

  if (error) throw new Error(`rescheduleAppointment failed: ${error.message}`);
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
