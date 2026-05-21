-- ─── 028_notification_type_panel_notices.sql ──────────────────────────────────
-- Agrega 'reschedule_notice' y 'cancellation_notice' al CHECK constraint
-- de scheduled_notifications.type.
--
-- Estos tipos son insertados por assistant-actions.ts cuando el staff cancela
-- o reagenda una cita desde el panel, como log inmediato del WhatsApp enviado
-- al cliente. A diferencia de los reminders, se insertan con sent_at = NOW()
-- porque el envío ya ocurrió en el momento del INSERT.
--
-- Antes (026_notification_type_reactivation.sql):
--   type IN ('reminder_24h','reminder_2h','reminder_1h','follow_up',
--            'review_request','waitlist_expiry','reactivation')

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
    'waitlist_expiry',
    'reactivation',
    'reschedule_notice',
    'cancellation_notice'
  ));

COMMENT ON COLUMN scheduled_notifications.type IS
  'reminder_24h | reminder_2h | reminder_1h | follow_up | review_request | waitlist_expiry | reactivation | reschedule_notice | cancellation_notice';
