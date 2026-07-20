// ─── tenantDb — guard de aislamiento multi-tenant (blindaje por código) ───────
//
// Contrato: una vez que atás un cliente a un businessId (SERVER-derivado — de la
// sesión en rutas, o de la resolución por whatsapp_phone_number_id en el bot),
// TODA query a una tabla de tenant queda scopeada por business_id sin que el caller
// pueda olvidarlo. Reemplaza el patrón frágil `getServiceClient().from(t).eq('business_id', …)`
// (que dependía de acordarse el `.eq` en ~244 call-sites).
//
//   const db = tenantDb(getServiceClient(), businessId);
//   await db.table('services').select('*');            // → .eq('business_id', businessId) inyectado
//   await db.table('services').update({...}).eq('id', x); // update scopeado + filtro extra del caller
//   await db.table('services').insert({...});           // business_id inyectado en el payload
//   await db.table('services').delete().eq('id', x);     // delete scopeado
//
// El método público se llama .table() (NO .from()) a propósito: así la lint rule
// puede prohibir `.from('<tabla de tenant>')` crudo sin marcar el uso del helper.
//
// Qué cubre: las 14 tablas con columna `business_id` (TENANT_TABLES). Las 5 tablas
// indirectas (staff_availability/blocks/services vía staff_id; businesses/organizations
// que SON la raíz) NO tienen columna business_id → no las cubre este helper; su
// aislamiento es transitivo por un staff_id tenant-scopeado (patrón existente). La
// lint rule (eslint no-restricted-syntax) sólo guarda las 14 directas.
//
// Escape hatch para los casos legítimos que NO son "olvido" (lookup cross-tenant real,
// scan por lote del cron): un `// eslint-disable-next-line no-restricted-syntax -- <motivo>`
// sobre el `.from()` crudo. Greppable y auditable (el motivo va en el comentario).
// Nota: los casos legítimos MÁS comunes (scoped por staff_id, `.in('id', ids)`
// tenant-derivados, INSERT con business_id) NO necesitan escape: pasan por el helper
// sin fricción — el business_id extra es redundante-pero-correcto.

import type { SupabaseClient } from '@supabase/supabase-js';

// Los métodos devuelven el builder de supabase con el ROW sin tipar. Por qué:
// preservar el tipo de columnas exige un genérico que hace OOM a tsc (el tipo
// GetResult de supabase-js es recursivo y profundo); con columnas dinámicas sin
// genérico cae a GenericStringError. Como el caller ya casteaba la fila (`as {...}`)
// —igual que con el cliente crudo, que era `SupabaseClient` sin Database schema—,
// no hay regresión de type-safety. La GARANTÍA (inyección de business_id) es runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver arriba
type AnyFilterBuilder = any;

// Las 14 tablas con columna `business_id`. Fuente de verdad para el helper Y la lint.
export const TENANT_TABLES = [
  'appointments',
  'customers',
  'services',
  'staff',
  'waitlist',
  'scheduled_notifications',
  'bot_conversations',
  'conversation_messages',
  'staff_schedule_exceptions',
  'bot_logs',
  'arco_requests',
  'appointment_audit',
  'management_audit',
  'appointment_tips',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

type SelectOptions = { head?: boolean; count?: 'exact' | 'planned' | 'estimated' };

/**
 * Liga un cliente Supabase a un `businessId` server-derivado. El businessId NUNCA
 * debe venir de input del cliente (request body/query) — sale de la sesión o de la
 * resolución de negocio del bot. El helper no lo puede saber; es responsabilidad del
 * caller pasar uno confiable. Lo que el helper GARANTIZA es que, atado ese businessId,
 * ninguna query se escapa del tenant.
 */
export function tenantDb(client: SupabaseClient, businessId: string) {
  if (!businessId || typeof businessId !== 'string') {
    throw new Error('tenantDb: businessId server-derivado requerido');
  }

  return {
    table(table: TenantTable) {
      const qb = client.from(table);
      const bid = businessId;
      return {
        /** SELECT scopeado: inyecta .eq('business_id', businessId). El caller encadena filtros extra y castea la fila. */
        select(columns?: string, options?: SelectOptions): AnyFilterBuilder {
          return qb.select(columns as string, options).eq('business_id', bid) as unknown as AnyFilterBuilder;
        },

        /** INSERT scopeado: inyecta business_id en el/los row(s). El del caller se ignora. */
        insert(values: Record<string, unknown> | Record<string, unknown>[]): AnyFilterBuilder {
          return qb.insert(injectBusinessId(values, bid)) as unknown as AnyFilterBuilder;
        },

        /**
         * UPSERT scopeado: inyecta business_id en el/los row(s) (igual que insert). El
         * onConflict lo pasa el caller (típicamente una UNIQUE que ya es tenant-safe por
         * un staff_id/id globalmente único). El business_id del payload se pisa con el del
         * helper → no se puede upsertar en otro negocio.
         */
        upsert(
          values: Record<string, unknown> | Record<string, unknown>[],
          options?: { onConflict?: string; ignoreDuplicates?: boolean },
        ): AnyFilterBuilder {
          return qb.upsert(injectBusinessId(values, bid), options) as unknown as AnyFilterBuilder;
        },

        /** UPDATE scopeado: inyecta .eq('business_id', businessId) en el WHERE. */
        update(values: Record<string, unknown>): AnyFilterBuilder {
          return qb.update(values).eq('business_id', bid) as unknown as AnyFilterBuilder;
        },

        /** DELETE scopeado: inyecta .eq('business_id', businessId) en el WHERE. */
        delete(): AnyFilterBuilder {
          return qb.delete().eq('business_id', bid) as unknown as AnyFilterBuilder;
        },
      };
    },
  };
}

/** Inyecta business_id en un row o array de rows, pisando cualquier valor del caller. */
function injectBusinessId(
  values: Record<string, unknown> | Record<string, unknown>[],
  businessId: string,
): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(values)) {
    return values.map((v) => ({ ...v, business_id: businessId }));
  }
  return { ...values, business_id: businessId };
}
