// ─── DashboardLayout ──────────────────────────────────────────────────────────
// Server Component — shell estructural del dashboard admin.
//
// Responsabilidades:
//   - Header: nombre del negocio + badge de solicitudes pendientes + nav días
//   - Sección principal: BlockRequestsInbox + DashboardRealtimeProvider
//   - Sección inferior: MetricsSummary con selector de período
//   - Link a /staff para cambiar a vista de barbero
//
// NO fetcha datos propios — recibe todo del page.tsx.

import Link from 'next/link';
import type {
  DashboardAppointment,
  DashboardStaff,
  DayRevenue,
  BlockRequestWithStaff,
  AdminStaffPhotoRow,
  AdminStaffManagementRow,
} from '@/lib/dashboard.types';
import { toDateStr } from '@/lib/dashboard.types';
import DashboardRealtimeProvider from './DashboardRealtimeProvider';
import MetricsSummary from './MetricsSummary';
import StaffMetricsPanel from './StaffMetricsPanel';
import BlockRequestsInbox from './BlockRequestsInbox';
import StaffPhotoManager from './StaffPhotoManager';
import StaffManagementPanel from './StaffManagementPanel';
import InactiveClientsPanel from './InactiveClientsPanel';
import ReportsConfigPanel  from './ReportsConfigPanel';
import ReviewConfigPanel   from './ReviewConfigPanel';
import WaitlistPanel       from './WaitlistPanel';
import BranchSelector      from './BranchSelector';

// ─── Props ────────────────────────────────────────────────────────────────────

type Branch = { id: string; name: string };

type Props = {
  businessId: string;
  businessName: string;
  date: string;                          // 'YYYY-MM-DD'
  appointments: DashboardAppointment[];
  staffList: DashboardStaff[];
  dayRevenue: DayRevenue;
  pendingBlockRequests: BlockRequestWithStaff[];
  staffForPhotos: AdminStaffPhotoRow[];
  staffForManagement: AdminStaffManagementRow[];
  /** Lista de sucursales — solo presente en sesiones de organización con >1 sucursal */
  branches?: Branch[];
  /** ID de la organización — presente solo en sesiones de organización */
  organizationId?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offsetDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function formatDateDisplay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardLayout({
  businessId,
  businessName,
  date,
  appointments,
  staffList,
  dayRevenue,
  pendingBlockRequests,
  staffForPhotos,
  staffForManagement,
  branches,
  organizationId,
}: Props) {
  const prevDate = offsetDay(date, -1);
  const nextDate = offsetDay(date, +1);

  const pendingCount  = pendingBlockRequests.length;
  const hasUrgent     = pendingBlockRequests.some((r) => r.urgent);

  // Preservar ?branch= en los links de navegación de días para sesiones de org
  const branchParam = organizationId ? `&branch=${businessId}` : '';

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">

          {/* Negocio + selector de sucursal (org) + badge solicitudes + link vista barbero */}
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              {branches && branches.length > 1 ? (
                /* Selector de sucursal — sesión de organización */
                <BranchSelector branches={branches} currentBranchId={businessId} />
              ) : (
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {businessName}
                </span>
              )}
            </div>

            <div className="ml-3 flex shrink-0 items-center gap-3">
              {/* Badge de solicitudes pendientes */}
              {pendingCount > 0 && (
                <div className="relative" aria-label={`${pendingCount} solicitudes pendientes`}>
                  {/* Icono campana */}
                  <svg
                    className="h-5 w-5 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                    />
                  </svg>
                  {/* Numero */}
                  <span
                    className={`absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      hasUrgent ? 'bg-red-600' : 'bg-gray-700'
                    }`}
                  >
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                </div>
              )}

              <Link
                href="/staff"
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Vista barbero →
              </Link>
            </div>
          </div>

          {/* Navegación de días */}
          <div className="mt-2 flex items-center gap-2">
            <Link
              href={`/dashboard?date=${prevDate}${branchParam}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 text-base text-gray-600 hover:bg-gray-50"
              aria-label="Dia anterior"
            >
              ‹
            </Link>
            <div className="flex flex-1 flex-col items-center">
              <span className="text-sm font-medium capitalize text-gray-800">
                {formatDateDisplay(date)}
              </span>
              {date !== toDateStr(new Date()) && (
                <Link
                  href={`/dashboard?date=${toDateStr(new Date())}${branchParam}`}
                  className="mt-0.5 text-xs text-gray-400 underline hover:text-gray-600"
                >
                  Ir a hoy
                </Link>
              )}
            </div>
            <Link
              href={`/dashboard?date=${nextDate}${branchParam}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 text-base text-gray-600 hover:bg-gray-50"
              aria-label="Dia siguiente"
            >
              ›
            </Link>
          </div>

        </div>
      </header>

      {/* ── Contenido principal ────────────────────────────────────────────── */}
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-8">

        {/* Ingresos del día — resumen rápido */}
        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500">Ingresos del día</p>
          <p className="mt-0.5 text-2xl font-bold text-gray-900">
            {formatCurrency(dayRevenue.total, dayRevenue.currency)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {dayRevenue.completedCount}{' '}
            {dayRevenue.completedCount === 1 ? 'cita completada' : 'citas completadas'}
          </p>
        </div>

        {/* Bandeja de solicitudes de bloqueo */}
        <BlockRequestsInbox initialRequests={pendingBlockRequests} />

        {/* Timeline del día + disponibilidad de barberos (con Realtime) */}
        <DashboardRealtimeProvider
          businessId={businessId}
          date={date}
          initialAppointments={appointments}
          staffList={staffList}
        />

        {/* Métricas por período */}
        <MetricsSummary
          businessId={businessId}
          date={date}
          initialRevenue={dayRevenue}
        />

        {/* Rendimiento del equipo — métricas por barbero */}
        <StaffMetricsPanel date={date} businessId={businessId} />

        {/* Clientes inactivos — panel de seguimiento */}
        <InactiveClientsPanel businessName={businessName} />

        {/* Lista de espera */}
        <WaitlistPanel />

        {/* Configuración de reportes semanales */}
        <ReportsConfigPanel />

        {/* Configuración de reseñas automáticas */}
        <ReviewConfigPanel />

        {/* Gestión de staff — activo/inactivo + PIN */}
        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50">
            Gestión de staff
          </summary>
          <div className="border-t border-gray-200 px-4 py-4">
            <StaffManagementPanel initialStaff={staffForManagement} />
          </div>
        </details>

        {/* Fotos del equipo — sección colapsable, solo admin */}
        <details className="rounded-lg border border-gray-200">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50">
            Fotos del equipo
          </summary>
          <div className="border-t border-gray-200 px-4 py-4">
            <StaffPhotoManager initialStaff={staffForPhotos} />
          </div>
        </details>

      </main>

      <footer className="border-t border-gray-100 px-4 py-4 text-center">
        <p className="text-xs text-gray-400">
          Soporte:{' '}
          <a href="mailto:contacto@zentriq.mx" className="hover:text-gray-600 underline">
            contacto@zentriq.mx
          </a>
          {' · '}
          <a href="/aviso-de-privacidad" className="hover:text-gray-600 underline">
            Aviso de privacidad
          </a>
          {' · '}
          <a href="/arco" className="hover:text-gray-600 underline">
            Derechos ARCO
          </a>
        </p>
      </footer>
    </div>
  );
}
