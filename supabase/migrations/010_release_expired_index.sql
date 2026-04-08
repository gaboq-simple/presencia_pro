-- ─── 010_release_expired_index.sql ───────────────────────────────────────────
-- Índice parcial para la query del cron release-expired-slots.
-- Query destino:
--   SELECT id FROM appointments
--   WHERE client_id = ? AND status = 'pending_confirmation' AND created_at < ?
--
-- El índice 008 (idx_appointments_client_status_starts) indexa starts_at, no created_at.
-- Este índice parcial es más eficiente para el cron porque:
--   - Solo incluye filas en pending_confirmation (tabla pequeña en producción)
--   - Ordena por created_at que es la condición de expiración

CREATE INDEX IF NOT EXISTS idx_appointments_pending_confirmation
  ON appointments (client_id, status, created_at)
  WHERE status = 'pending_confirmation';
