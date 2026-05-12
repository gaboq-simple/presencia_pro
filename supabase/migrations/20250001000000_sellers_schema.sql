-- ─── sellers ──────────────────────────────────────────────────────────────────
-- Tabla de vendedores de la plataforma PresenciaPro.
-- Cada vendedor tiene un usuario en Supabase Auth (user_id).
-- is_operator = true otorga acceso de lectura/escritura global sobre leads y payouts.

CREATE TABLE sellers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  phone                     TEXT NOT NULL,
  email                     TEXT NOT NULL,
  commission_setup_pct      NUMERIC(5,2)  NOT NULL DEFAULT 20.00,
  commission_monthly_mxn    NUMERIC(10,2) NOT NULL DEFAULT 120.00,
  commission_monthly_months INTEGER       NOT NULL DEFAULT 6,
  is_operator               BOOLEAN       NOT NULL DEFAULT false,
  active                    BOOLEAN       NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(email),
  UNIQUE(phone)
);

-- ─── leads ────────────────────────────────────────────────────────────────────
-- Prospecto médico que un vendedor está trabajando.
-- status sigue el ciclo de ventas; deploy_completed activa las comisiones.

CREATE TABLE leads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID        NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  doctor_name       TEXT        NOT NULL,
  doctor_phone      TEXT        NOT NULL,
  specialty         TEXT,
  city              TEXT        NOT NULL,
  notes             TEXT,
  status            TEXT        NOT NULL DEFAULT 'lead'
                    CHECK (status IN (
                      'lead',
                      'proposal_sent',
                      'negotiating',
                      'deploy_completed',
                      'lost'
                    )),
  setup_amount_mxn  NUMERIC(10,2),
  client_id         TEXT,
  deployed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(doctor_phone)
);

CREATE INDEX leads_seller_id_idx  ON leads(seller_id);
CREATE INDEX leads_status_idx     ON leads(status);
CREATE INDEX leads_created_at_idx ON leads(created_at);

-- Trigger que mantiene updated_at sincronizado en cada UPDATE.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── commission_payouts ───────────────────────────────────────────────────────
-- Registro de pagos de comisión al vendedor.
-- type = 'setup'   → comisión única por despliegue (commission_setup_pct del setup_amount_mxn).
-- type = 'monthly' → pago mensual recurrente (commission_monthly_mxn por período).
-- UNIQUE(lead_id, type, period_month) evita duplicados por período.

CREATE TABLE commission_payouts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID        NOT NULL REFERENCES sellers(id)     ON DELETE RESTRICT,
  lead_id       UUID        NOT NULL REFERENCES leads(id)       ON DELETE RESTRICT,
  type          TEXT        NOT NULL CHECK (type IN ('setup', 'monthly')),
  amount_mxn    NUMERIC(10,2) NOT NULL,
  period_month  DATE,
  paid_at       TIMESTAMPTZ,
  paid_by       UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id, type, period_month)
);

CREATE INDEX commission_payouts_seller_id_idx ON commission_payouts(seller_id);
CREATE INDEX commission_payouts_paid_at_idx   ON commission_payouts(paid_at);
