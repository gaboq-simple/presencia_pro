-- Paso 6 (rediseño barbero) — "el día se corrió".
-- Timestamp REAL de cierre de una cita, escrito por completeAppointment cuando el
-- barbero (o la recepción) marca Terminó. Es la única fuente del corrimiento del
-- día: atraso = completed_at − ends_at de la última cerrada, propagado en cadena
-- a las citas futuras (los huecos lo absorben). NULL = cerrada antes de esta
-- migración, o aún sin cerrar — nunca se retro-rellena (no sabemos cuándo terminó
-- de verdad) y por eso las citas históricas no generan atraso retroactivo.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN appointments.completed_at IS
  'Instante real en que se marcó Terminó (server action completeAppointment). Fuente única del corrimiento del día en la vista del barbero. NULL = sin cerrar o cerrada pre-migración.';
