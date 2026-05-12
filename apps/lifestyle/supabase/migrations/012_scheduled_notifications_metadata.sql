-- ─── 012_scheduled_notifications_metadata.sql ────────────────────────────────
-- Agrega columna metadata JSONB a scheduled_notifications.
-- Necesaria para waitlist_expiry: guarda { waitlist_id, slot_starts_at,
-- slot_staff_id, slot_staff_name, service_name } para que
-- dispatch-lifestyle-notifications pueda procesar la expiración sin queries extra.

ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN scheduled_notifications.metadata IS
  'Datos auxiliares dependientes del tipo de notificación. Ej: { "waitlist_id": "uuid" } para waitlist_expiry.';
