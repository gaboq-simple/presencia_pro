// ─── Dashboard — Owner / Assistant / Admin ────────────────────────────────────
// Server Component — ruta protegida por middleware.
//
// Responsabilidades:
//   1. Obtiene sesión activa via getCurrentSession() — ls_session (PIN) o Supabase
//      Auth (dueño por email+password). Siempre de UNA sucursal (el token de
//      organización fue retirado): el business_id sale de la sesión.
//   2. Guard de rol — barbers van a /staff.
//   3. Resuelve la fecha del día desde searchParams (?date=YYYY-MM-DD).
//   4. Fetch en paralelo: citas del día + staff activo + solicitudes + fotos.
//   5. Calcula ingresos del día.
//   6. Pasa todo como props serializables a DashboardLayout.
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
} from '@/lib/dashboard.types';
import { todayStrInTz } from '@/lib/dayWindow';
import { getCurrentSession, getBusinessName, getBusinessTimezone } from '@/lib/auth';
import { getCabos } from '@/lib/cabosData';
import { getCortesDesde } from '@/lib/corteData';
import { getSemanaHero } from '@/lib/semanaHero';
import { after } from 'next/server';
import { touchOwnerLastSeen } from '@/lib/ownerPresence';
import DashboardLayout from '@/components/admin/DashboardLayout';
import AssistantControlDesk from '@/components/staff/AssistantControlDesk';
import OwnerTabs from '@/components/admin/OwnerTabs';
import ClientelaView from '@/components/admin/ClientelaView';
import NegocioView from '@/components/admin/NegocioView';
import AdministrarView from '@/components/admin/AdministrarView';
import ActividadView from '@/components/admin/ActividadView';
import { getActivityFeed } from '@/lib/activityFeed';
import { getRetentionFeed, getContactadosCount } from '@/lib/retentionFeed';
import { getClientelaStats } from '@/lib/clientelaStats';
import { getNegocioRevenue } from '@/lib/negocioMetrics';
import { getNegocioOccupancy } from '@/lib/negocioOccupancy';
import { getNegocioStaffRecompra } from '@/lib/negocioStaff';
import { getPulsoHoy } from '@/lib/pulsoHoy';
import { getPulsoSemana } from '@/lib/pulsoSemana';
import { getFuga } from '@/lib/fugaData';
import { getEquipoSemana } from '@/lib/equipoSemanaData';
import { getDiaRail } from '@/lib/diaRailData';
import { getAtencionCount } from '@/lib/atencionCount';
import { getAnalisis } from '@/lib/analisisData';
import AnalisisView from '@/components/admin/AnalisisView';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00`));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  // 1. Sesión activa — ls_session (token) o Supabase Auth
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  // Guard de rol — barbers van a /staff
  if (session.role === 'barber') redirect('/staff');

  // Solo owner / assistant / admin pueden acceder al dashboard
  const ALLOWED = ['owner', 'assistant', 'admin'] as const;
  if (!ALLOWED.includes(session.role as typeof ALLOWED[number])) redirect('/login');

  const { date: rawDate } = await searchParams;

  // ── Resolución de business_id ──────────────────────────────────────────────
  // Siempre una sola sucursal (el token de organización fue retirado): el business_id
  // sale de la sesión.
  const businessId = session.business_id;

  // 2. Resolver fecha desde searchParams (default: hoy EN LA TZ DEL NEGOCIO).
  // Con el naive de antes (toDateStr(new Date()) = día UTC del server en Vercel),
  // el dueño/asistente abriendo después de las 18:00 MX caía en el día siguiente,
  // vacío. La tz también alimenta el "Ir a hoy" del DashboardLayout.
  const timezone = await getBusinessTimezone(businessId);
  const date = isValidDate(rawDate) ? rawDate : todayStrInTz(timezone);

  // ── Instrumentación del riesgo terminal (D6) ───────────────────────────────
  // "El dueño dejó de abrir la app" es el modo de falla más probable de este
  // producto y hasta hoy era INVISIBLE: no existe ninguna analítica de uso. Este
  // touch es el único dato que lo delata, y es el insumo de la señal 4 del digest
  // (D7).
  //
  // 🔴 El guard es `admin`, NO `owner`, y eso se descubrió al verificarlo por
  // ruta real: el dueño del demo entra con `role='admin'` y la primera versión de
  // este bloque (que preguntaba por `'owner'`) nunca disparó. El CHECK de la BD
  // solo admite admin/barber/assistant — `'owner'` sobrevive en el tipo AuthRole
  // como residuo de las sesiones por token, que ya se retiraron: NINGUNA sesión
  // viva puede tenerlo. Con el guard viejo, la señal 4 habría dicho "el dueño
  // nunca abrió la app" para siempre, que es la peor forma de fallar: una alarma
  // falsa que parece un dato.
  //
  // El asistente queda FUERA a propósito: vive dentro del negocio y su visita no
  // dice nada sobre el dueño, que es a quien se está midiendo.
  if (session.role === 'admin' || session.role === 'owner') {
    // `after()` y no un `void` suelto: el fire-and-forget en un Server Component
    // puede quedar cancelado cuando termina el render. Es el patrón que ya usa
    // `api/bot/route.ts` para el trabajo posterior a la respuesta.
    after(() => touchOwnerLastSeen(businessId));
  }
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
    // timezone NO se re-desestructura: ya vive arriba (resolvió el default de
    // fecha) y es el mismo valor de businesses.timezone.
    const { name: businessName, requireCustomerPhone, maxLateMinutes } = bizConfig;

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
  const [retentionFeed, contactados, clientelaStats, negocioRevenue, negocioOccupancy, negocioStaff, pulsoHoy, pulsoSemana, fuga, activityPage] = await Promise.all([
    getRetentionFeed(businessId),
    getContactadosCount(businessId),
    getClientelaStats(businessId),
    getNegocioRevenue(businessId),
    getNegocioOccupancy(businessId),
    getNegocioStaffRecompra(businessId),
    getPulsoHoy(businessId),
    getPulsoSemana(businessId),
    getFuga(businessId),
    getActivityFeed(businessId),
  ]);

  // 7. Cabos sueltos (D3) — citas pasadas que nadie resolvió. Se fetchea ACÁ y no
  //    en DashboardLayout porque ese componente declara no fetchar datos propios.
  const cabos = await getCabos(businessId);

  // 7b. El badge de la fila plegada "Clientes inactivos y lista de espera"
  //     (dv3-4'): una fila cerrada esconde lo que hay adentro y el badge es lo
  //     único que delata que ahí hay gente esperando.
  const atencionCount = await getAtencionCount(businessId);

  // 8. Cortes de los últimos 7 días locales (D5), por la misma razón que arriba.
  //    Se pasan SIN resolver: la regla "la última fila por día manda" vive en
  //    lib/corte.ts (una sola definición, la misma que usará el digest de D7).
  const hoyLocal = todayStrInTz(timezone);
  const desde = new Date(`${hoyLocal}T12:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - 6);
  const cortes = await getCortesDesde(businessId, desde.toISOString().slice(0, 10));

  // 9. El héroe de la semana (dv3-3') — mismo contrato: lo fetcha la página.
  const semanaHero = await getSemanaHero(businessId, timezone);

  // 10. El equipo de la semana que contiene `date` (dv3-4'). Server-side y no por
  //     el endpoint client-side que reemplaza: ese tarda 1–3.3 s y dejaba un
  //     "Cargando…" que movía el alto de la página en miles de píxeles.
  const equipoSemana = await getEquipoSemana(businessId, date, timezone);

  // 11. El riel del día (dv3-4'). Sin query: mapea lo ya cargado y es donde vive
  //     el reloj — un `Date.now()` en render es impuro y daría dos rieles
  //     distintos para el mismo árbol.
  const diaRail = await getDiaRail(appointments, staffList, date, timezone);

  // 12. Análisis (dv3-6): las dos lecturas nuevas de la pestaña. Los otros tres
  //     bloques reusan negocioRevenue / negocioOccupancy / negocioStaff, ya cargados.
  const analisis = await getAnalisis(businessId, timezone);

  const dashboardPanel = (
    <DashboardLayout
      businessName={businessName}
      timezone={timezone}
      pendingBlockRequests={pendingBlockRequests}
      staffForPhotos={staffForPhotos}
      staffForManagement={staffForManagement}
      servicesForManagement={servicesForManagement}
      cabosCount={cabos.total}
      cortes={cortes}
      hoyLocal={hoyLocal}
      atencionCount={atencionCount}
    />
  );

  return (
    <OwnerTabs
      panorama={
        <NegocioView
          revenue={negocioRevenue}
          occupancy={negocioOccupancy}
          barberos={negocioStaff}
          pulso={pulsoHoy}
          semana={pulsoSemana}
          feed={retentionFeed}
          contactados={contactados}
          fuga={fuga}
          semanaHero={semanaHero}
        />
      }
      analisis={
        <AnalisisView
          revenue={negocioRevenue}
          occupancy={negocioOccupancy}
          barberos={negocioStaff}
          analisis={analisis}
        />
      }
      clientela={<ClientelaView stats={clientelaStats} />}
      administrar={
        <AdministrarView
          date={date}
          timezone={timezone}
          dayRevenue={dayRevenue}
          rail={diaRail}
          equipo={equipoSemana}
          panel={dashboardPanel}
        />
      }
      actividad={
        <ActividadView
          initialEvents={activityPage.events}
          initialCursor={activityPage.nextCursor}
          timezone={timezone}
          hoyLocal={hoyLocal}
        />
      }
    />
  );
}
