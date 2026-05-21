-- ─── Migration 033: Chat Panel — RLS policies ──────────────────────────────────
-- Arregla el RLS de bot_conversations y conversation_messages para el panel
-- de chat del asistente.
--
-- Contexto:
--   - Toda la UI del panel usa server actions con service_role_key → bypass RLS.
--   - Estas policies son defensa en profundidad: protegen el acceso directo desde
--     clientes Supabase autenticados (Supabase Auth), por si algún código futuro
--     consulta estas tablas sin service_role.
--   - ls_staff_*() funciones usan auth.uid() → solo aplican a sesiones Supabase Auth.
--     Las sesiones ls_session (PIN/token) van por service_role y no les afecta.
--
-- Cambios:
--   1. bot_conversations: elimina policy admin-only muerta, agrega SELECT + UPDATE
--      para todos los roles de staff del mismo negocio.
--   2. conversation_messages: agrega SELECT + INSERT para staff del mismo negocio.
--      (tabla tenía RLS habilitado pero 0 policies — default deny total).

-- ─── 1. bot_conversations ─────────────────────────────────────────────────────

-- Eliminar la policy admin-only obsoleta (usaba ls_staff_role() = 'admin' solamente)
DROP POLICY IF EXISTS "ls_bot_conversations_select_admin" ON bot_conversations;

-- SELECT: cualquier staff activo del mismo negocio puede leer conversaciones
CREATE POLICY "ls_bot_conversations_select_staff"
  ON bot_conversations FOR SELECT
  USING (business_id = ls_staff_business_id());

-- UPDATE: cualquier staff activo del mismo negocio puede actualizar
-- (para takeover/release de conversaciones)
-- WITH CHECK garantiza que no se puede mover una conversación a otro negocio
CREATE POLICY "ls_bot_conversations_update_staff"
  ON bot_conversations FOR UPDATE
  USING  (business_id = ls_staff_business_id())
  WITH CHECK (business_id = ls_staff_business_id());

-- ─── 2. conversation_messages ─────────────────────────────────────────────────

-- SELECT: staff del mismo negocio puede leer el historial de mensajes
CREATE POLICY "ls_conv_messages_select_staff"
  ON conversation_messages FOR SELECT
  USING (business_id = ls_staff_business_id());

-- INSERT: staff del mismo negocio puede insertar mensajes salientes
-- WITH CHECK evita insertar mensajes de otro negocio
CREATE POLICY "ls_conv_messages_insert_staff"
  ON conversation_messages FOR INSERT
  WITH CHECK (business_id = ls_staff_business_id());
