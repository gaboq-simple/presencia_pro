// ─── tenantDb — re-export ─────────────────────────────────────────────────────
// El helper canónico vive en el paquete engine (`packages/engine/src/tenantDb.ts`)
// para que el engine —que NO puede importar código de la app (sería dependencia
// circular app→engine→app)— también lo use. La app lo re-exporta desde acá para
// que todos los `import ... from '@/lib/tenantDb'` existentes sigan andando sin cambios.
// La lint rule y la GARANTÍA son las mismas; una sola fuente de verdad.

export { tenantDb, TENANT_TABLES, type TenantTable } from '@presenciapro/engine/tenantDb';
