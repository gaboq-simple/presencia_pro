-- Migration: paleta 'arena' (mid-century warm) + whatsapp_message por negocio
-- Agrega la variante de diseño cálida como nuevo default del template.

-- 1. Ampliar el CHECK constraint para incluir 'arena'
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_palette_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_palette_check
    CHECK (palette IN ('obsidian','humo','cuero','bronce','blanco','arena'));

-- 2. Cambiar el default de palette a 'arena'
ALTER TABLE businesses
  ALTER COLUMN palette SET DEFAULT 'arena';

-- 3. Agregar whatsapp_message — mensaje pre-llenado personalizable por negocio
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_message TEXT;
