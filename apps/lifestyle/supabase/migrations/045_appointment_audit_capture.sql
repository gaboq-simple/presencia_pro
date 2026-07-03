-- ─── Migration 045 — Audit trail de citas: capa de captura (Fase 2c-i) ──────────
--
-- Historial append-only de TODA mutación de appointments. Complementa la 023:
--   · 023 (created_by/modified_by/modified_at) = LAST-TOUCH (firma en tarjeta).
--   · appointment_audit = HISTORIAL completo (cada cambio, inmutable).
-- El trigger LEE las columnas de la 023 como fuente del actor → CERO cambios en la
-- app en 2c-i. La atribución robusta de bot/cron vía set_config+RPC es 2c-ii.
--
-- Actor por capas (en la función del trigger):
--   1. GUC current_setting('app.actor_staff_id') — INERTE en 2c-i (nadie lo setea);
--      queda listo para 2c-ii (RPCs con set_config transaction-local). No es error
--      que esté vacío.
--   2. Columnas 023 (created_by_staff_id en INSERT / modified_by_staff_id en UPDATE/DELETE).
--   3. Inferencia: INSERT con source='bot' → actor_type='bot'. Resto sin actor → 'unknown'.
--      Actor ausente NO es error: es información (bot-update, cron, SQL directo).

-- ─── 1. Tabla append-only ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SIN FK a appointments: el historial debe sobrevivir a un eventual hard-delete
  -- de la cita (hoy no ocurre — los cancelados son cambios de status).
  appointment_id  uuid        NOT NULL,
  business_id     uuid        NOT NULL,          -- desnormalizado para RLS/consulta por tenant
  action          text        NOT NULL CHECK (action IN
                    ('created','updated','status_changed','rescheduled','deleted')),
  actor_staff_id  uuid        REFERENCES public.staff(id) ON DELETE SET NULL,
  actor_type      text        NOT NULL DEFAULT 'unknown' CHECK (actor_type IN
                    ('staff','bot','system','unknown')),
  old_data        jsonb,                          -- to_jsonb(OLD); NULL en INSERT
  new_data        jsonb,                          -- to_jsonb(NEW); NULL en DELETE
  changed_fields  text[],                         -- claves con old<>new (solo UPDATE)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_audit_appt
  ON public.appointment_audit (appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_audit_biz
  ON public.appointment_audit (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_audit_actor
  ON public.appointment_audit (actor_staff_id) WHERE actor_staff_id IS NOT NULL;

COMMENT ON TABLE public.appointment_audit IS
  'Historial append-only de mutaciones de appointments (Fase 2c-i). Inmutable vía trigger. old_data/new_data = fila entera (incluye PII: booking_name/notes) → RETENCIÓN pendiente antes del primer cliente real (LFPDPPP).';

-- ─── 2. Función del trigger de captura ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_appointment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action      text;
  v_actor_id    uuid;
  v_actor_type  text;
  v_old         jsonb;
  v_new         jsonb;
  v_changed     text[];
  v_appt_id     uuid;
  v_biz_id      uuid;
  v_source      text;
  v_col_actor   uuid;     -- actor tomado de las columnas 023 según la operación
  v_guc_id      text := current_setting('app.actor_staff_id', true);  -- inerte en 2c-i
  v_guc_type    text := current_setting('app.actor_type', true);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_new := NULL;
    v_appt_id := OLD.id; v_biz_id := OLD.business_id;
    v_source := OLD.source; v_col_actor := OLD.modified_by_staff_id;
    v_action := 'deleted';
  ELSIF TG_OP = 'INSERT' THEN
    v_old := NULL; v_new := to_jsonb(NEW);
    v_appt_id := NEW.id; v_biz_id := NEW.business_id;
    v_source := NEW.source; v_col_actor := NEW.created_by_staff_id;
    v_action := 'created';
  ELSE  -- UPDATE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    v_appt_id := NEW.id; v_biz_id := NEW.business_id;
    v_source := NEW.source; v_col_actor := NEW.modified_by_staff_id;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'status_changed';
    ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at
       OR NEW.staff_id  IS DISTINCT FROM OLD.staff_id THEN
      v_action := 'rescheduled';
    ELSE
      v_action := 'updated';
    END IF;
    SELECT array_agg(k) INTO v_changed
    FROM jsonb_object_keys(v_new) AS k
    WHERE v_new -> k IS DISTINCT FROM v_old -> k;
  END IF;

  -- Actor: GUC (2c-ii) → columna 023 (2c-i) → NULL
  v_actor_id := COALESCE(NULLIF(v_guc_id, '')::uuid, v_col_actor);

  -- Tipo: GUC → 'staff' si hay actor → 'bot' solo en INSERT source='bot' → 'unknown'
  v_actor_type := COALESCE(
    NULLIF(v_guc_type, ''),
    CASE
      WHEN v_actor_id IS NOT NULL THEN 'staff'
      WHEN TG_OP = 'INSERT' AND v_source = 'bot' THEN 'bot'
      ELSE 'unknown'   -- bot-update / cron / SQL directo — se refina a 'system'/'bot' en 2c-ii
    END);

  INSERT INTO public.appointment_audit(
    appointment_id, business_id, action, actor_staff_id, actor_type,
    old_data, new_data, changed_fields)
  VALUES (
    v_appt_id, v_biz_id, v_action, v_actor_id, v_actor_type,
    v_old, v_new, v_changed);

  RETURN NULL;  -- AFTER trigger: el valor de retorno se ignora
END;
$$;

DROP TRIGGER IF EXISTS trg_log_appointment_audit ON public.appointments;
CREATE TRIGGER trg_log_appointment_audit
AFTER INSERT OR UPDATE OR DELETE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.log_appointment_audit();

-- ─── 3. Append-only real (bloquea UPDATE/DELETE incluso a service_role) ─────────
-- RLS NO alcanza: service_role la bypassa. Un trigger BEFORE que RAISE es lo único
-- que hace la tabla verdaderamente inmutable para todos.
--
-- ⚠️ TENSIÓN CON LA RETENCIÓN (deuda diferida, ver SPRINT.md): este RAISE bloquea
-- DELETE para TODOS. La purga por retención LFPDPPP (borrar filas viejas) chocará
-- con esto. Quien implemente la retención debe primero diseñar un bypass CONTROLADO
-- (función de mantenimiento SECURITY DEFINER que deshabilite el trigger dentro de su
-- transacción, o un gate por GUC tipo current_setting('app.allow_audit_purge')), y
-- ese bypass debe quedar auditado/restringido. NO resolver acá. "Append-only total"
-- y "purga por retención" están en tensión: la solución se diseña con la retención.
CREATE OR REPLACE FUNCTION public.appointment_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'appointment_audit es append-only: % no permitido', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_appt_audit_immutable ON public.appointment_audit;
CREATE TRIGGER trg_appt_audit_immutable
BEFORE UPDATE OR DELETE ON public.appointment_audit
FOR EACH ROW
EXECUTE FUNCTION public.appointment_audit_immutable();

-- ─── 4. RLS de lectura — solo el DUEÑO (admin/owner), NO barberos ni assistants ─
-- El JSONB contiene PII (booking_name/notes/teléfono vía join). La lectura del
-- historial se restringe al dueño del negocio. En la tabla `staff` el dueño es
-- role='admin' (el CHECK de staff es admin/barber/assistant — no hay 'owner' ahí);
-- se incluye 'owner' de forma defensiva por el namespace de AuthRole/forward-compat.
-- El dueño-por-token no tiene auth.uid() → esta RLS no le aplica; lee por
-- service_role con authz en la app (patrón del resto del sistema). El INSERT lo hace
-- el trigger (SECURITY DEFINER, bypassa RLS). Sin políticas de INSERT/UPDATE/DELETE
-- para 'authenticated' → default deny.
ALTER TABLE public.appointment_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'appointment_audit' AND policyname = 'admin_read_audit'
  ) THEN
    CREATE POLICY "admin_read_audit"
      ON public.appointment_audit FOR SELECT
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
