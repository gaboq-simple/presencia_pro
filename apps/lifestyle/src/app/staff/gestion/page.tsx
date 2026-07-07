// ─── Staff / Gestión — Vista del Barbero gestionando citas del negocio ────────
// Server Component — ruta propia del modo gestión del barbero (Opción C).
// Reemplaza la antigua rama /staff?view=manage.
//
// Por dentro reusa AssistantLayout (igual que la recepcionista), pero vive en su
// PROPIA ruta para poder divergir de la vista de recepción sin otra cirugía.
//
// Flujos:
//   · Sin sesión              → BarbershopPrompt (mismo patrón que /staff: login por
//                               PIN scopeado por negocio en /[slug]/staff — MT-02)
//   · role 'owner' | 'admin'  → redirect('/dashboard')
//   · role 'assistant'        → redirect('/dashboard')  (su vista canónica vive ahí)
//   · role 'barber'           → AssistantLayout con TODAS las citas del negocio
//
// REGLA: service_role_key nunca sale al cliente.

import { redirect } from 'next/navigation';
import {
  getDayAppointments,
  getActiveStaffWithAvailability,
  toDateStr,
} from '@/lib/dashboard.types';
import { getStaffBlocksForDay } from '@/app/staff/assistant-actions';
import { getCurrentSession, getBusinessName, getBusinessTimezone } from '@/lib/auth';
import AssistantLayout from '@/components/staff/AssistantLayout';
import BarbershopPrompt from '@/components/staff/BarbershopPrompt';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function StaffGestionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  // 1. Sesión activa — ls_session (PIN/token) o Supabase Auth
  const session = await getCurrentSession();

  // Sin sesión → fallback: pedir el negocio y rutear a /[slug]/staff, donde el
  // login por PIN queda scopeado al negocio (MT-02). No hay login sin scope.
  if (!session) {
    return <BarbershopPrompt />;
  }

  // Owner / admin / assistant → su vista canónica vive en el dashboard
  if (session.role !== 'barber') {
    redirect('/dashboard');
  }

  // Barbero sin staff_id → no hay barbero identificado, re-login scopeado por negocio
  if (!session.staff_id) {
    return <BarbershopPrompt />;
  }

  const businessId = session.business_id;

  // 2. Resolver fecha desde searchParams (default: hoy)
  const { date: rawDate } = await searchParams;
  const date = isValidDate(rawDate) ? rawDate : toDateStr(new Date());

  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const [businessName, timezone, appointments, allStaff, staffBlocks] = await Promise.all([
    getBusinessName(businessId),
    getBusinessTimezone(businessId),
    getDayAppointments(businessId, date),
    getActiveStaffWithAvailability(businessId, dayOfWeek),
    getStaffBlocksForDay(date),
  ]);

  // Solo barberos para el formulario de nueva cita
  const staffOptions = allStaff
    .filter((s) => s.role === 'barber')
    .map((s) => ({ id: s.id, name: s.name }));

  // Barberos con disponibilidad para el timeline
  const staffWithAvailability = allStaff
    .filter((s) => s.role === 'barber')
    .map((s) => ({
      id: s.id,
      name: s.name,
      availabilityToday: s.availabilityToday
        ? { start_time: s.availabilityToday.start_time, end_time: s.availabilityToday.end_time }
        : null,
    }));

  return (
    <AssistantLayout
      businessId={businessId}
      businessName={businessName}
      date={date}
      timezone={timezone}
      initialAppointments={appointments}
      staffOptions={staffOptions}
      staffWithAvailability={staffWithAvailability}
      initialStaffBlocks={staffBlocks}
    />
  );
}
