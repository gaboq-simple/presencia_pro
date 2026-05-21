-- ─── 026_notification_type_reactivation.sql ──────────────────────────────────
-- Agrega 'reactivation' al CHECK constraint de scheduled_notifications.type.
--
-- El route /api/customers/[id]/reactivation/route.ts inserta filas con
-- type='reactivation' pero el constraint anterior no lo incluía, causando
-- violación silenciosa (el INSERT falla dentro de un try/catch best-effort).
--
-- Antes (018_scheduled_notifications_waitlist_expiry.sql):
--   type IN ('reminder_24h','reminder_2h','reminder_1h','follow_up',
--            'review_request','waitlist_expiry')

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
    'reactivation'
  ));

COMMENT ON COLUMN scheduled_notifications.type IS
  'reminder_24h | reminder_2h | reminder_1h | follow_up | review_request | waitlist_expiry | reactivation';
