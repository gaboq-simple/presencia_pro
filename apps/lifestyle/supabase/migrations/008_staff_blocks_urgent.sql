-- ─── Migration 008: staff_blocks — columna urgent ────────────────────────────
-- Agrega campo urgent BOOLEAN para que el barbero marque solicitudes urgentes.
-- Una solicitud urgente + starts_at hoy/mañana dispara WhatsApp al admin.
-- RLS: sin cambios — las políticas existentes cubren el nuevo campo.

ALTER TABLE staff_blocks
  ADD COLUMN IF NOT EXISTS urgent BOOLEAN NOT NULL DEFAULT false;
