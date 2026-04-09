-- ─── 016_monthly_reports.sql ──────────────────────────────────────────────────
-- Tabla de registro de reportes mensuales enviados.
-- Garantiza idempotencia: si el cron corre dos veces en el mismo día 1,
-- la segunda ejecución detecta el registro existente y no reenvía.
--
-- UNIQUE(client_id, year, month) — un solo reporte por cliente por mes.

CREATE TABLE IF NOT EXISTS monthly_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      TEXT        NOT NULL,
  year           INTEGER     NOT NULL,
  month          INTEGER     NOT NULL CHECK (month BETWEEN 1 AND 12),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  whatsapp_sent  BOOLEAN     NOT NULL DEFAULT FALSE,
  email_sent     BOOLEAN     NOT NULL DEFAULT FALSE,

  UNIQUE (client_id, year, month)
);

-- Índice de búsqueda por cliente
CREATE INDEX IF NOT EXISTS monthly_reports_client_id_idx
  ON monthly_reports (client_id);

-- RLS habilitado — el doctor solo ve sus propios reportes
ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
