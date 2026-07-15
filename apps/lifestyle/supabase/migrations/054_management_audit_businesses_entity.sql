-- ─── Migration 054 — management_audit: entity 'businesses' ─────────────────────
--
-- Extiende el audit de gestión (053) a la config del NEGOCIO: horarios de atención
-- (businesses.office_hours) y config de reportes/reseñas. Ambos viven en la tabla
-- `businesses`, así que el audit necesita entity='businesses' con entity_id=business_id.
--
-- 🔴 Sin esto, el CHECK de entity (053: services/staff/staff_services) RECHAZA el
-- insert y —como logManagementAudit es best-effort (no tira)— el fallo sería
-- SILENCIOSO: la ruta responde 200 y no queda ninguna fila. Esta migración lo destraba.
--
-- Aditiva: solo ensancha el CHECK de entity. NO toca datos, NI el CHECK de action
-- (horarios/config reusan 'updated' con changed_fields — el replace-all de horarios
-- queda claro con old_data/new_data = el office_hours viejo y nuevo). entity_id NO
-- tiene FK (es un uuid suelto), así que usar el business_id no rompe nada.

ALTER TABLE public.management_audit DROP CONSTRAINT IF EXISTS management_audit_entity_check;
ALTER TABLE public.management_audit ADD CONSTRAINT management_audit_entity_check
  CHECK (entity IN ('services', 'staff', 'staff_services', 'businesses'));
