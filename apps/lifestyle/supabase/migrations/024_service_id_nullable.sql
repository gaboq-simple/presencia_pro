-- ─── Migration 024 — appointments.service_id nullable ────────────────────────
--
-- service_id era NOT NULL desde el schema inicial. Se hace nullable para permitir
-- citas registradas sin servicio asociado (ej. walk-ins rápidos, bloqueos manuales
-- de agenda) sin romper filas existentes.
--
-- El bot y el dashboard siguen enviando service_id siempre que conocen el servicio;
-- nullable solo habilita el caso edge donde no aplica.

ALTER TABLE appointments
  ALTER COLUMN service_id DROP NOT NULL;

COMMENT ON COLUMN appointments.service_id IS
  'Servicio agendado. Nullable para walk-ins o bloqueos donde el servicio no aplica.';
