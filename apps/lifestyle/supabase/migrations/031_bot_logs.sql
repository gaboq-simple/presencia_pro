-- ─── Migration 031 — bot_logs ────────────────────────────────────────────────
-- Crea la tabla bot_logs para el handler del bot de lifestyle.
-- Registra cada transición de estado: modelo usado, duración, errores.
-- El handler escribe best-effort (fallo silencioso si la tabla no existe).
-- Usa IF NOT EXISTS por idempotencia.

CREATE TABLE IF NOT EXISTS bot_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id),
  customer_phone TEXT NOT NULL,
  state_from     TEXT NOT NULL,
  state_to       TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  model_used     TEXT,
  tokens_total   INTEGER,
  error_code     TEXT,
  error_message  TEXT,
  recovered      BOOLEAN,
  duration_ms    INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_business_created
  ON bot_logs(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_logs_customer
  ON bot_logs(business_id, customer_phone, created_at DESC);

ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;

-- service_role bypasea RLS automáticamente (escritura del bot)
-- Dashboard admin: resuelve business_id via staff.auth_id → staff.business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bot_logs' AND policyname = 'admin_read_own_logs'
  ) THEN
    CREATE POLICY "admin_read_own_logs"
      ON bot_logs FOR SELECT
      TO authenticated
      USING (
        business_id = (
          SELECT business_id FROM staff
          WHERE auth_id = auth.uid()
            AND active = true
          LIMIT 1
        )
      );
  END IF;
END;
$$;
