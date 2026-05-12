-- Migration 022: campos de diseño para el mini-sitio público
-- Agrega paleta visual, tagline, horarios de atención y links sociales a businesses.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS palette TEXT NOT NULL
    DEFAULT 'obsidian'
    CHECK (palette IN ('obsidian','humo','cuero','bronce','blanco')),
  ADD COLUMN IF NOT EXISTS tagline TEXT
    CHECK (char_length(tagline) <= 60),
  ADD COLUMN IF NOT EXISTS office_hours JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS walk_in_buffer_minutes INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT;

-- Seed: negocio de prueba
UPDATE businesses SET
  palette = 'obsidian',
  tagline = 'El corte que te define.',
  office_hours = '{"1":{"open":"09:00","close":"19:00"},"2":{"open":"09:00","close":"19:00"},"3":{"open":"09:00","close":"19:00"},"4":{"open":"09:00","close":"19:00"},"5":{"open":"09:00","close":"19:00"},"6":{"open":"10:00","close":"17:00"}}'::jsonb
WHERE slug = 'barberia-demo';
