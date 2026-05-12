-- ─── No-overlap constraint en appointments ────────────────────────────────────
-- Previene que el mismo barbero tenga dos citas solapadas.
--
-- Extensión btree_gist:
--   Requerida para usar operadores de rango (tstzrange) en EXCLUDE constraints.
--   Disponible por defecto en Supabase (Postgres 15+).
--   Si no está habilitada: ejecutar como superusuario antes de esta migración.
--
-- Opción elegida: EXCLUDE USING gist con tstzrange
--   Opción A (UNIQUE simple) descartada: los servicios tienen duraciones variables,
--   por lo que dos citas del mismo barbero a las 10:00 pueden solaparse si una
--   dura 30 min y otra 45 min pero comienzan en momentos distintos.
--   Opción B (tstzrange) cubre todos los casos de solapamiento correctamente.
--
-- Semántica del rango: '[)' (closed-open) — el inicio es inclusivo y el fin
--   exclusivo, lo que permite citas consecutivas sin conflicto.
--
-- La condición WHERE excluye citas canceladas: una cita cancelada no bloquea
--   el slot para nuevas citas.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD CONSTRAINT no_overlapping_appointments
  EXCLUDE USING gist (
    staff_id              WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled'));

-- Índice de soporte para el pre-check en la capa de aplicación.
-- La consulta de pre-check en confirmed.ts es:
--   SELECT 1 FROM appointments
--   WHERE staff_id = $1
--     AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2, $3, '[)')
--     AND status NOT IN ('cancelled')
-- El índice GiST creado por el EXCLUDE ya cubre esta consulta.
