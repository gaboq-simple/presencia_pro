-- ─── Migration 023 — Trazabilidad de citas + phone nullable en customers ───────
--
-- 1. customers.phone: se hace nullable para permitir clientes registrados
--    manualmente (sin WhatsApp) desde la vista del asistente.
--    La restriccion UNIQUE(business_id, phone) se mantiene; SQL trata NULL
--    como distinto de NULL, por lo que multiples filas con phone=NULL son validas.
--
-- 2. appointments: tres columnas de auditoría para saber quién creó y quién
--    modificó cada cita desde la vista del asistente.
--      · created_by_staff_id — staff que creó la cita (NULL si fue por bot/owner)
--      · modified_by_staff_id — staff que hizo la última modificación
--      · modified_at — timestamp de la última modificación

-- ─── customers: phone nullable ─────────────────────────────────────────────────

ALTER TABLE customers
  ALTER COLUMN phone DROP NOT NULL;

-- ─── appointments: columnas de trazabilidad ────────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS created_by_staff_id  UUID        REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modified_by_staff_id UUID        REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modified_at          TIMESTAMPTZ;

-- Índices para lookup por staff (auditoría / reportes futuros)
CREATE INDEX IF NOT EXISTS idx_appointments_created_by
  ON appointments (created_by_staff_id)
  WHERE created_by_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_modified_by
  ON appointments (modified_by_staff_id)
  WHERE modified_by_staff_id IS NOT NULL;

COMMENT ON COLUMN appointments.created_by_staff_id IS
  'Staff que creó la cita desde la vista del asistente. NULL si fue el bot u owner directo.';

COMMENT ON COLUMN appointments.modified_by_staff_id IS
  'Staff que realizó la última modificación (cambio de estado, reagenda, notas).';

COMMENT ON COLUMN appointments.modified_at IS
  'Timestamp de la última modificación de la cita.';

COMMENT ON COLUMN customers.phone IS
  'WhatsApp canónico normalizado. Nullable para clientes registrados sin teléfono.';
