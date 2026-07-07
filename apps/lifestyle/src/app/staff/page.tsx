// ─── Staff — Vista del Barbero ────────────────────────────────────────────────
// Server Component — sin protección de middleware.
// Sin sesión muestra BarbershopPrompt → el login por PIN queda scopeado por
// negocio en /[slug]/staff (MT-02, sin login sin scope).
//
// Flujos (Opción C — S6-UI-01):
//   · Sin sesión                  → BarbershopPrompt (→ /[slug]/staff)
//   · role 'owner'|'admin'|'assistant' → redirect('/dashboard')
//   · role 'barber'               → StaffLayout con sus propias citas
//
// El modo gestión del barbero vive en su PROPIA ruta: /staff/gestion.
//
// REGLA: service_role_key nunca sale al cliente.

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import {
  getStaffDayAppointments,
  getStaffRecurringAvailability,
  getStaffBlockRequests,
  toDateStr,
} from '@/lib/dashboard.types';
import { getCurrentSession } from '@/lib/auth';
import StaffLayout from '@/components/staff/StaffLayout';
import BarbershopPrompt from '@/components/staff/BarbershopPrompt';

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
  // `view` es compat-only: el antiguo /staff?view=manage migró a /staff/gestion.
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const { date: rawDate, view: rawView } = await searchParams;
  const date = isValidDate(rawDate) ? rawDate : toDateStr(new Date());

  // Shim de compatibilidad — bookmarks/links viejos a /staff?view=manage
  // se redirigen a la ruta propia /staff/gestion (preservando la fecha).
  if (rawView === 'manage') {
    redirect(`/staff/gestion?date=${date}`);
  }

  // 1. Sesión activa — ls_session (PIN/token) o Supabase Auth
  const session = await getCurrentSession();

  // Sin sesión → fallback: pedir el negocio y rutear a /[slug]/staff, donde el
  // login por PIN queda scopeado al negocio (MT-02). No hay login sin scope.
  if (!session) {
    return <BarbershopPrompt />;
  }

  // Cualquier rol que no sea barbero (owner / admin / assistant) → su vista vive
  // en el dashboard. El asistente es canónico en /dashboard (no se duplica aquí).
  if (session.role !== 'barber') {
    redirect('/dashboard');
  }

  const businessId = session.business_id;

  // ── Barbero: solo sus propias citas ──────────────────────────────────────
  // role === 'barber' — staffId requerido (viene de la sesión PIN)
  if (!session.staff_id) {
    // Sin staffId no hay barbero identificado → re-login scopeado por negocio
    return <BarbershopPrompt />;
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
