-- ─── Migration 034 — tabla organizations + RLS ────────────────────────────────
-- Crea la tabla organizations (de 021, que no fue aplicada al remoto) y
-- habilita RLS inmediatamente.
--
-- organizations.access_token es sensible (da acceso a todas las sucursales del
-- grupo). Sin RLS cualquier usuario autenticado podría hacer SELECT y obtenerlo.
--
-- Decisión de diseño:
--   Todo acceso a organizations pasa por proxy.ts con SUPABASE_SERVICE_ROLE_KEY
--   (bypasa RLS). No hay queries de usuario autenticado sobre esta tabla.
--   Habilitar RLS sin políticas de usuario = denegación total para sesiones
--   autenticadas; service_role sigue funcionando sin cambios.

CREATE TABLE IF NOT EXISTS organizations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  slug         TEXT        UNIQUE NOT NULL,
  owner_name   TEXT,
  owner_email  TEXT,
  owner_phone  TEXT,
  access_token TEXT        UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE organizations IS
  'Grupo de sucursales bajo una misma marca. Un dueño accede con '
  'organizations.access_token y ve todas las sucursales del grupo.';

COMMENT ON COLUMN organizations.access_token IS
  'Token del dueño del grupo. URL: /dashboard?token=XXX. 32 chars hex.';

-- FK en businesses (solo si no existe)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES organizations(id);

COMMENT ON COLUMN businesses.organization_id IS
  'NULL = negocio standalone. Non-null = pertenece a un grupo de sucursales.';

-- Índices
CREATE INDEX IF NOT EXISTS idx_businesses_organization
  ON businesses (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_access_token
  ON organizations (access_token)
  WHERE access_token IS NOT NULL;

-- RLS: sin políticas de usuario — solo service_role puede leer/modificar
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
