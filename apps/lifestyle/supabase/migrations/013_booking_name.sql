-- ─── Migration 013 — booking_name en appointments ────────────────────────────
-- Agrega el campo booking_name a la tabla appointments.
-- Representa el nombre real de la persona para quien es la cita, que puede
-- diferir del nombre del perfil de WhatsApp (quien agenda).
-- Nullable: citas creadas antes de esta migración y citas manuales no lo tienen.

ALTER TABLE appointments ADD COLUMN booking_name TEXT;
