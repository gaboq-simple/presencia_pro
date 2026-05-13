// ─── Staff — Vista del Barbero / Asistente ────────────────────────────────────
// Server Component — sin protección de middleware.
// Muestra PinForm si no hay sesión activa (acceso por PIN para barberos).
//
// Flujos:
//   · Sin sesión                → PinForm
//   · role 'owner' | 'admin'   → redirect('/dashboard')
//   · role 'barber'             → StaffLayout con sus propias citas
//   · role 'assistant'          → AssistantLayout con TODAS las citas del negocio
//
// REGLA: service_role_key nunca sale al cliente.

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import {
  getDayAppointments,
  getActiveStaffWithAvailability,
  getStaffDayAppointments,
  getStaffRecurringAvailability,
  getStaffBlockRequests,
  toDateStr,
} from '@/lib/dashboard.types';
import { getCurrentSession, getBusinessName } from '@/lib/auth';
import StaffLayout from '@/components/staff/StaffLayout';
import AssistantLayout from '@/components/staff/AssistantLayout';
import PinForm from '@/components/staff/PinForm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

function deriveUpcomingCustomerId(
  appointments: { starts_at: string; customer: { id: string } | null }[],
): string | null {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const found = appointments.find((a) => {
    if (!a.customer?.id) return false;
    const startsAt = new Date(a.starts_at).getTime();
    return startsAt >= now && startsAt <= now + twoHoursMs;
  });
  return found?.customer?.id ?? null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  // 1. Sesión activa — ls_session (PIN/token) o Supabase Auth
  const session = await getCurrentSession();

  // Sin sesión → formulario de PIN (barberos vienen directamente a /staff)
  if (!session) {
    return <PinForm />;
  }

  // Owner / admin → dashboard
  if (session.role === 'owner' || session.role === 'admin') {
    redirect('/dashboard');
  }

  const businessId = session.business_id;

  // 2. Resolver fecha desde searchParams (default: hoy)
  const { date: rawDate, view: rawView } = await searchParams;
  const date = isValidDate(rawDate) ? rawDate : toDateStr(new Date());

  // ── Asistente: AssistantLayout — ve TODAS las citas + puede crear/cancelar ──
  if (session.role === 'assistant') {
    const [businessName, appointments, allStaff] = await Promise.all([
      getBusinessName(businessId),
      getDayAppointments(businessId, date),
      getActiveStaffWithAvailability(businessId, new Date(`${date}T12:00:00`).getDay()),
    ]);

    // Filtrar solo barberos para el formulario de nueva cita
    const staffOptions = allStaff
      .filter((s) => s.role === 'barber')
      .map((s) => ({ id: s.id, name: s.name }));

    return (
      <AssistantLayout
        businessId={businessId}
        businessName={businessName}
        date={date}
        initialAppointments={appointments}
        staffOptions={staffOptions}
      />
    );
  }

  // ── Barbero en vista gestion (Feature 5B — Opción B) ─────────────────────
  // Barbero accede a AssistantLayout con ?view=manage para gestionar citas
  // del negocio. El staff_id de la sesión se usa para trazabilidad.
  if (session.role === 'barber' && rawView === 'manage') {
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const [businessName, appointments, allStaff] = await Promise.all([
      getBusinessName(businessId),
      getDayAppointments(businessId, date),
      getActiveStaffWithAvailability(businessId, dayOfWeek),
    ]);
    const staffOptions = allStaff
      .filter((s) => s.role === 'barber')
      .map((s) => ({ id: s.id, name: s.name }));
    return (
      <AssistantLayout
        businessId={businessId}
        businessName={businessName}
        date={date}
        initialAppointments={appointments}
        staffOptions={staffOptions}
      />
    );
  }

  // ── Barbero: solo sus propias citas ──────────────────────────────────────
  // role === 'barber' — staffId requerido (viene de la sesión PIN)
  if (!session.staff_id) {
    // Sin staffId no hay barbero identificado → volver al PIN
    return <PinForm />;
  }

  const staffId = session.staff_id;

  // Nombre del barbero — desde sesión Supabase Auth o DB
  let staffName = session.name ?? '';
  if (!staffName) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      const supabase = createClient(url, key);
      const { data } = await supabase
        .from('staff')
        .select('name')
        .eq('id', staffId)
        .maybeSingle();
      staffName = (data as { name: string } | null)?.name ?? '';
    }
  }

  // Fetch en paralelo — citas del día + disponibilidad + solicitudes
  const [appointments, availability, blockRequests] = await Promise.all([
    getStaffDayAppointments(staffId, date),
    getStaffRecurringAvailability(staffId),
    getStaffBlockRequests(staffId),
  ]);

  const upcomingCustomerId = deriveUpcomingCustomerId(appointments);

  return (
    <StaffLayout
      staffId={staffId}
      staffName={staffName}
      businessId={businessId}
      date={date}
      initialAppointments={appointments}
      availability={availability}
      initialBlockRequests={blockRequests}
      upcomingCustomerId={upcomingCustomerId}
      role="barber"
    />
  );
}
