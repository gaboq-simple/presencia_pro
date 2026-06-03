-- ─── Migration 039: Precio aproximado / rango en services ─────────────────────
-- Additive-only. NUNCA destructivo. `price` actual queda INTACTO (fallback exacto).
--
-- Semántica de precios (la consume buildBusinessContext en el engine):
--   - Si price_min y price_max existen           → es un RANGO   ("$X a $Y")
--   - Si solo price_min existe (sin price_max)   → es un MÍNIMO  ("desde $X")
--   - Si solo price (sin price_min/max)          → es EXACTO     ("$X")
--   - price_note es texto libre opcional para matizar ("aprox", "según largo de cabello", etc.)
--
-- Todas las columnas son nullable: configs/negocios existentes siguen funcionando
-- exactamente igual (precio exacto vía `price`).

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price_min  NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS price_max  NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS price_note TEXT;

COMMENT ON COLUMN public.services.price_min IS
  'Precio mínimo aproximado. Si price_max también existe → rango. Si solo price_min → "desde $X". NULL = usar price exacto.';

COMMENT ON COLUMN public.services.price_max IS
  'Precio máximo aproximado del rango. Requiere price_min. NULL = no es rango.';

COMMENT ON COLUMN public.services.price_note IS
  'Nota libre sobre el precio ("aprox", "según largo", etc.). Opcional. NULL = sin nota.';
