-- ─── 025_businesses_report_config.sql ─────────────────────────────────────────
-- Agrega configuración de reportes automáticos semanales por WhatsApp
-- y umbral de inactividad de clientes a la tabla businesses.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS report_whatsapp        TEXT,
  ADD COLUMN IF NOT EXISTS report_enabled         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactive_threshold_days INT     NOT NULL DEFAULT 21;

-- Actualizar barberia-demo con valores iniciales
UPDATE businesses
SET
  report_whatsapp        = whatsapp_number,
  report_enabled         = true,
  inactive_threshold_days = 21
WHERE slug = 'barberia-demo';
