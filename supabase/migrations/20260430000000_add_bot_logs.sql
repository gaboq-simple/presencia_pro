CREATE TABLE bot_logs (
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

CREATE INDEX idx_bot_logs_business_created
  ON bot_logs(business_id, created_at DESC);

CREATE INDEX idx_bot_logs_customer
  ON bot_logs(business_id, customer_phone, created_at DESC);

ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;

-- service_role bypasea RLS automáticamente (escritura del bot)
-- Dashboard admin: resuelve business_id via staff.auth_id → staff.business_id
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
