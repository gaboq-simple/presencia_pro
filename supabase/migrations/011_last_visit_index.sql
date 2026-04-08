-- ─── 011_last_visit_index.sql ────────────────────────────────────────────────
-- Índice para la query de reactivación.
-- Query destino:
--   SELECT id, phone, name FROM patients
--   WHERE client_id = ? AND last_visit < ? AND last_visit IS NOT NULL
--
-- El filtro IS NOT NULL está incluido en la condición WHERE del índice parcial
-- para excluir pacientes sin historial de visitas.

CREATE INDEX IF NOT EXISTS idx_patients_last_visit
  ON patients (client_id, last_visit)
  WHERE last_visit IS NOT NULL;
