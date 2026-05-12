-- Migration 019: add arena palette + whatsapp_message column
-- Expands the palette CHECK constraint to include 'arena' and sets it as default.
-- Adds whatsapp_message to pre-fill the WhatsApp chat link.

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_palette_check,
  ADD CONSTRAINT businesses_palette_check
    CHECK (palette IN ('obsidian','humo','cuero','bronce','blanco','arena'));

ALTER TABLE businesses
  ALTER COLUMN palette SET DEFAULT 'arena';

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_message TEXT;
