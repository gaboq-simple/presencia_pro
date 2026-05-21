-- ─── Migración 025 — Extensiones de horario de staff ─────────────────────────
-- Extiende staff_availability con break y flag activo.
-- Agrega staff_schedule_exceptions para overrides de fecha específica.
-- Agrega get_available_slots() para generación de slots disponibles.
--
-- Convenciones mantenidas:
--   - day_of_week: 0=domingo, 6=sábado (JS/ISO, igual que schema inicial)
--   - Prefijo de políticas: ls_ (lifestyle)
--   - Prefijo de índices: idx_[tabla]_[columnas]
--   - business_id en tablas operativas para RLS directo

-- ─── 1. Extender staff_availability ──────────────────────────────────────────
-- break_start / break_end: hora de comida o descanso dentro del turno.
-- Ambas deben ser NULL o ambas NOT NULL (check constraint lo garantiza).
-- is_active: permite desactivar un día sin borrarlo (ej. vacaciones recurrentes).
-- Filas existentes quedan con is_active = TRUE y sin break (NULL/NULL).

ALTER TABLE staff_availability
  ADD COLUMN break_start TIME,
  ADD COLUMN break_end   TIME,
  ADD COLUMN is_active   BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE staff_availability
  ADD CONSTRAINT staff_availability_break_check CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR
    (break_start IS NOT NULL AND break_end IS NOT NULL AND break_end > break_start)
  );

-- ─── 2. staff_schedule_exceptions ────────────────────────────────────────────
-- Overrides de fecha específica: días libres, horario especial, festivos.
-- available = FALSE → barbero no trabaja ese día (retorna slots vacíos).
-- available = TRUE con start_time/end_time → horario especial ese día.
-- available = TRUE sin start_time/end_time → usa el horario base normal.
-- business_id desnormalizado para RLS eficiente (evita JOIN en policies).

CREATE TABLE staff_schedule_exceptions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       UUID        NOT NULL REFERENCES staff(id)       ON DELETE CASCADE,
  business_id    UUID        NOT NULL REFERENCES businesses(id)  ON DELETE CASCADE,
  exception_date DATE        NOT NULL,
  available      BOOLEAN     NOT NULL DEFAULT FALSE,
  start_time     TIME,
  end_time       TIME,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, exception_date),
  CONSTRAINT staff_schedule_exceptions_times_check CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

-- ─── RLS: staff_schedule_exceptions ──────────────────────────────────────────
-- Mismo patrón que staff_availability en 002_rls_policies.sql.

ALTER TABLE staff_schedule_exceptions ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier staff del mismo negocio puede ver disponibilidad cruzada
CREATE POLICY "ls_staff_schedule_exceptions_select"
  ON staff_schedule_exceptions FOR SELECT
  USING (business_id = ls_staff_business_id());

-- Admin: gestión completa sobre cualquier staff del negocio
CREATE POLICY "ls_staff_schedule_exceptions_admin"
  ON staff_schedule_exceptions FOR ALL
  USING (
    ls_staff_role() = 'admin'
    AND business_id = ls_staff_business_id()
  );

-- Barber/assistant: solo gestiona sus propias excepciones
CREATE POLICY "ls_staff_schedule_exceptions_self"
  ON staff_schedule_exceptions FOR ALL
  USING (staff_id = ls_staff_id());

-- Índice: lookup frecuente por staff + fecha (bot y dashboard)
CREATE INDEX idx_staff_schedule_exceptions_staff_date
  ON staff_schedule_exceptions (staff_id, exception_date);

-- ─── 3. get_available_slots() ─────────────────────────────────────────────────
-- Genera slots de TIME disponibles para un barbero en una fecha dada.
--
-- Lógica:
--   1. Lee horario base de staff_availability para el día de semana.
--   2. Busca excepción en staff_schedule_exceptions para la fecha exacta.
--   3. Si excepción available=false → retorna vacío.
--   4. Si excepción tiene horario especial → lo usa en lugar del base (sin break).
--   5. Itera en intervalos de 15 min desde inicio hasta fin del turno.
--   6. Descarta slots que se traslapen con el break.
--   7. Descarta slots que se traslapen con citas existentes (status != cancelled).
--   8. Solo retorna slots donde cabe la duración completa del servicio.
--
-- Nota de timezone: los appointments se almacenan como TIMESTAMPTZ.
--   La comparación appointments.starts_at::DATE = p_date funciona correctamente
--   cuando la sesión de Postgres tiene el mismo timezone que el negocio.
--   Para uso desde el bot (service_role), asegurarse de hacer
--   SET LOCAL timezone = '<IANA tz del negocio>' antes de llamar a esta función.
--
-- SECURITY DEFINER: permite leer staff_availability, staff_schedule_exceptions
--   y appointments sin que las políticas RLS del llamador interfieran.
--   Es el mismo patrón de ls_staff_business_id() y ls_staff_role().

CREATE OR REPLACE FUNCTION get_available_slots(
  p_staff_id         UUID,
  p_date             DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_day_of_week   SMALLINT;
  v_work_start    TIME;
  v_work_end      TIME;
  v_break_start   TIME;
  v_break_end     TIME;
  v_slot          TIME;
  v_slot_end      TIME;
  v_exc_available BOOLEAN;
  v_exc_start     TIME;
  v_exc_end       TIME;
BEGIN
  -- EXTRACT(DOW FROM date): 0=domingo, 1=lunes ... 6=sábado — igual que JS
  v_day_of_week := EXTRACT(DOW FROM p_date)::SMALLINT;

  -- 1. Horario base para ese día de semana
  SELECT sa.start_time, sa.end_time, sa.break_start, sa.break_end
  INTO   v_work_start, v_work_end, v_break_start, v_break_end
  FROM   staff_availability sa
  WHERE  sa.staff_id    = p_staff_id
    AND  sa.day_of_week = v_day_of_week
    AND  sa.is_active   = TRUE;

  IF NOT FOUND THEN
    RETURN; -- No trabaja ese día de semana
  END IF;

  -- 2. Excepción para la fecha exacta
  SELECT sse.available, sse.start_time, sse.end_time
  INTO   v_exc_available, v_exc_start, v_exc_end
  FROM   staff_schedule_exceptions sse
  WHERE  sse.staff_id       = p_staff_id
    AND  sse.exception_date = p_date;

  IF FOUND THEN
    -- 3. No disponible ese día específico
    IF NOT v_exc_available THEN
      RETURN;
    END IF;
    -- 4. Horario especial: reemplaza base y elimina break
    IF v_exc_start IS NOT NULL THEN
      v_work_start  := v_exc_start;
      v_work_end    := v_exc_end;
      v_break_start := NULL;
      v_break_end   := NULL;
    END IF;
  END IF;

  -- 5-8. Generar slots en intervalos de 15 min
  v_slot := v_work_start;

  LOOP
    v_slot_end := v_slot + (p_duration_minutes * INTERVAL '1 minute');

    -- El slot completo debe caber dentro del turno
    EXIT WHEN v_slot_end > v_work_end;

    -- 6. Descartar slots que se traslapen con el break
    IF v_break_start IS NOT NULL
       AND v_slot     < v_break_end
       AND v_slot_end > v_break_start
    THEN
      v_slot := v_slot + INTERVAL '15 minutes';
      CONTINUE;
    END IF;

    -- 7. Descartar slots que se traslapen con citas existentes
    IF EXISTS (
      SELECT 1
      FROM   appointments a
      WHERE  a.staff_id         = p_staff_id
        AND  a.starts_at::DATE  = p_date
        AND  a.status NOT IN ('cancelled')
        AND  a.starts_at::TIME  < v_slot_end
        AND  a.ends_at::TIME    > v_slot
    ) THEN
      v_slot := v_slot + INTERVAL '15 minutes';
      CONTINUE;
    END IF;

    -- 8. Slot válido
    slot_start := v_slot;
    slot_end   := v_slot_end;
    RETURN NEXT;

    v_slot := v_slot + INTERVAL '15 minutes';
  END LOOP;
END;
$$;
