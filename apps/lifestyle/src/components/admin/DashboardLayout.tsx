// ─── DashboardLayout — el bloque de CONFIGURACIÓN de Administrar (dv3-4') ────
// Server Component. Antes era el shell entero del dashboard admin (header, nav
// de días, ingresos, métricas, agenda, y ocho paneles apilados). El Paso 4 del
// rediseño le saca el nivel 1 y lo deja en lo que de verdad es: el lugar donde
// se CONFIGURA el negocio.
//
// Qué se fue y a dónde:
//   · header + nav de días + "Ingresos de agenda del día" → `AdministrarView`
//     (el encabezado y el héroe de la pestaña).
//   · agenda del día (`DashboardRealtimeProvider`: DayTimeline +
//     StaffAvailability) → `DiaRail`, que dice lo mismo como riel de tiempo.
//   · `StaffMetricsPanel` (7 tarjetas × 6 tiles) → `EquipoSemana` (5 filas).
//   · `MetricsSummary` — y con él `HourlyPeaksChart`, `SourceBreakdown`,
//     `NoShowByDayChart` y `TopClientsCard` — deja de montarse: la mitad de sus
//     tiles vivía en cero, el día ya está en el héroe, y el canal se replantea
//     en la pestaña "Análisis" (Paso 6). Los componentes NO se borran.
//
// Qué se quedó y por qué: lo pasado sin resolver (D3) y el cuadre (D5) son del
// DÍA y viven arriba de la configuración; la bandeja de solicitudes es una cola
// de acciones, no un ajuste. Todo lo demás baja a cinco filas de disclosure.
//
// **Los paneles legacy no se tocan por dentro** (eso es el Paso 5): cambian de
// envoltorio, no de comportamiento. El CRUD, sus endpoints, el `management_audit`
// y la doble invalidación de cache siguen exactamente donde estaban.

import type {
  BlockRequestWithStaff,
  AdminStaffPhotoRow,
  AdminStaffManagementRow,
  AdminServiceRow,
} from '@/lib/dashboard.types';
import BlockRequestsInbox from './BlockRequestsInbox';
import CorteResumen, { type CorteParaDueno } from './CorteResumen';
import StaffPhotoManager from './StaffPhotoManager';
import StaffManagementPanel from './StaffManagementPanel';
import ServicesManagementPanel from './ServicesManagementPanel';
import InactiveClientsPanel from './InactiveClientsPanel';
import ReportsConfigPanel  from './ReportsConfigPanel';
import ReviewConfigPanel   from './ReviewConfigPanel';
import BusinessHoursPanel  from './BusinessHoursPanel';
import WaitlistPanel       from './WaitlistPanel';
import { ServiciosTab, EquipoTab, HorariosTab } from './AdminInlinePanel';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  businessName: string;
  /** IANA del negocio — baja a StaffManagementPanel para los horarios. */
  timezone: string;
  pendingBlockRequests: BlockRequestWithStaff[];
  staffForPhotos: AdminStaffPhotoRow[];
  staffForManagement: AdminStaffManagementRow[];
  servicesForManagement: AdminServiceRow[];
  /** Cabos sueltos (D3): citas pasadas que nadie resolvió, ventana 14 días. Lo
      calcula page.tsx — este componente no fetcha datos propios (ver encabezado). */
  cabosCount: number;
  /** Cortes de los últimos días (D5), sin resolver: puede haber varios por día y
      manda el último. Los resuelve CorteResumen. Mismo contrato que cabosCount. */
  cortes: CorteParaDueno[];
  /** Hoy en la tz del NEGOCIO — para saber si el corte de hoy ya se hizo. */
  hoyLocal: string;
  /** Clientes inactivos + gente en lista de espera — el badge de esa fila. */
  atencionCount: number;
};

// ─── Fila de disclosure ───────────────────────────────────────────────────────
// `<details>` nativo estilizado — la frontera del plan: nada de estado en React
// para abrir y cerrar una fila. El badge es opcional y solo aparece cuando hay
// algo que contar (un "0" ámbar sería una alarma de nada).

function FilaConfig({
  titulo, badge, children,
}: {
  titulo: string;
  badge?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="group border-t border-line first:border-t-0">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 py-3 marker:content-none">
        <span className="flex-1 text-[15px] font-medium text-ink">{titulo}</span>
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber">
            {badge}
          </span>
        )}
        <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardLayout({
  businessName,
  timezone,
  pendingBlockRequests,
  staffForPhotos,
  staffForManagement,
  servicesForManagement,
  cabosCount,
  cortes,
  hoyLocal,
  atencionCount,
}: Props) {
  const activeServices = servicesForManagement
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, price: s.price, currency: s.currency }));

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8">

      {/* Cabos sueltos (D3) — lo pasado sin resolver se VE, nunca se absorbe en
          un total: una cita sin cerrar no suma al ingreso ni cuenta como falta,
          así que desaparecería del cuadre sin dejar rastro. Dato y nada más. */}
      {cabosCount > 0 && (
        <div className="mt-5 rounded-xl bg-card p-4 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-[.10em] text-faint">Sin cerrar</p>
          <p className="mt-1 text-[15px] text-ink">
            {cabosCount === 1
              ? '1 cita pasada sigue sin resolver'
              : `${cabosCount} citas pasadas siguen sin resolver`}
          </p>
          <p className="mt-0.5 text-[11px] text-faint">Últimos 14 días</p>
        </div>
      )}

      {/* El cuadre (D5) — el corte del día con su descuadre CON SIGNO y la
          serie de la semana. Solo lectura: el dueño no cuenta el cajón. */}
      <div className="mt-5">
        <CorteResumen cortes={cortes} hoy={hoyLocal} />
      </div>

      {/* Bandeja de solicitudes de bloqueo — cola de acciones, no configuración */}
      <div className="mt-5">
        <BlockRequestsInbox initialRequests={pendingBlockRequests} />
      </div>

      {/* ── Configuración ─────────────────────────────────────────────────────
          Cinco filas. Cada una arranca con el cambio rápido y sigue con el panel
          completo, para que "editar el precio" y "crear un servicio" dejen de
          vivir en dos cards distintas de la misma pantalla. */}
      <section
        id="gestion-completa"
        className="mt-5 scroll-mt-4 rounded-xl bg-card px-4 shadow-card"
      >
        <FilaConfig titulo="Servicios y precios">
          <ServiciosTab initial={servicesForManagement} />
          <div className="mt-4 border-t border-line pt-4">
            <ServicesManagementPanel initialServices={servicesForManagement} />
          </div>
        </FilaConfig>

        <FilaConfig titulo="Barberos, PIN y horarios">
          <EquipoTab initial={staffForManagement} />
          <div className="mt-4 border-t border-line pt-4">
            <StaffManagementPanel
              initialStaff={staffForManagement}
              timezone={timezone}
              activeServices={activeServices}
            />
          </div>
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer select-none text-[13px] font-medium text-ink-2">
              Fotos del equipo
            </summary>
            <div className="mt-3">
              <StaffPhotoManager initialStaff={staffForPhotos} />
            </div>
          </details>
        </FilaConfig>

        <FilaConfig titulo="Horario del negocio">
          <HorariosTab />
          <div className="mt-4 border-t border-line pt-4">
            <BusinessHoursPanel />
          </div>
        </FilaConfig>

        <FilaConfig titulo="Clientes inactivos y lista de espera" badge={atencionCount}>
          <InactiveClientsPanel businessName={businessName} />
          <div className="mt-4">
            <WaitlistPanel />
          </div>
        </FilaConfig>

        <FilaConfig titulo="Reportes y reseñas">
          <ReportsConfigPanel />
          <div className="mt-4">
            <ReviewConfigPanel />
          </div>
        </FilaConfig>
      </section>

      <footer className="mt-6 px-4 py-4 text-center">
        <p className="text-[11px] text-faint">
          Soporte:{' '}
          <a href="mailto:contacto@zentriq.mx" className="underline hover:text-ink-2">
            contacto@zentriq.mx
          </a>
          {' · '}
          <a href="/aviso-de-privacidad" className="underline hover:text-ink-2">
            Aviso de privacidad
          </a>
          {' · '}
          <a href="/arco" className="underline hover:text-ink-2">
            Derechos ARCO
          </a>
        </p>
      </footer>
    </div>
  );
}
