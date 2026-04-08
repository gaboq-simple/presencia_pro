-- ─── 009_post_consulta_notification_type.sql ───────────────────────────────────
-- Agrega 'post_consulta' al CHECK constraint de scheduled_notifications.type.
-- Corresponde al nuevo ReminderType añadido en notifications/types.ts.
--
-- Timing: se envía ~1h después de startsAt (asumiendo que la cita ya terminó).
-- Trigger: api/appointments/complete scheduleReminder({ type: 'post_consulta', ... })

-- Postgres no permite modificar una constraint inline — hay que eliminarla y recrearla.
-- El nombre 'scheduled_notifications_type_check' es el auto-generado por la migración 006.
ALTER TABLE scheduled_notifications
  DROP CONSTRAINT IF EXISTS scheduled_notifications_type_check;

ALTER TABLE scheduled_notifications
  ADD CONSTRAINT scheduled_notifications_type_check
  CHECK (type IN (
    'appointment_reminder',
    'appointment_confirmation',
    'appointment_confirmed',
    'appointment_cancelled',
    'review_request',
    'reactivation',
    'post_consulta'
  ));
