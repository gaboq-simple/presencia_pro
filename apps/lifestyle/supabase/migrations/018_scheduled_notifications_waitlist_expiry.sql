-- ─── 018_scheduled_notifications_waitlist_expiry.sql ─────────────────────────
-- Agrega 'waitlist_expiry' al CHECK constraint de scheduled_notifications.type.
--
-- Antes (004_reminder_notification_type.sql):
--   type IN ('reminder_24h', 'reminder_2h', 'reminder_1h', 'follow_up', 'review_request')
--
-- El engine (scheduling.ts notifyWaitlist) inserta type='waitlist_expiry' al
-- notificar al primer cliente en lista de espera cuando se libera un slot.
-- Sin este tipo el INSERT viola el CHECK constraint y falla silenciosamente
-- (envuelto en best-effort try/catch en notifyWaitlist).

ALTER TABLE scheduled_notifications
  DROP CONSTRAINT IF EXISTS scheduled_notifications_type_check;

ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_type_check
  CHECK (type IN (
    'reminder_24h',
    'reminder_2h',
    'reminder_1h',
    'follow_up',
    'review_request',
    'waitlist_expiry'
  ));

COMMENT ON COLUMN scheduled_notifications.type IS
  'reminder_24h | reminder_2h | reminder_1h | follow_up | review_request | waitlist_expiry';
