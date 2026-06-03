-- ─── Migration 041: Link de mapa (ubicación) del negocio ──────────────────────
-- Additive-only. Nullable → negocios existentes quedan con map_url NULL.
--
-- URL de Google Maps / Apple Maps para responder side-questions de ubicación
-- ("cómo llego", "dónde quedan"). El bot lo comparte junto con la dirección de texto.
-- Si es NULL, el bot responde solo con la dirección de texto.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS map_url TEXT;

COMMENT ON COLUMN public.businesses.map_url IS
  'Link de mapa (Google/Apple Maps) para side-questions de ubicación. NULL = solo dirección de texto.';
