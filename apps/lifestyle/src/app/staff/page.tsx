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
  getStaffRecurringAvailability,
  getStaffBlockRequests,
} from '@/lib/dashboard.types';
// Read barbero-only: el día CON tipAmount (Paso 7). Solo esta ruta trae la propina.
import { getBarberDayAppointments } from '@/lib/barberDay';
import { todayStrInTz } from '@/lib/dayWindow';
import { getCurrentSession, getBusinessTimezone } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';
import StaffLayout from '@/components/staff/StaffLayout';
import BarbershopPrompt from '@/components/staff/BarbershopPrompt';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function StaffPage({
  searchParams,
}: {
  // `view` es compat-only: el antiguo /staff?view=manage migró a /staff/gestion.
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const { date: rawDate, view: rawView } = await searchParams;

  // Shim de compatibilidad — bookmarks/links viejos a /staff?view=manage
  // se redirigen a la ruta propia /staff/gestion (preservando la fecha EXPLÍCITA;
  // el default de "hoy" lo resuelve el destino, con la tz del negocio).
  if (rawView === 'manage') {
    redirect(isValidDate(rawDate) ? `/staff/gestion?date=${rawDate}` : '/staff/gestion');
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
      const { data } = await tenantDb(supabase, businessId)
        .table('staff')
        .select('name')
        .eq('id', staffId)
        .maybeSingle();
      staffName = (data as { name: string } | null)?.name ?? '';
    }
  }

  // La tz del negocio se resuelve PRIMERO: define el "hoy" default, acota el día
  // de las citas a la tz local (no a UTC) y alimenta la línea "Ahora" del timeline.
  // Sin esto, un negocio UTC-6 perdía sus citas ≥18:00 locales — y con el default
  // naive (toDateStr(new Date()) = día UTC del server), un barbero abriendo
  // después de las 18:00 MX caía directo en el día SIGUIENTE, vacío.
  const timezone = await getBusinessTimezone(businessId);
  const date = isValidDate(rawDate) ? rawDate : todayStrInTz(timezone);

  // Fetch en paralelo — citas del día (modelo rico, solo suyas, día en tz local) +
  // disponibilidad + solicitudes.
  const [appointments, availability, blockRequests] = await Promise.all([
    getBarberDayAppointments(businessId, staffId, date, timezone),
    getStaffRecurringAvailability(staffId),
    getStaffBlockRequests(staffId),
  ]);

  // El barbero solo se agenda a sí mismo: staffOptions = [él]. El selector de
  // barbero en "reagendar" y "nueva cita" no ofrece a otros — coherente con
  // "el barbero ve/gestiona solo sus citas".
  const staffOptions = [{ id: staffId, name: staffName }];

  return (
    <StaffLayout
      staffId={staffId}
      staffName={staffName}
      businessId={businessId}
      date={date}
      timezone={timezone}
      initialAppointments={appointments}
      availability={availability}
      initialBlockRequests={blockRequests}
      staffOptions={staffOptions}
    />
  );
}
