-- Migration 018b: backfill businesses columns missing from the lifestyle folder
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE
--   La carpeta canónica apps/lifestyle/supabase/migrations/ es una renumeración
--   que portó migraciones que USAN columnas de `businesses` pero omitió las que
--   las CREAN (vivían en la carpeta raíz legacy /supabase/migrations/).
--   En una DB virgen, al aplicar 001→041 en orden, la migración 019 falla con
--   `column "palette" does not exist` porque ninguna migración lifestyle la crea.
--
-- ESTRATEGIA
--   Crear, de forma 100% IDEMPOTENTE, las 8 columnas FALTA-CREAR de `businesses`
--   tal como el CÓDIGO las espera HOY (sin features futuras). Se ordena ANTES de
--   019 (018b < 019) para que 019 pueda expandir el CHECK de palette con 'arena'.
--
-- ORIGEN DE CADA COLUMNA (carpeta raíz legacy, no portada a lifestyle):
--   palette, tagline, instagram_url, tiktok_url  → raíz 022_businesses_design_fields.sql
--   report_whatsapp, report_enabled,
--   inactive_threshold_days                       → raíz 025_businesses_report_config.sql
--   timezone                                      → leída por el código (BUSINESS_SELECT
--                                                    en apps/lifestyle/src/app/api/bot/route.ts);
--                                                    ninguna migración lifestyle la crea.
--
-- Nota palette: aquí se crea con su CHECK BASE (obsidian/humo/cuero/bronce/blanco)
-- y default 'obsidian'. La migración 019 (posterior) hace DROP+ADD del constraint
-- para incluir 'arena' y cambia el default a 'arena'. No tocar ese contrato aquí.

-- ── timezone ──────────────────────────────────────────────────────────────────
-- IANA tz del negocio. El bot la requiere para horarios/slots. NOT NULL con default.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City';

-- ── palette (origen raíz 022) ─────────────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS palette TEXT NOT NULL DEFAULT 'obsidian';

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_palette_check;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_palette_check
    CHECK (palette IN ('obsidian','humo','cuero','bronce','blanco'));

-- ── tagline (origen raíz 022) ─────────────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tagline TEXT;

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_tagline_check;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_tagline_check
    CHECK (char_length(tagline) <= 60);

-- ── instagram_url / tiktok_url (origen raíz 022) ──────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT;

-- ── report config (origen raíz 025) ───────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS report_whatsapp TEXT;
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS report_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS inactive_threshold_days INTEGER NOT NULL DEFAULT 21;
