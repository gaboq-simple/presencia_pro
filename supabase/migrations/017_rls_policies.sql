-- ─── 017_rls_policies.sql ──────────────────────────────────────────────────────
-- Row Level Security completo basado en Supabase Auth (JWT).
--
-- MODELO DE ACCESO:
--   anon         → bloqueado en todas las tablas (sin políticas = sin acceso)
--   authenticated → solo filas donde client_id = JWT user_metadata.client_id
--   service_role  → bypass automático de RLS (no requiere políticas)
--
-- El client_id del doctor autenticado se almacena en raw_user_meta_data al crear
-- el usuario con supabase.auth.admin.createUser({ user_metadata: { client_id } }).
-- Las políticas lo leen con: auth.jwt() -> 'user_metadata' ->> 'client_id'
--
-- Para auth.jwt() con role anon: devuelve NULL → client_id = NULL → FALSE → bloqueado ✓
-- Para service_role: RLS no aplica (bypass automático de Supabase) ✓
--
-- IMPORTANTE: service_role nunca debe usar FORCE ROW LEVEL SECURITY.
-- El bypass automático es el comportamiento correcto para API routes y Edge Functions.

-- ─── Eliminar políticas previas (migración 008) ────────────────────────────────
-- Las políticas de 008 usaban current_setting('app.client_id', true) —
-- mecanismo de sesión para queries directas al pool de Postgres.
-- Toda la lógica de negocio corre con service_role (bypass de RLS),
-- por lo que ese mecanismo quedó obsoleto. Se reemplaza con JWT de Supabase Auth.

DROP POLICY IF EXISTS "patients_client_isolation"                ON patients;
DROP POLICY IF EXISTS "appointments_client_isolation"            ON appointments;
DROP POLICY IF EXISTS "intakes_client_isolation"                 ON intakes;
DROP POLICY IF EXISTS "bot_conversations_client_isolation"       ON bot_conversations;
DROP POLICY IF EXISTS "events_client_isolation"                  ON events;
DROP POLICY IF EXISTS "scheduled_notifications_client_isolation" ON scheduled_notifications;
DROP POLICY IF EXISTS "clients_select_own"                       ON clients;

-- ─── Activar RLS en tablas pendientes ─────────────────────────────────────────
-- blocked_days (migración 013) y patient_photos (migración 014)
-- se crearon sin ALTER TABLE ... ENABLE ROW LEVEL SECURITY.

ALTER TABLE blocked_days   ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_photos ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: patients
-- El doctor gestiona su propia base de pacientes.
-- DELETE no se permite — los pacientes se desactivan, nunca se eliminan.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "patients_authenticated_select" ON patients
  FOR SELECT
  TO authenticated
  -- Guard: solo filas del propio client_id extraído del JWT
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "patients_authenticated_insert" ON patients
  FOR INSERT
  TO authenticated
  -- Guard: el client_id del nuevo registro debe coincidir con el JWT
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "patients_authenticated_update" ON patients
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: appointments
-- El doctor crea, consulta y actualiza citas de su agenda.
-- Las cancelaciones usan UPDATE status='cancelled', nunca DELETE.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "appointments_authenticated_select" ON appointments
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "appointments_authenticated_insert" ON appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "appointments_authenticated_update" ON appointments
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: intakes
-- El doctor consulta los formularios pre-consulta desde el dashboard.
-- Los intakes los crea el paciente vía el portal (service_role), pero el doctor
-- también puede crearlos manualmente o actualizarlos desde el dashboard.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "intakes_authenticated_select" ON intakes
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "intakes_authenticated_insert" ON intakes
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "intakes_authenticated_update" ON intakes
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: bot_conversations
-- El doctor puede ver el historial de conversaciones del bot en el dashboard.
-- El bot escribe las conversaciones con service_role (bypass de RLS).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "bot_conversations_authenticated_select" ON bot_conversations
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "bot_conversations_authenticated_insert" ON bot_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "bot_conversations_authenticated_update" ON bot_conversations
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: events
-- Métricas de negocio — el doctor las lee desde el dashboard.
-- Los eventos se registran desde API routes con service_role.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "events_authenticated_select" ON events
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "events_authenticated_insert" ON events
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "events_authenticated_update" ON events
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: scheduled_notifications
-- El doctor puede consultar las notificaciones programadas de sus pacientes.
-- El cron de despacho usa service_role (bypass de RLS).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "scheduled_notifications_authenticated_select" ON scheduled_notifications
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "scheduled_notifications_authenticated_insert" ON scheduled_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "scheduled_notifications_authenticated_update" ON scheduled_notifications
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: clients
-- El doctor puede leer su propio registro (información de perfil de instancia).
-- Nota: la PK de clients es `id` (TEXT) — que es el mismo valor que client_id
--       en el resto de tablas. La política usa `id` en lugar de `client_id`.
--
-- Guard: No INSERT para authenticated — los clientes se crean únicamente
--        via scripts/create-doctor-user.ts con service_role.
-- Guard: No UPDATE para authenticated — los cambios de configuración
--        requieren un deploy y van a client.config.ts.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "clients_authenticated_select" ON clients
  FOR SELECT
  TO authenticated
  -- Guard: el doctor solo ve su propio registro de instancia
  USING (id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: monthly_reports
-- El doctor lee sus reportes mensuales desde el dashboard.
-- Los registros los crea el cron dispatch-monthly-report con service_role.
--
-- Guard: No INSERT ni UPDATE para authenticated — el cron es el único escritor.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "monthly_reports_authenticated_select" ON monthly_reports
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: blocked_days
-- El doctor gestiona los días bloqueados de su agenda desde el dashboard.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "blocked_days_authenticated_select" ON blocked_days
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "blocked_days_authenticated_insert" ON blocked_days
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "blocked_days_authenticated_update" ON blocked_days
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: patient_photos
-- El doctor gestiona las fotos antes/después de tratamiento.
-- Las fotos se suben via API routes con service_role y Storage privado.
-- El dashboard las lee via signed URLs generadas server-side.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "patient_photos_authenticated_select" ON patient_photos
  FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "patient_photos_authenticated_insert" ON patient_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "patient_photos_authenticated_update" ON patient_photos
  FOR UPDATE
  TO authenticated
  USING     (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'))
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- ─── Resumen de invariantes ────────────────────────────────────────────────────
-- ✅ anon         → 0 políticas → 0 acceso en todas las tablas
-- ✅ authenticated → acceso solo a filas propias (client_id del JWT)
-- ✅ service_role  → bypass automático (no requiere políticas)
-- ✅ DELETE        → nunca permitido para authenticated (sin política DELETE)
-- ✅ clients       → solo SELECT para authenticated (INSERT/UPDATE via scripts)
-- ✅ monthly_reports → solo SELECT para authenticated (INSERT via cron)
