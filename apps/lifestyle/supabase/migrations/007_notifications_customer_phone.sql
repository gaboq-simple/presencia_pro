-- ─── 007_notifications_customer_phone.sql ────────────────────────────────────
-- Agrega campos de contacto y mensaje a scheduled_notifications de lifestyle.
-- Necesarios para que dispatch-lifestyle-notifications pueda enviar sin
-- hacer JOINs adicionales en cada despacho.

ALTER TABLE scheduled_notifications
  -- Teléfono del cliente (whatsapp_id canónico, sin + ni espacios).
  -- Se almacena al crear la notificación en el estado CONFIRMED del bot.
  ADD COLUMN customer_phone TEXT,

  -- Cuerpo del mensaje pre-construido por el estado CONFIRMED.
  -- Si está presente, el despachador lo usa directamente.
  ADD COLUMN message_body TEXT;

COMMENT ON COLUMN scheduled_notifications.customer_phone IS
  'whatsapp_id canónico del cliente destino. Almacenado al crear la notificación.';

COMMENT ON COLUMN scheduled_notifications.message_body IS
  'Cuerpo del mensaje pre-construido. Si está presente, el despachador lo usa directamente.';

-- Índice para el cron de despacho (WHERE sent_at IS NULL AND scheduled_for <= NOW())
CREATE INDEX idx_scheduled_notifications_pending
  ON scheduled_notifications (scheduled_for)
  WHERE sent_at IS NULL AND failed_at IS NULL;
