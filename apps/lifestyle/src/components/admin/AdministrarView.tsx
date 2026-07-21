// ─── Pestaña "Administrar" (mapa A · Paso 4) ──────────────────────────────────
// Junta en un solo lugar el atajo (panel inline: precio, activo, día libre, horario
// del negocio) y el CRUD completo (la ex-pestaña "Gestión": alta de barbero + PIN,
// crear servicio, config fina). El panel inline arriba, la gestión completa abajo.
// El CRUD (endpoints + cache-invalidation + management_audit) es el mismo — no se
// duplica nada acá. Server Component (composición). Tokens Zentriq-claro.

import type { AdminServiceRow, AdminStaffManagementRow } from '@/lib/dashboard.types';
import AdminInlinePanel from '@/components/admin/AdminInlinePanel';

export default function AdministrarView({
  services,
  staff,
  panel,
}: {
  services: AdminServiceRow[];
  staff: AdminStaffManagementRow[];
  /** La gestión completa (DashboardLayout de S6), compuesta en el server. */
  panel: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-4 pt-5">
        <AdminInlinePanel services={services} staff={staff} />
      </div>
      {/* La gestión completa (CRUD): los enlaces "→" del panel inline hacen scroll acá. */}
      <div id="gestion-completa" className="scroll-mt-4">{panel}</div>
    </div>
  );
}
