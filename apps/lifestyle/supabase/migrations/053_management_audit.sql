-- ─── Migration 053 — Audit de gestión del catálogo (route-level) ──────────────
--
-- Complementa appointment_audit (045, que cubre SOLO appointments). Cubre la
-- GESTIÓN del catálogo: services (POST/PATCH), staff (POST/manage PATCH) y el
-- mapeo staff↔servicios (PATCH). Antes: cero traza de quién tocó el catálogo.
--
-- Diseño ROUTE-LEVEL (una fila por acción lógica, insertada desde la ruta tras
-- mutar con éxito), NO un trigger fila-por-fila como el de citas, porque:
--   · Las acciones son replace-all: cambiar los servicios de un barbero son N
--     DELETE + M INSERT en staff_services, pero es UNA acción del dueño.
--   · services/staff NO tienen columnas created_by/modified_by donde un trigger
--     pudiera apoyarse para el actor (el de citas lee las columnas de la 023).
-- El actor sale de getCurrentSession().staff_id (ahora siempre real: dueño por
-- email, asistente/barbero por PIN).
--
-- Sigue las convenciones de appointment_audit (045): actor_staff_id FK SET NULL,
-- actor_type con default 'unknown', old_data/new_data jsonb, changed_fields,
-- created_at, trigger de inmutabilidad, índices por tenant y por actor.
--
-- ⚠️ SENSIBLE: old_data/new_data NUNCA guardan el `pin` ni el `auth_id` del staff
-- (los sanea el helper logManagementAudit antes de insertar). Un cambio de PIN se
-- registra como el hecho 'pin' en changed_fields, sin el valor.

-- ─── 1. Tabla append-only ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.management_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL,          -- desnormalizado para consulta por tenant
  entity          text        NOT NULL CHECK (entity IN
                    ('services', 'staff', 'staff_services')),
  -- id de la fila afectada: service_id o staff_id; para el mapeo = staff_id del barbero.
  entity_id       uuid        NOT NULL,
  action          text        NOT NULL CHECK (action IN
                    ('created', 'updated', 'deactivated', 'reactivated', 'services_changed')),
  actor_staff_id  uuid        REFERENCES public.staff(id) ON DELETE SET NULL,
  -- 'staff' = acción con identidad individual (staff_id real). 'unknown' = actor sin
  -- staff_id (defensivo — no debería pasar con el modelo actual). Sin 'bot': la
  -- gestión del catálogo siempre la hace una persona autenticada, nunca un flujo automático.
  actor_type      text        NOT NULL DEFAULT 'unknown' CHECK (actor_type IN
                    ('staff', 'system', 'unknown')),
  old_data        jsonb,                          -- snapshot curado del ANTES (sin pin/auth_id); NULL en 'created'
  new_data        jsonb,                          -- snapshot curado del DESPUÉS (sin pin/auth_id)
  changed_fields  text[],                         -- claves que cambiaron (updated/deactivated/reactivated)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mgmt_audit_biz
  ON public.management_audit (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mgmt_audit_entity
  ON public.management_audit (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mgmt_audit_actor
  ON public.management_audit (actor_staff_id) WHERE actor_staff_id IS NOT NULL;

COMMENT ON TABLE public.management_audit IS
  'Historial append-only de gestión del catálogo (services/staff/staff_services), route-level. Inmutable vía trigger. old_data/new_data EXCLUYEN pin y auth_id del staff.';

-- ─── 2. Append-only real (bloquea UPDATE/DELETE incluso a service_role) ─────────
-- Mismo patrón que appointment_audit (045): RLS no alcanza (service_role la bypassa),
-- un trigger BEFORE que RAISE es lo único que la hace inmutable para todos.
-- ⚠️ Misma tensión con la purga por retención (LFPDPPP) que la 045: quien implemente
-- la retención debe diseñar un bypass CONTROLADO (deshabilitar el trigger dentro de
-- una función de mantenimiento SECURITY DEFINER, o un gate por GUC). NO resolver acá.
CREATE OR REPLACE FUNCTION public.management_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'management_audit es append-only: % no permitido', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_mgmt_audit_immutable ON public.management_audit;
CREATE TRIGGER trg_mgmt_audit_immutable
BEFORE UPDATE OR DELETE ON public.management_audit
FOR EACH ROW
EXECUTE FUNCTION public.management_audit_immutable();

-- ─── 3. RLS de lectura — solo el DUEÑO (admin/owner) del negocio ────────────────
-- Espeja la política de appointment_audit. El INSERT lo hace la ruta con
-- service_role (bypassa RLS); sin políticas de INSERT/UPDATE/DELETE para
-- 'authenticated' → default deny. El dueño-por-token no tiene auth.uid(): lee por
-- service_role con authz en la app (patrón del resto del sistema).
ALTER TABLE public.management_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'management_audit' AND policyname = 'admin_read_mgmt_audit'
  ) THEN
    CREATE POLICY "admin_read_mgmt_audit"
      ON public.management_audit FOR SELECT
      TO authenticated
      USING (
        business_id IN (
          SELECT business_id FROM public.staff
          WHERE auth_id = auth.uid()
            AND role IN ('admin', 'owner')
            AND active = true
        )
      );
  END IF;
END;
$$;
