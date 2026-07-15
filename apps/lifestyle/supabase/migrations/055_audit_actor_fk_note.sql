-- ─── Migration 055 — Nota de schema: FK SET NULL de audit vs. trigger inmutable ──
--
-- SOLO documentación (COMMENT ON COLUMN). No cambia comportamiento ni datos.
--
-- Contradicción a dejar asentada en el schema (no en un doc suelto):
-- appointment_audit.actor_staff_id (045) y management_audit.actor_staff_id (053) son
-- FK a staff(id) con ON DELETE SET NULL. Pero ese SET NULL es LETRA MUERTA: al borrar
-- un staff, Postgres intenta UPDATE <audit> SET actor_staff_id=NULL, y el trigger de
-- inmutabilidad (trg_appt_audit_immutable / trg_mgmt_audit_immutable, BEFORE UPDATE →
-- RAISE) lo bloquea → el DELETE del staff FALLA.
--
-- Nota adicional: el hard-delete de staff YA era imposible por el NO ACTION de
-- appointments.staff_id (un barbero con citas no se puede borrar). El audit sólo
-- EXTIENDE esa imposibilidad al staff SIN citas pero CON historial de audit. En la
-- práctica la app nunca hace hard-delete de staff (desactiva con active=false), así
-- que el conflicto no se dispara en operación normal — es un latente.
--
-- Salida prevista (NO se resuelve acá): una función SECURITY DEFINER que deshabilite
-- el trigger de inmutabilidad DENTRO de su transacción para poder purgar/borrar,
-- diseñada junto con la retención LFPDPPP que 045/053 ya anticipan en sus comentarios.

COMMENT ON COLUMN public.appointment_audit.actor_staff_id IS
  'FK a staff(id) ON DELETE SET NULL, pero el SET NULL es letra muerta: dispara un UPDATE que el trigger de inmutabilidad (trg_appt_audit_immutable) bloquea → borrar un staff con historial de audit falla. El hard-delete de staff ya era imposible por appointments.staff_id NO ACTION; esto lo extiende al staff sin citas. Salida prevista: función SECURITY DEFINER que deshabilite el trigger en su transacción, junto con la retención (ver 045).';

COMMENT ON COLUMN public.management_audit.actor_staff_id IS
  'FK a staff(id) ON DELETE SET NULL, pero el SET NULL es letra muerta: dispara un UPDATE que el trigger de inmutabilidad (trg_mgmt_audit_immutable) bloquea → borrar un staff con historial de audit falla. Ver la nota gemela en appointment_audit.actor_staff_id (migración 055). Salida prevista: función SECURITY DEFINER que deshabilite el trigger en su transacción, junto con la retención (ver 053).';
