-- ─── 011_waitlist_and_review.sql ──────────────────────────────────────────────
-- Agrega:
--   1. Tabla waitlist — lista de espera para citas canceladas/sin disponibilidad
--   2. Columnas review_url y review_requests_enabled en businesses
--   3. Columna customer_id en scheduled_notifications (FK a customers)
--   4. RLS en waitlist
--   5. Seed de barberia-demo con valores por defecto de reseñas

-- ─── 1. Tabla waitlist ────────────────────────────────────────────────────────

CREATE TABLE waitlist (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  service_id               UUID NOT NULL REFERENCES services(id)   ON DELETE CASCADE,
  staff_id                 UUID             REFERENCES staff(id)   ON DELETE SET NULL,
  requested_date           DATE NOT NULL,
  requested_time_preference TEXT,
  status                   TEXT NOT NULL DEFAULT 'waiting'
                             CHECK (status IN ('waiting','notified','confirmed','expired')),
  notified_at              TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waitlist_business_date_status
  ON waitlist (business_id, requested_date, status);

COMMENT ON TABLE waitlist IS
  'Lista de espera de clientes para citas sin disponibilidad inmediata.';

COMMENT ON COLUMN waitlist.requested_time_preference IS
  'Preferencia horaria expresada por el cliente: mañana | tarde | cualquiera';

COMMENT ON COLUMN waitlist.expires_at IS
  'notified_at + 30 minutos. Tras este tiempo el slot se libera al siguiente en espera.';

-- ─── 2. Columnas en businesses ────────────────────────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS review_url TEXT,
  ADD COLUMN IF NOT EXISTS review_requests_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN businesses.review_url IS
  'URL de Google Reviews u otra plataforma de reseñas del negocio.';

COMMENT ON COLUMN businesses.review_requests_enabled IS
  'Habilita el envío automático de solicitud de reseña 24h después de una cita completada.';

-- ─── 3. Columna customer_id en scheduled_notifications ───────────────────────

ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN scheduled_notifications.customer_id IS
  'FK al cliente destino. Complementa customer_phone — permite JOIN a customers.';

-- ─── 4. RLS en waitlist ───────────────────────────────────────────────────────

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Admin del mismo negocio: SELECT + UPDATE
CREATE POLICY waitlist_admin_select ON waitlist
  FOR SELECT
  TO authenticated
  USING (business_id = ls_staff_business_id());

CREATE POLICY waitlist_admin_update ON waitlist
  FOR UPDATE
  TO authenticated
  USING (
    business_id = ls_staff_business_id()
    AND ls_staff_role() = 'admin'
  );

-- Staff (barber) del mismo negocio: solo SELECT
CREATE POLICY waitlist_staff_select ON waitlist
  FOR SELECT
  TO authenticated
  USING (business_id = ls_staff_business_id());

-- Service role (bot): INSERT sin restricción de rol (bypasa RLS)
-- El bot usa service_role_key → bypasa RLS automáticamente.
-- No se necesita política adicional para INSERT desde service_role.

-- ─── 5. Seed barberia-demo ────────────────────────────────────────────────────

UPDATE businesses
SET
  review_requests_enabled = false,
  review_url = 'https://g.page/r/barberia-demo-placeholder'
WHERE slug = 'barberia-demo';
