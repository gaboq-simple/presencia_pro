-- ─── Migration 009: staff — columna photo_url ────────────────────────────────
-- Agrega photo_url TEXT nullable para almacenar la URL pública de Supabase
-- Storage de la foto del barbero. RLS sin cambios — las políticas existentes
-- cubren el nuevo campo.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
