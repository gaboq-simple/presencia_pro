-- ─── Migration 040: Atributos / amenities del negocio ─────────────────────────
-- Additive-only. JSONB con default '{}' → negocios existentes obtienen {} y siguen
-- funcionando sin cambios.
--
-- Banderas booleanas libres que el bot puede mencionar como side-question.
-- Ejemplos de claves (no es un enum cerrado — el engine solo lee las que conoce):
--   { "pays_card": true, "parking": true, "kids_friendly": false, "wifi": true,
--     "wheelchair_accessible": true }
--
-- El engine (buildBusinessContext) ignora claves desconocidas y omite las false/ausentes.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.businesses.attributes IS
  'Amenities/banderas del negocio para side-questions del bot. JSONB de booleanos, ej: {"pays_card":true,"parking":true,"kids_friendly":true}. Default {}.';
