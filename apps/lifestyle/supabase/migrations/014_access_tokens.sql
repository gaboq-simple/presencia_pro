-- ─── Migration 014 — tokens de acceso y PIN de barberos ─────────────────────
-- Sistema de acceso para demo sin Supabase Auth:
--   · businesses.access_token   → token del dueño  (URL: /dashboard?token=XXX)
--   · businesses.assistant_token → token del asistente (URL: /dashboard?token=YYY&role=assistant)
--   · staff.pin                 → PIN de 4 dígitos del barbero (/staff → formulario PIN)
--
-- El PIN es UNIQUE por negocio — no puede haber dos barberos con el mismo
-- PIN dentro del mismo negocio. UNIQUE global sobre (business_id, pin).

ALTER TABLE businesses
  ADD COLUMN access_token    TEXT UNIQUE,
  ADD COLUMN assistant_token TEXT UNIQUE;

ALTER TABLE staff
  ADD COLUMN pin CHAR(4) CHECK (pin ~ '^\d{4}$');

-- UNIQUE(business_id, pin) — un PIN por barbero por negocio
CREATE UNIQUE INDEX idx_staff_business_pin
  ON staff (business_id, pin)
  WHERE pin IS NOT NULL;

-- Índices para lookup rápido por token (validación en middleware — path crítico)
CREATE INDEX idx_businesses_access_token    ON businesses (access_token)    WHERE access_token IS NOT NULL;
CREATE INDEX idx_businesses_assistant_token ON businesses (assistant_token) WHERE assistant_token IS NOT NULL;
