-- ─── Migración 029 — Tolerancia de retraso en citas ──────────────────────────
--
-- 1. businesses: max_late_minutes y auto_cancel_after_minutes.
-- 2. appointments: adjusted_starts_at, delay_reported_minutes,
--    late_arrival_acknowledged.
-- 3. check_late_arrival_feasibility(): función SECURITY DEFINER que evalúa
--    si el retraso reportado es viable sin causar traslape con la cita siguiente.

-- ─── 1. businesses: configuración de tolerancia ──────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS max_late_minutes          INT NOT NULL DEFAULT 15
    CONSTRAINT businesses_max_late_minutes_check
      CHECK (max_late_minutes BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS auto_cancel_after_minutes INT NOT NULL DEFAULT 20
    CONSTRAINT businesses_auto_cancel_after_minutes_check
      CHECK (auto_cancel_after_minutes > 0);

COMMENT ON COLUMN businesses.max_late_minutes IS
  'Máximo de minutos de retraso que acepta el negocio. 0 = sin tolerancia. Máx 30.';

COMMENT ON COLUMN businesses.auto_cancel_after_minutes IS
  'Minutos desde starts_at sin llegada antes de cancelar automáticamente la cita.';

-- ─── 2. appointments: campos de retraso ──────────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS adjusted_starts_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_reported_minutes   INT,
  ADD COLUMN IF NOT EXISTS late_arrival_acknowledged BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN appointments.adjusted_starts_at IS
  'Nueva hora de inicio acordada si el cliente reportó retraso. NULL si llegó a tiempo.';

COMMENT ON COLUMN appointments.delay_reported_minutes IS
  'Minutos de retraso que el cliente reportó vía bot. NULL si no reportó.';

COMMENT ON COLUMN appointments.late_arrival_acknowledged IS
  'TRUE si el bot procesó y reconoció el retraso del cliente para esta cita.';

-- ─── 3. check_late_arrival_feasibility() ─────────────────────────────────────
-- Evalúa si un retraso reportado es viable para una cita existente.
--
-- Lógica:
--   a. Lee la cita (starts_at, ends_at, staff_id, business_id).
--   b. Lee max_late_minutes del negocio asociado.
--   c. Si p_delay_minutes > max_late_minutes → inviable (excede tolerancia).
--   d. adjusted_start = starts_at + p_delay_minutes * interval '1 minute'.
--   e. adjusted_end   = adjusted_start + (ends_at - starts_at)  [misma duración].
--   f. Busca la siguiente cita del mismo staff ese día (status != cancelled,
--      starts_at > cita_actual.starts_at).
--   g. Si adjusted_end > next_appt.starts_at → inviable (traslape).
--   h. Si no hay traslape (o no hay cita siguiente) → viable.
--   i. Siempre retorna una fila con todos los campos para que el bot
--      construya la respuesta sin lógica adicional en JS.
--
-- Si el appointment_id no existe → retorna fila única con feasible=false.
--
-- SECURITY DEFINER: permite leer businesses y appointments ignorando las
-- políticas RLS del llamador (mismo patrón que get_available_slots()).

CREATE OR REPLACE FUNCTION check_late_arrival_feasibility(
  p_appointment_id UUID,
  p_delay_minutes  INT
)
RETURNS TABLE(
  feasible                 BOOLEAN,
  reason                   TEXT,
  adjusted_start           TIMESTAMPTZ,
  adjusted_end             TIMESTAMPTZ,
  next_appointment_start   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_starts_at          TIMESTAMPTZ;
  v_ends_at            TIMESTAMPTZ;
  v_staff_id           UUID;
  v_business_id        UUID;
  v_max_late           INT;
  v_adj_start          TIMESTAMPTZ;
  v_adj_end            TIMESTAMPTZ;
  v_next_appt_start    TIMESTAMPTZ;
  v_duration           INTERVAL;
BEGIN
  -- a. Leer la cita
  SELECT a.starts_at, a.ends_at, a.staff_id, a.business_id
  INTO   v_starts_at, v_ends_at, v_staff_id, v_business_id
  FROM   appointments a
  WHERE  a.id = p_appointment_id;

  IF NOT FOUND THEN
    feasible               := FALSE;
    reason                 := 'Cita no encontrada';
    adjusted_start         := NULL;
    adjusted_end           := NULL;
    next_appointment_start := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- b. Leer max_late_minutes del negocio
  SELECT b.max_late_minutes
  INTO   v_max_late
  FROM   businesses b
  WHERE  b.id = v_business_id;

  -- c. Verificar tolerancia máxima
  IF p_delay_minutes > v_max_late THEN
    feasible               := FALSE;
    reason                 := 'El retraso excede el máximo permitido de '
                              || v_max_late || ' minutos';
    adjusted_start         := NULL;
    adjusted_end           := NULL;
    next_appointment_start := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- d-e. Calcular nuevas horas
  v_duration  := v_ends_at - v_starts_at;
  v_adj_start := v_starts_at + (p_delay_minutes * INTERVAL '1 minute');
  v_adj_end   := v_adj_start + v_duration;

  -- f. Buscar siguiente cita del mismo staff ese día
  SELECT a.starts_at
  INTO   v_next_appt_start
  FROM   appointments a
  WHERE  a.staff_id        = v_staff_id
    AND  a.id             <> p_appointment_id
    AND  a.status NOT IN   ('cancelled')
    AND  a.starts_at::DATE = v_starts_at::DATE
    AND  a.starts_at       > v_starts_at
  ORDER  BY a.starts_at
  LIMIT  1;

  -- g. Verificar traslape con siguiente cita
  IF v_next_appt_start IS NOT NULL AND v_adj_end > v_next_appt_start THEN
    feasible               := FALSE;
    reason                 := 'El retraso causaria traslape con la siguiente cita';
    adjusted_start         := v_adj_start;
    adjusted_end           := v_adj_end;
    next_appointment_start := v_next_appt_start;
    RETURN NEXT;
    RETURN;
  END IF;

  -- h. Viable
  feasible               := TRUE;
  reason                 := 'OK';
  adjusted_start         := v_adj_start;
  adjusted_end           := v_adj_end;
  next_appointment_start := v_next_appt_start;
  RETURN NEXT;
END;
$$;
