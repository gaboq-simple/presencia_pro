-- ─── Migration 021 — tabla organizations + FK en businesses ───────────────────
-- Soporte multi-sucursal: un dueño puede tener varias sucursales agrupadas
-- bajo una organización.
--
-- Invariantes de compatibilidad:
--   · organization_id en businesses es NULLABLE — negocios standalone siguen
--     funcionando exactamente igual que antes.
--   · El token de businesses.access_token sigue siendo válido para acceso
--     directo a una sucursal (encargado / dueño de una sola sucursal).
--   · organizations.access_token da acceso a TODAS las sucursales del grupo.

-- ─── Tabla organizations ───────────────────────────────────────────────────────

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

-- ─── FK en businesses ─────────────────────────────────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES organizations(id);

COMMENT ON COLUMN businesses.organization_id IS
  'NULL = negocio standalone. Non-null = pertenece a un grupo de sucursales.';

-- ─── Índices ──────────────────────────────────────────────────────────────────

-- Lookup de todas las sucursales de una organización
CREATE INDEX IF NOT EXISTS idx_businesses_organization
  ON businesses (organization_id)
  WHERE organization_id IS NOT NULL;

-- Lookup por token de organización (path crítico del proxy)
CREATE INDEX IF NOT EXISTS idx_organizations_access_token
  ON organizations (access_token)
  WHERE access_token IS NOT NULL;
