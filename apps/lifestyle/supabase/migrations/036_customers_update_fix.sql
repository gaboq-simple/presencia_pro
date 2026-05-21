-- ─── Migration 036 — Fix ls_customers_update: prevenir movimiento entre negocios ─
-- Origen: S1-SEC-05 / Phase 2 R5
--
-- Problema: la policy ls_customers_update tenía USING pero no WITH CHECK.
-- Sin WITH CHECK, un staff podía hacer UPDATE customers SET business_id = 'otro'
-- y mover un cliente a otro negocio.
--
-- Fix: agregar WITH CHECK (business_id = ls_staff_business_id()) para asegurar
-- que el valor de business_id en la fila resultante siga siendo el del negocio
-- del staff que ejecuta el UPDATE.
--
-- Nota: service_role bypasa RLS — no se ve afectado.

DROP POLICY IF EXISTS "ls_customers_update" ON customers;

CREATE POLICY "ls_customers_update"
  ON customers FOR UPDATE
  USING     (business_id = ls_staff_business_id())
  WITH CHECK (business_id = ls_staff_business_id());
