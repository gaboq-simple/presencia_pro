// ─── Management Audit — helper route-level ─────────────────────────────────────
// Registra UNA fila de auditoría por acción lógica de gestión del catálogo
// (services / staff / staff_services). Lo llaman las rutas DESPUÉS de mutar con
// éxito. Complementa appointment_audit (citas); ver migración 053.
//
// Diseño "difícil de usar mal":
//   · actor_type se DERIVA de actorStaffId (la ruta no lo puede setear mal).
//   · sanitize() saca `pin` y `auth_id` de old_data/new_data como red de seguridad,
//     aunque la ruta pase la fila entera por error.
//   · BEST-EFFORT: nunca tira ni devuelve error. Si el insert falla, la mutación ya
//     ocurrió y NO debe revertirse — se loguea fuerte y se sigue. Un audit roto no
//     puede tumbar la gestión del dueño.

import type { SupabaseClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';

export type ManagementEntity = 'services' | 'staff' | 'staff_services' | 'businesses';
export type ManagementAction =
  | 'created'
  | 'updated'
  | 'deactivated'
  | 'reactivated'
  | 'services_changed';

// Claves que NUNCA se persisten en old_data/new_data (sensibles / internas).
const SENSITIVE_KEYS = new Set(['pin', 'auth_id']);

function sanitize(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export type ManagementAuditInput = {
  entity:         ManagementEntity;
  entityId:       string;
  action:         ManagementAction;
  businessId:     string;
  /** getCurrentSession().staff_id — real con el modelo actual; null cae a actor_type='unknown'. */
  actorStaffId:   string | null;
  oldData?:       Record<string, unknown> | null;
  newData?:       Record<string, unknown> | null;
  changedFields?: string[] | null;
};

/**
 * Inserta una fila de management_audit. BEST-EFFORT: no tira nunca. Llamar SOLO
 * después de que la mutación tuvo éxito. Recibe el mismo service-role client que la
 * ruta ya usa para mutar.
 */
export async function logManagementAudit(
  supabase: SupabaseClient,
  input: ManagementAuditInput,
): Promise<void> {
  try {
    const { error } = await tenantDb(supabase, input.businessId).table('management_audit').insert({
      entity:         input.entity,
      entity_id:      input.entityId,
      action:         input.action,
      actor_staff_id: input.actorStaffId,
      actor_type:     input.actorStaffId ? 'staff' : 'unknown',
      old_data:       sanitize(input.oldData),
      new_data:       sanitize(input.newData),
      changed_fields: input.changedFields ?? null,
    });

    if (error) {
      console.error(JSON.stringify({
        ts:          new Date().toISOString(),
        service:     'management_audit',
        event:       'insert_failed',
        entity:      input.entity,
        entity_id:   input.entityId,
        action:      input.action,
        business_id: input.businessId,
        error:       error.message,
      }));
    }
  } catch (e) {
    // Red de seguridad: cualquier throw inesperado (red, cliente) NO debe propagar.
    console.error(JSON.stringify({
      ts:          new Date().toISOString(),
      service:     'management_audit',
      event:       'insert_threw',
      entity:      input.entity,
      action:      input.action,
      business_id: input.businessId,
      error:       e instanceof Error ? e.message : String(e),
    }));
  }
}
