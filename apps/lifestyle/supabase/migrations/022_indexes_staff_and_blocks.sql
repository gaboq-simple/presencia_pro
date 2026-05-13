-- ─── Migración 022 — Índices faltantes: staff y staff_blocks ──────────────────
-- Hallazgos de auditoría de seguridad y rendimiento.
--
-- A-3: idx_staff_business_active
--   La query `staff WHERE business_id = X AND active = TRUE` aparece en más
--   de 8 rutas (auth.ts, appointments PATCH, business/config, customers/inactive,
--   etc.). Sin índice Postgres hace full scan de la tabla staff filtrada solo
--   por el índice de FK en business_id, luego aplica active en memoria.
--   El índice parcial (WHERE active = TRUE) excluye filas inactivas y es más
--   compacto en disco.
--
-- A-4: idx_staff_blocks_staff_starts
--   El scheduling engine consulta bloques por staff_id + rango de fechas en
--   cada request de disponibilidad. Sin índice en starts_at Postgres ordena
--   el resultado de la búsqueda por FK sin poder usar un range scan.

-- A-3: staff(business_id) WHERE active = TRUE
CREATE INDEX IF NOT EXISTS idx_staff_business_active
  ON staff (business_id, active)
  WHERE active = TRUE;

-- A-4: staff_blocks(staff_id, starts_at) para range scans de disponibilidad
CREATE INDEX IF NOT EXISTS idx_staff_blocks_staff_starts
  ON staff_blocks (staff_id, starts_at);
