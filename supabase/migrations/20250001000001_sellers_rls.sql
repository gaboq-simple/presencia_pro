-- ─── Row Level Security — sellers, leads, commission_payouts ──────────────────
--
-- Modelo de acceso:
--   Vendedor normal → ve y edita solo sus propios registros.
--   Operador        → acceso total a todas las filas de las tres tablas.
--
-- "Operador" se determina leyendo sellers.is_operator del propio usuario.
-- Las políticas de SELECT coexisten con USING en OR implícito por nombre distinto.

ALTER TABLE sellers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;

-- ─── sellers ──────────────────────────────────────────────────────────────────

-- Vendedor se ve a sí mismo.
CREATE POLICY sellers_select_own ON sellers
  FOR SELECT
  USING (user_id = auth.uid());

-- Operador ve todos los sellers.
CREATE POLICY sellers_select_operator ON sellers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sellers s
      WHERE s.user_id = auth.uid()
        AND s.is_operator = true
    )
  );

-- Solo operador puede actualizar sellers (e.g. cambiar comisiones, desactivar).
CREATE POLICY sellers_update_operator ON sellers
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sellers s
      WHERE s.user_id = auth.uid()
        AND s.is_operator = true
    )
  );

-- ─── leads ────────────────────────────────────────────────────────────────────

-- Vendedor ve sus propios leads.
CREATE POLICY leads_select_own ON leads
  FOR SELECT
  USING (
    seller_id IN (
      SELECT id FROM sellers WHERE user_id = auth.uid()
    )
  );

-- Vendedor inserta leads asignados a sí mismo.
CREATE POLICY leads_insert_own ON leads
  FOR INSERT
  WITH CHECK (
    seller_id IN (
      SELECT id FROM sellers WHERE user_id = auth.uid()
    )
  );

-- Vendedor actualiza sus propios leads.
CREATE POLICY leads_update_own ON leads
  FOR UPDATE
  USING (
    seller_id IN (
      SELECT id FROM sellers WHERE user_id = auth.uid()
    )
  );

-- Operador acceso total a leads.
CREATE POLICY leads_all_operator ON leads
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sellers s
      WHERE s.user_id = auth.uid()
        AND s.is_operator = true
    )
  );

-- ─── commission_payouts ───────────────────────────────────────────────────────

-- Vendedor solo lectura de sus propias comisiones.
CREATE POLICY payouts_select_own ON commission_payouts
  FOR SELECT
  USING (
    seller_id IN (
      SELECT id FROM sellers WHERE user_id = auth.uid()
    )
  );

-- Operador acceso total (INSERT para registrar pagos, UPDATE para marcar paid_at).
CREATE POLICY payouts_all_operator ON commission_payouts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sellers s
      WHERE s.user_id = auth.uid()
        AND s.is_operator = true
    )
  );
