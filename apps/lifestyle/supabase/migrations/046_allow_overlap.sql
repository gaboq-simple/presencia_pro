-- ─── allow_overlap: solape INTENCIONAL forzado por la recepción ────────────────
-- Contexto: el constraint no_overlapping_appointments (migración 016) es la última
-- línea de defensa contra el doble-booking ACCIDENTAL (bot, create, PATCH — flujos
-- automáticos cuyo pre-check no es transaccional). Pero la recepción, que sabe cosas
-- que el sistema no (ej. padre e hijo se cortan juntos), a veces necesita FORZAR un
-- solape parcial a propósito.
--
-- Solución (Opción C, S6-UI-02 PR-3): una columna booleana por cita. El constraint
-- sigue bloqueando a todos EXCEPTO a las filas marcadas allow_overlap=true. Solo
-- rescheduleAppointment(force=true) las marca, y solo cuando un HUMANO fuerza el
-- reacomodo manual. Los flujos automáticos nunca la setean (default false) → siguen
-- 100% protegidos contra el solape accidental. Distingue intencional-humano de
-- accidental-automático sin abrir la puerta a todos.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS allow_overlap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN appointments.allow_overlap IS
  'TRUE = solape intencional forzado por la recepción (exenta del constraint de no-solape). Solo la setea rescheduleAppointment(force=true). Default FALSE = protegida.';

-- Recrear el EXCLUDE condicionando la exención a la nueva columna.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS no_overlapping_appointments;

ALTER TABLE appointments
  ADD CONSTRAINT no_overlapping_appointments
  EXCLUDE USING gist (
    staff_id                            WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled') AND allow_overlap = false);
