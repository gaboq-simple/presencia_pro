-- ─── Migration 015 — fuente 'llamada' en appointments ────────────────────────
-- Agrega 'llamada' como valor válido de appointments.source.
-- Representa citas agendadas por teléfono (registro manual del asistente).
--
-- Antes: CHECK (source IN ('bot', 'manual', 'walkin'))
-- Después: CHECK (source IN ('bot', 'manual', 'walkin', 'llamada'))

ALTER TABLE appointments
  DROP CONSTRAINT appointments_source_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_source_check
    CHECK (source IN ('bot', 'manual', 'walkin', 'llamada'));
