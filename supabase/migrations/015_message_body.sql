-- ─── 015_message_body.sql ──────────────────────────────────────────────────────
-- Agrega columna message_body a scheduled_notifications.
-- Cuando está presente, dispatch-notifications la usa como cuerpo del mensaje
-- en lugar del mensaje genérico construido en Deno.
-- Permite incluir contenido personalizado (links de cancelación, nombres
-- completos, etc.) que requieren acceso al ClientConfig de Next.js.

ALTER TABLE scheduled_notifications
  ADD COLUMN message_body TEXT;
