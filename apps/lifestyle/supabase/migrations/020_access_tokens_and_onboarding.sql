-- ─── Migration 020 — tokens de acceso, PIN de staff y datos de onboarding ─────
-- Combina migration 014 (access_token, assistant_token, pin) con la nueva
-- columna onboarding_data para almacenar datos de Fase 2 y contacto del dueño.
--
-- Todos los ALTER son idempotentes (IF NOT EXISTS).
-- onboarding_data JSONB almacena:
--   { bot_extra, whatsapp, owner_contact }
--   Se rellena por el script de onboarding; se consulta manualmente por el
--   operador cuando activa WhatsApp en Fase 2.

-- ─── businesses: tokens de acceso ─────────────────────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS access_token    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS assistant_token TEXT UNIQUE;

-- Índices para lookup rápido por token (validación en middleware — path crítico)
CREATE INDEX IF NOT EXISTS idx_businesses_access_token
  ON businesses (access_token)
  WHERE access_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_assistant_token
  ON businesses (assistant_token)
  WHERE assistant_token IS NOT NULL;

-- ─── staff: PIN de 4 dígitos ───────────────────────────────────────────────────

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS pin CHAR(4) CHECK (pin ~ '^\d{4}$');

-- UNIQUE(business_id, pin) — un PIN por barbero por negocio
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_business_pin
  ON staff (business_id, pin)
  WHERE pin IS NOT NULL;

-- ─── businesses: datos de onboarding (Fase 2) ─────────────────────────────────
-- JSONB para almacenar datos opcionales de WhatsApp, contacto del dueño y
-- configuración extra del bot (greeting, followup_message).
-- Formato esperado:
-- {
--   "bot_extra": {
--     "greeting": "...",
--     "followup_message": "..."
--   },
--   "whatsapp": {
--     "number_model": "own" | "provided",
--     "phone_number": "...",
--     "business_profile": { ... },
--     "verification": { ... }
--   },
--   "owner_contact": {
--     "name": "...",
--     "phone": "...",
--     "email": "..."
--   }
-- }

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB;

COMMENT ON COLUMN businesses.access_token IS
  'Token de acceso del dueño al dashboard. URL: /dashboard?token=XXX. 32 chars hex.';

COMMENT ON COLUMN businesses.assistant_token IS
  'Token de acceso del asistente al dashboard. 32 chars hex.';

COMMENT ON COLUMN staff.pin IS
  'PIN de 4 dígitos para acceso del barbero. UNIQUE por negocio.';

COMMENT ON COLUMN businesses.onboarding_data IS
  'Datos de onboarding Fase 2: bot_extra (greeting, followup_message), '
  'whatsapp (número, verificación, perfil Meta), owner_contact. '
  'Referencia para el operador al activar WhatsApp.';
