-- ─── 004_reminder_notification_type.sql ──────────────────────────────────────
-- Agrega documentación del nuevo tipo 'reminder_1h' en scheduled_notifications.
-- La tabla usa TEXT NOT NULL sin CHECK constraint — la validación es a nivel
-- de aplicación (engine). Este migration agrega el CHECK constraint explícito
-- para reflejar todos los tipos válidos incluyendo el nuevo 'reminder_1h'.

ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_type_check
  CHECK (type IN (
    'reminder_24h',
    'reminder_2h',
    'reminder_1h',
    'follow_up',
    'review_request'
  ));

COMMENT ON COLUMN scheduled_notifications.type IS
  'reminder_24h | reminder_2h | reminder_1h | follow_up | review_request';
