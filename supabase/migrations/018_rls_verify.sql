-- ─── 018_rls_verify.sql ────────────────────────────────────────────────────────
-- Script de auditoría de Row Level Security.
-- Solo consulta — no modifica ningún dato ni schema.
--
-- Ejecutar desde el Supabase SQL Editor (con service_role) para auditar el estado.
-- Todas las queries usan pg_tables y pg_policies (vistas del catálogo de sistema).

-- ─── 1. Estado RLS por tabla ──────────────────────────────────────────────────
-- Muestra si cada tabla tiene RLS activo y si tiene FORCE ROW LEVEL SECURITY.
-- Esperado: rowsecurity = TRUE en las 10 tablas del sistema.
-- forcerowsecurity debe ser FALSE — service_role necesita bypass libre.

SELECT
  tablename,
  rowsecurity         AS rls_enabled,
  forcerowsecurity    AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ─── 2. Políticas definidas (detalle completo) ────────────────────────────────
-- Lista todas las políticas con sus expresiones USING y WITH CHECK.
-- Permite verificar que la expresión JWT sea exactamente:
--   auth.jwt() -> 'user_metadata' ->> 'client_id'

SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd              AS operation,
  qual             AS using_expr,
  with_check       AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ─── 3. Resumen por tabla — operaciones permitidas para 'authenticated' ────────
-- Muestra qué operaciones tiene habilitadas cada tabla para el role authenticated.
-- Esperado:
--   patients, appointments, intakes, bot_conversations,
--   events, scheduled_notifications, blocked_days, patient_photos
--     → {INSERT, SELECT, UPDATE}
--   clients, monthly_reports
--     → {SELECT}

SELECT
  tablename,
  array_agg(cmd ORDER BY cmd)  AS operaciones_authenticated
FROM pg_policies
WHERE schemaname    = 'public'
  AND 'authenticated' = ANY(roles)
GROUP BY tablename
ORDER BY tablename;

-- ─── 4. Invariante crítico — tablas con RLS sin políticas ─────────────────────
-- Tablas con RLS activo pero sin ninguna política bloquean TODOS los accesos,
-- incluyendo authenticated. Si esta query devuelve filas, la configuración
-- está incompleta — esas tablas necesitan políticas.

SELECT
  t.tablename,
  'RLS activo sin políticas — todo acceso bloqueado' AS estado
FROM pg_tables t
LEFT JOIN pg_policies p
  ON  p.tablename  = t.tablename
  AND p.schemaname = t.schemaname
WHERE t.schemaname  = 'public'
  AND t.rowsecurity = TRUE
  AND p.policyname IS NULL
ORDER BY t.tablename;

-- ─── 5. Invariante de seguridad — políticas para 'anon' ──────────────────────
-- Ninguna tabla debe tener políticas para el role 'anon'.
-- Si esta query devuelve filas, hay un vector de acceso no autenticado
-- que debe revisarse y eliminarse de inmediato.

SELECT
  tablename,
  policyname,
  roles,
  cmd  AS operation
FROM pg_policies
WHERE schemaname = 'public'
  AND 'anon' = ANY(roles)
ORDER BY tablename;

-- ─── 6. Invariante de seguridad — políticas con DELETE ───────────────────────
-- Los datos nunca se eliminan — se marcan como cancelados o inactivos.
-- Si esta query devuelve filas para el role 'authenticated', es un error
-- de política que contradice la regla de negocio de no-borrado.

SELECT
  tablename,
  policyname,
  roles,
  cmd  AS operation
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd        = 'DELETE'
  AND 'authenticated' = ANY(roles)
ORDER BY tablename;

-- ─── 7. Tablas esperadas con RLS ─────────────────────────────────────────────
-- Confirmación visual del inventario completo de tablas protegidas.
-- Las 10 tablas deben aparecer con rls_enabled = TRUE.

SELECT
  tablename,
  rowsecurity  AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'patients',
    'appointments',
    'intakes',
    'bot_conversations',
    'events',
    'scheduled_notifications',
    'clients',
    'monthly_reports',
    'blocked_days',
    'patient_photos'
  )
ORDER BY tablename;
