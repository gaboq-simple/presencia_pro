-- ─── 005_walkin_buffer.sql ────────────────────────────────────────────────────
-- Agrega walk_in_buffer_minutes a businesses.
-- Controla el buffer mínimo de anticipación para modo walk-in del bot.
-- Default: 60 minutos — el bot ofrece el slot más cercano disponible a partir
-- de NOW() + walk_in_buffer_minutes.

ALTER TABLE businesses
  ADD COLUMN walk_in_buffer_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (walk_in_buffer_minutes >= 0);

COMMENT ON COLUMN businesses.walk_in_buffer_minutes IS
  'Buffer mínimo en minutos para walk-in desde NOW(). Default 60.';
