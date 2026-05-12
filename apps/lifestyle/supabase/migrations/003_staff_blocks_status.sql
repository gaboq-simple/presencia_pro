-- ─── Migration 003 — staff_blocks.status ──────────────────────────────────────
-- Agrega columna status a staff_blocks para el flujo de solicitudes de bloqueo.
-- El barbero crea solicitudes con status='pending'; el admin las aprueba/rechaza.

-- 1. Columna con CHECK constraint
ALTER TABLE staff_blocks
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- 2. Política RLS: admin puede UPDATE status en solicitudes de su negocio
--    ls_staff_role() y ls_staff_business_id() son funciones SECURITY DEFINER
--    definidas en 002_rls_policies.sql — leen sin ciclos RLS.
CREATE POLICY "admin_can_update_block_status"
  ON staff_blocks FOR UPDATE
  TO authenticated
  USING (
    ls_staff_role() = 'admin'
    AND staff_id IN (
      SELECT id FROM staff
      WHERE business_id = ls_staff_business_id()
        AND active = TRUE
    )
  );
