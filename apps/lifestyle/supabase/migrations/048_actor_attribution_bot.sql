-- ─── Migration 048 — Atribución nominativa del BOT (Fase 2c-ii, parte 2/2) ──────
--
-- Activa el GUC `app.actor_type` = 'bot' para los flujos automáticos del bot que hoy
-- caen en 'unknown': cancelar/re-confirmar cita (confirmationResponse + router) y
-- aplicar retraso (late-arrival). Mismo patrón probado con el cron en 047:
-- set_config(..., is_local=true) + mutación ATÓMICOS dentro de una función invocada
-- por `.rpc()` (PostgREST = 1 txn) → el AFTER-trigger de 045 lee el GUC, y al COMMIT
-- se limpia solo (nunca se filtra en el pooler).
--
-- Los flujos del STAFF (panel) NO se tocan: ya se atribuyen por las columnas 023.

-- ─── 1. bot_set_appointment_status — cancelar / re-confirmar ────────────────────
-- Reemplaza los `.update({ status: … }).eq('id', …)` del bot en:
--   · confirmationResponse.ts (cancel 'cancelled', confirm 'confirmed')
--   · router.ts               (cancel 'cancelled' de cita futura)
-- Candado de estado: solo 'cancelled'/'confirmed' (los únicos que el bot escribe por
-- esta vía). No lleva guard de status previo — idéntico al .update() de hoy (que
-- tampoco lo tenía).
CREATE OR REPLACE FUNCTION public.bot_set_appointment_status(
  p_appointment_id uuid,
  p_status         text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('cancelled', 'confirmed') THEN
    RAISE EXCEPTION 'bot_set_appointment_status: estado no permitido: %', p_status;
  END IF;

  PERFORM set_config('app.actor_type', 'bot', true);

  UPDATE public.appointments
     SET status = p_status
   WHERE id = p_appointment_id;
END;
$$;

COMMENT ON FUNCTION public.bot_set_appointment_status(uuid, text) IS
  'Bot: cambia status de cita (cancelled/confirmed) con actor_type=bot (GUC transaction-local). Reemplaza el .update() directo del bot.';

REVOKE ALL ON FUNCTION public.bot_set_appointment_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bot_set_appointment_status(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_set_appointment_status(uuid, text) TO service_role;

-- ─── 2. check_late_arrival_feasibility EXTENDIDO — feasibility + aplicar ────────
-- Antes (2c-i): STABLE, solo-lectura; el bot leía la factibilidad y hacía un
-- `.update(adjusted_starts_at, …)` APARTE → ese UPDATE caía en 'unknown'.
-- Ahora: VOLATILE (necesario para escribir); cuando la cita es FACTIBLE, aplica el
-- ajuste DENTRO de la misma función con set_config('app.actor_type','bot',true) →
-- el audit lo atribuye 'bot', y se cierra el TOCTOU (factibilidad y aplicación en
-- una sola txn). El shape de retorno (TABLE feasible/reason/adjusted_start/
-- adjusted_end/next_appointment_start) es IDÉNTICO → el call-site no cambia su lectura;
-- solo se le quita el `.update()` externo (el RPC ya aplicó).
--   Cambios vs 2c-i: (a) STABLE→VOLATILE, (b) SET search_path, (c) bloque de UPDATE
--   en la rama factible. Toda la lógica de factibilidad queda idéntica.
CREATE OR REPLACE FUNCTION public.check_late_arrival_feasibility(
  p_appointment_id uuid,
  p_delay_minutes  integer
)
RETURNS TABLE(
  feasible               boolean,
  reason                 text,
  adjusted_start         timestamptz,
  adjusted_end           timestamptz,
  next_appointment_start timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_starts_at        TIMESTAMPTZ;
  v_ends_at          TIMESTAMPTZ;
  v_staff_id         UUID;
  v_business_id      UUID;
  v_max_late         INT;
  v_adj_start        TIMESTAMPTZ;
  v_adj_end          TIMESTAMPTZ;
  v_next_appt_start  TIMESTAMPTZ;
  v_duration         INTERVAL;
BEGIN
  -- a. Leer la cita
  SELECT a.starts_at, a.ends_at, a.staff_id, a.business_id
  INTO   v_starts_at, v_ends_at, v_staff_id, v_business_id
  FROM   appointments a
  WHERE  a.id = p_appointment_id;

  IF NOT FOUND THEN
    feasible := FALSE; reason := 'Cita no encontrada';
    adjusted_start := NULL; adjusted_end := NULL; next_appointment_start := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- b. max_late_minutes del negocio
  SELECT b.max_late_minutes INTO v_max_late
  FROM   businesses b WHERE b.id = v_business_id;

  -- c. Tolerancia máxima
  IF p_delay_minutes > v_max_late THEN
    feasible := FALSE;
    reason := 'El retraso excede el máximo permitido de ' || v_max_late || ' minutos';
    adjusted_start := NULL; adjusted_end := NULL; next_appointment_start := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- d-e. Nuevas horas
  v_duration  := v_ends_at - v_starts_at;
  v_adj_start := v_starts_at + (p_delay_minutes * INTERVAL '1 minute');
  v_adj_end   := v_adj_start + v_duration;

  -- f. Siguiente cita del mismo staff ese día
  SELECT a.starts_at INTO v_next_appt_start
  FROM   appointments a
  WHERE  a.staff_id        = v_staff_id
    AND  a.id             <> p_appointment_id
    AND  a.status NOT IN   ('cancelled')
    AND  a.starts_at::DATE = v_starts_at::DATE
    AND  a.starts_at       > v_starts_at
  ORDER  BY a.starts_at
  LIMIT  1;

  -- g. Traslape con la siguiente
  IF v_next_appt_start IS NOT NULL AND v_adj_end > v_next_appt_start THEN
    feasible := FALSE;
    reason := 'El retraso causaria traslape con la siguiente cita';
    adjusted_start := v_adj_start; adjusted_end := v_adj_end;
    next_appointment_start := v_next_appt_start;
    RETURN NEXT; RETURN;
  END IF;

  -- h. Viable → APLICAR el ajuste con atribución 'bot' (2c-ii)
  PERFORM set_config('app.actor_type', 'bot', true);
  UPDATE public.appointments
     SET adjusted_starts_at        = v_adj_start,
         delay_reported_minutes    = p_delay_minutes,
         late_arrival_acknowledged = true
   WHERE id = p_appointment_id;

  feasible := TRUE; reason := 'OK';
  adjusted_start := v_adj_start; adjusted_end := v_adj_end;
  next_appointment_start := v_next_appt_start;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.check_late_arrival_feasibility(uuid, integer) IS
  'Bot late-arrival: evalúa factibilidad Y, si es factible, aplica adjusted_starts_at/delay/ack con actor_type=bot (GUC transaction-local). Extendido en 2c-ii (antes solo-lectura).';
