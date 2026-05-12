-- ─── PresenciaPro Lifestyle — Row Level Security ─────────────────────────────
-- Activar RLS y definir políticas en todas las tablas del schema de lifestyle.
-- Ejecutar después de 001_initial_schema.sql.
--
-- Dos niveles de aislamiento:
--   Nivel 1 — business_id: aísla negocios entre sí
--   Nivel 2 — role/staff_id: barber solo ve sus propias filas
--
-- Funciones auxiliares con prefijo ls_ (lifestyle) para evitar colisiones
-- con funciones de otros productos en el mismo proyecto Supabase.
-- SECURITY DEFINER evita ciclos recursivos al consultar la tabla staff.

-- ─── Activar RLS ──────────────────────────────────────────────────────────────

ALTER TABLE businesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_services        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_blocks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;

-- ─── Funciones auxiliares ─────────────────────────────────────────────────────
-- Leen el staff activo del usuario autenticado sin disparar las políticas RLS
-- (SECURITY DEFINER ejecuta con los permisos del owner, no del caller).

CREATE OR REPLACE FUNCTION ls_staff_business_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT business_id
  FROM   staff
  WHERE  auth_id = auth.uid()
    AND  active  = TRUE
  LIMIT  1
$$;

CREATE OR REPLACE FUNCTION ls_staff_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role
  FROM   staff
  WHERE  auth_id = auth.uid()
    AND  active  = TRUE
  LIMIT  1
$$;

CREATE OR REPLACE FUNCTION ls_staff_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id
  FROM   staff
  WHERE  auth_id = auth.uid()
    AND  active  = TRUE
  LIMIT  1
$$;

-- ─── businesses ───────────────────────────────────────────────────────────────
-- Lectura: cualquier staff autenticado de ese negocio.
-- Escritura: solo admin.

CREATE POLICY "ls_businesses_select"
  ON businesses FOR SELECT
  USING (id = ls_staff_business_id());

CREATE POLICY "ls_businesses_update"
  ON businesses FOR UPDATE
  USING (id = ls_staff_business_id() AND ls_staff_role() = 'admin');

-- ─── staff ────────────────────────────────────────────────────────────────────
-- Lectura: todo el staff del mismo negocio se puede ver entre sí.
-- Inserción/borrado: solo admin.
-- Update: admin puede editar a cualquiera; barber/assistant solo su propio registro.

CREATE POLICY "ls_staff_select"
  ON staff FOR SELECT
  USING (business_id = ls_staff_business_id());

CREATE POLICY "ls_staff_insert"
  ON staff FOR INSERT
  WITH CHECK (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

CREATE POLICY "ls_staff_delete"
  ON staff FOR DELETE
  USING (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

CREATE POLICY "ls_staff_update_admin"
  ON staff FOR UPDATE
  USING (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

CREATE POLICY "ls_staff_update_self"
  ON staff FOR UPDATE
  USING (id = ls_staff_id());

-- ─── services ─────────────────────────────────────────────────────────────────
-- Lectura: cualquier staff autenticado del negocio.
-- Escritura: solo admin.
-- Nota: el mini-sitio público lee servicios via service_role_key (bypasa RLS).

CREATE POLICY "ls_services_select"
  ON services FOR SELECT
  USING (business_id = ls_staff_business_id());

CREATE POLICY "ls_services_insert"
  ON services FOR INSERT
  WITH CHECK (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

CREATE POLICY "ls_services_update"
  ON services FOR UPDATE
  USING (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

CREATE POLICY "ls_services_delete"
  ON services FOR DELETE
  USING (business_id = ls_staff_business_id() AND ls_staff_role() = 'admin');

-- ─── staff_services ───────────────────────────────────────────────────────────
-- Lectura: cualquier staff del negocio.
-- Escritura: solo admin.

CREATE POLICY "ls_staff_services_select"
  ON staff_services FOR SELECT
  USING (
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_services_insert"
  ON staff_services FOR INSERT
  WITH CHECK (
    ls_staff_role() = 'admin' AND
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_services_delete"
  ON staff_services FOR DELETE
  USING (
    ls_staff_role() = 'admin' AND
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

-- ─── customers ────────────────────────────────────────────────────────────────
-- Admin: ve todos los clientes del negocio.
-- Barber/assistant: solo ve clientes con los que tiene una cita.

CREATE POLICY "ls_customers_select_admin"
  ON customers FOR SELECT
  USING (
    business_id = ls_staff_business_id() AND ls_staff_role() = 'admin'
  );

CREATE POLICY "ls_customers_select_staff"
  ON customers FOR SELECT
  USING (
    business_id = ls_staff_business_id()
    AND ls_staff_role() IN ('barber', 'assistant')
    AND id IN (
      SELECT customer_id FROM appointments WHERE staff_id = ls_staff_id()
    )
  );

CREATE POLICY "ls_customers_insert"
  ON customers FOR INSERT
  WITH CHECK (business_id = ls_staff_business_id());

CREATE POLICY "ls_customers_update"
  ON customers FOR UPDATE
  USING (business_id = ls_staff_business_id());

-- ─── appointments ─────────────────────────────────────────────────────────────
-- Admin: ve todas las citas del negocio y puede actualizarlas.
-- Barber/assistant: ve y actualiza solo sus propias citas.
-- Inserción: cualquier staff autenticado del negocio.

CREATE POLICY "ls_appointments_select_admin"
  ON appointments FOR SELECT
  USING (
    business_id = ls_staff_business_id() AND ls_staff_role() = 'admin'
  );

CREATE POLICY "ls_appointments_select_staff"
  ON appointments FOR SELECT
  USING (
    business_id = ls_staff_business_id()
    AND ls_staff_role() IN ('barber', 'assistant')
    AND staff_id = ls_staff_id()
  );

CREATE POLICY "ls_appointments_insert"
  ON appointments FOR INSERT
  WITH CHECK (business_id = ls_staff_business_id());

CREATE POLICY "ls_appointments_update_admin"
  ON appointments FOR UPDATE
  USING (
    business_id = ls_staff_business_id() AND ls_staff_role() = 'admin'
  );

CREATE POLICY "ls_appointments_update_staff"
  ON appointments FOR UPDATE
  USING (
    business_id = ls_staff_business_id()
    AND ls_staff_role() IN ('barber', 'assistant')
    AND staff_id = ls_staff_id()
  );

-- ─── staff_availability ───────────────────────────────────────────────────────
-- Lectura: cualquier staff del negocio (útil para mostrar disponibilidad cruzada).
-- Admin: puede gestionar la disponibilidad de cualquier staff.
-- Barber/assistant: gestiona solo la suya.

CREATE POLICY "ls_staff_availability_select"
  ON staff_availability FOR SELECT
  USING (
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_availability_admin"
  ON staff_availability FOR ALL
  USING (
    ls_staff_role() = 'admin' AND
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_availability_self"
  ON staff_availability FOR ALL
  USING (staff_id = ls_staff_id());

-- ─── staff_blocks ─────────────────────────────────────────────────────────────
-- Mismo patrón que staff_availability.

CREATE POLICY "ls_staff_blocks_select"
  ON staff_blocks FOR SELECT
  USING (
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_blocks_admin"
  ON staff_blocks FOR ALL
  USING (
    ls_staff_role() = 'admin' AND
    staff_id IN (
      SELECT id FROM staff WHERE business_id = ls_staff_business_id()
    )
  );

CREATE POLICY "ls_staff_blocks_self"
  ON staff_blocks FOR ALL
  USING (staff_id = ls_staff_id());

-- ─── bot_conversations ────────────────────────────────────────────────────────
-- Solo admin puede leer conversaciones del bot desde el dashboard.
-- El bot escribe vía service_role_key (bypasa RLS).

CREATE POLICY "ls_bot_conversations_select_admin"
  ON bot_conversations FOR SELECT
  USING (
    business_id = ls_staff_business_id() AND ls_staff_role() = 'admin'
  );

-- ─── scheduled_notifications ──────────────────────────────────────────────────
-- Solo admin puede ver notificaciones programadas.
-- La Edge Function de dispatch usa service_role_key (bypasa RLS).

CREATE POLICY "ls_scheduled_notifications_select_admin"
  ON scheduled_notifications FOR SELECT
  USING (
    business_id = ls_staff_business_id() AND ls_staff_role() = 'admin'
  );
