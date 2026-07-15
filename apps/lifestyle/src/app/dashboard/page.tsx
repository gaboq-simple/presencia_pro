// ─── Dashboard — Owner / Assistant / Admin ────────────────────────────────────
// Server Component — ruta protegida por middleware.
//
// Responsabilidades:
//   1. Obtiene sesión activa via getCurrentSession() — soporta ls_session
//      (acceso por token/PIN) y Supabase Auth (operadores con email+password).
//   2. Guard de rol — barbers van a /staff.
//   3. Resuelve la fecha del día desde searchParams (?date=YYYY-MM-DD).
//   4. Multi-sucursal: si la sesión es type='organization', carga la lista de
//      sucursales y usa ?branch=UUID para seleccionar la activa.
//      - ?branch=all (o ausente) → ConsolidatedView (vista consolidada de org).
//      - ?branch=<UUID> válido   → DashboardLayout para esa sucursal.
//      - Otro valor              → redirect a ?branch=all.
//   5. Fetch en paralelo: citas del día + staff activo + solicitudes + fotos.
//   6. Calcula ingresos del día.
//   7. Pasa todo como props serializables a DashboardLayout.
//
// REGLA: service_role_key nunca sale al cliente.

import { redirect } from 'next/navigation';
import {
  getDayAppointments,
  getActiveStaffWithAvailability,
  getDayExceptions,
  getBusinessDeskConfig,
  queryStaffBlocksForDay,
  computeDayRevenue,
  getPendingBlockRequests,
  getActiveStaffWithPhoto,
  getAllStaffForManagement,
  getServicesForManagement,
  toDateStr,
} from '@/lib/dashboard.types';
import { getCurrentSession, getBusinessName, getOrganizationBranches } from '@/lib/auth';
import DashboardLayout from '@/components/admin/DashboardLayout';
import ConsolidatedView from '@/components/admin/ConsolidatedView';
import AssistantControlDesk from '@/components/staff/AssistantControlDesk';
import OwnerTabs from '@/components/admin/OwnerTabs';
import HoyFeed from '@/components/admin/HoyFeed';
import ClientelaView from '@/components/admin/ClientelaView';
import NegocioView from '@/components/admin/NegocioView';
import ActividadView from '@/components/admin/ActividadView';
import { getActivityFeed } from '@/lib/activityFeed';
import { getRetentionFeed, getContactadosCount } from '@/lib/retentionFeed';
import { getClientelaStats } from '@/lib/clientelaStats';
import { getNegocioRevenue } from '@/lib/negocioMetrics';
import { getNegocioOccupancy } from '@/lib/negocioOccupancy';
import { getNegocioStaffRecompra } from '@/lib/negocioStaff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

function isValidUUID(s: string | undefined): s is string {
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; branch?: string }>;
}) {
  // 1. Sesión activa — ls_session (token) o Supabase Auth
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  // Guard de rol — barbers van a /staff
  if (session.role === 'barber') redirect('/staff');

  // Solo owner / assistant / admin pueden acceder al dashboard
  const ALLOWED = ['owner', 'assistant', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) redirect('/login');

  const { date: rawDate, branch: rawBranch } = await searchParams;

  // ── Resolución de business_id ──────────────────────────────────────────────

  let businessId: string;
  let branches: Array<{ id: string; name: string }> = [];
  let organizationId: string | undefined;

  if (session.type === 'organization') {
    organizationId = session.organization_id;
    branches = await getOrganizationBranches(session.business_ids);

    // branch=all (o sin ?branch) → vista consolidada de organización
    if (!rawBranch || rawBranch === 'all') {
      if (branches.length === 0) redirect('/login'); // organización sin sucursales activas
      return (
        <ConsolidatedView
          organizationId={organizationId}
          businessIds={session.business_ids}
          branches={branches}
        />
      );
    }

    // branch=<UUID> válido → DashboardLayout para esa sucursal
    const validBranch =
      isValidUUID(rawBranch) && session.business_ids.includes(rawBranch)
        ? rawBranch
        : null;

    if (!validBranch) {
      // Cualquier otro valor → redirigir a vista consolidada
      redirect('/dashboard?branch=all');
    }

    businessId = validBranch;
  } else {
    // Sesión de negocio directo — funciona exactamente como antes
    businessId = session.business_id;
  }

  // 2. Resolver fecha desde searchParams (default: hoy)
  const date = isValidDate(rawDate) ? rawDate : toDateStr(new Date());
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay(); // 0=dom … 6=sáb

  // ── Vista asistente — mesa de control propia (S6-UI-02) ──────────────────
  // Diverge de owner/admin: monta AssistantControlDesk (diseño congelado).
  // /staff/gestion del barbero sigue usando AssistantLayout intacto.
  if (session.role === 'assistant') {
    // Etapa 1 (paralela): config del negocio en 1 query fusionada + staff +
    // excepciones. Ninguna depende de otra.
    const [bizConfig, allStaff, dayExceptions] = await Promise.all([
      getBusinessDeskConfig(businessId),
      getActiveStaffWithAvailability(businessId, dayOfWeek),
      getDayExceptions(businessId, date),
    ]);
    const { name: businessName, timezone, requireCustomerPhone, maxLateMinutes } = bizConfig;

    // Etapa 2 (paralela): citas + bloqueos del día, reusando la tz y los staffIds
    // ya cargados (evita re-consultar businesses y staff). activeStaffIds = TODOS
    // los activos, para igualar exactamente el set del fetch interno de la action.
    const activeStaffIds = allStaff.map((s) => s.id);
    const [appointments, staffBlocks] = await Promise.all([
      getDayAppointments(businessId, date, timezone),
      queryStaffBlocksForDay(activeStaffIds, timezone, date),
    ]);
    // Discriminador de agendabilidad (candidato a): "atiende clientes" = tiene ≥1
    // servicio mapeado (staff_services), NO role==='barber'. Así un dueño role='admin'
    // que corta pelo entra como columna agendable, y el asistente (sin servicios) queda
    // fuera. Coherente con el engine, que ya gatea por staff_services (getStaffForService).
    const staffOptions = allStaff
      .filter((s) => s.hasServices)
      .map((s) => ({ id: s.id, name: s.name }));
    // Disponibilidad del panorama: incluye breaks (para validar dónde cabe un reacomodo).
    const staffWithAvailability = allStaff
      .filter((s) => s.hasServices)
      .map((s) => ({
        id: s.id,
        name: s.name,
        availabilityToday: s.availabilityToday
          ? {
              start_time: s.availabilityToday.start_time,
              end_time: s.availabilityToday.end_time,
              break_start: s.availabilityToday.break_start ?? null,
              break_end: s.availabilityToday.break_end ?? null,
            }
          : null,
      }));
    return (
      <AssistantControlDesk
        businessId={businessId}
        businessName={businessName}
        date={date}
        timezone={timezone}
        initialAppointments={appointments}
        staffOptions={staffOptions}
        staffWithAvailability={staffWithAvailability}
        initialStaffBlocks={staffBlocks}
        dayExceptions={dayExceptions}
        requireCustomerPhone={requireCustomerPhone}
        maxLateMinutes={maxLateMinutes}
      />
    );
  }

  // 3. Nombre del negocio para vista owner/admin
  const businessName = await getBusinessName(businessId);

  // 4. Fetch en paralelo — citas del día + staff activo + solicitudes + fotos + gestión + catálogo
  const [appointments, staffList, pendingBlockRequests, staffForPhotos, staffForManagement, servicesForManagement] = await Promise.all([
    getDayAppointments(businessId, date),
    getActiveStaffWithAvailability(businessId, dayOfWeek),
    getPendingBlockRequests(businessId),
    getActiveStaffWithPhoto(businessId),
    getAllStaffForManagement(businessId),
    getServicesForManagement(businessId),
  ]);

  // 5. Ingresos del día — función pura sobre datos ya cargados
  const dayRevenue = computeDayRevenue(appointments);

  // 6. Feed de retención (pestaña "Hoy") + pulso + agregados de Clientela (pestaña 3)
  //    — todo scopeado por el businessId de la sesión.
  const [retentionFeed, contactados, clientelaStats, negocioRevenue, negocioOccupancy, negocioStaff, activityPage] = await Promise.all([
    getRetentionFeed(businessId),
    getContactadosCount(businessId),
    getClientelaStats(businessId),
    getNegocioRevenue(businessId),
    getNegocioOccupancy(businessId),
    getNegocioStaffRecompra(businessId),
    getActivityFeed(businessId),
  ]);

  const dashboardPanel = (
    <DashboardLayout
      businessId={businessId}
      businessName={businessName}
      date={date}
      appointments={appointments}
      staffList={staffList}
      dayRevenue={dayRevenue}
      pendingBlockRequests={pendingBlockRequests}
      staffForPhotos={staffForPhotos}
      staffForManagement={staffForManagement}
      servicesForManagement={servicesForManagement}
      branches={branches.length > 1 ? branches : undefined}
      organizationId={organizationId}
    />
  );

  return (
    <OwnerTabs
      hoy={<HoyFeed feed={retentionFeed} contactados={contactados} />}
      negocio={<NegocioView revenue={negocioRevenue} occupancy={negocioOccupancy} barberos={negocioStaff} />}
      clientela={<ClientelaView stats={clientelaStats} />}
      panel={dashboardPanel}
      actividad={<ActividadView initialEvents={activityPage.events} initialCursor={activityPage.nextCursor} />}
    />
  );
}
