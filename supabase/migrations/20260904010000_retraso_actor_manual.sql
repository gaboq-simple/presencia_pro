-- ─── El retraso deja de ser exclusivo del bot (S9-OPS-10) ─────────────────────
-- `check_late_arrival_feasibility` es la AUTORIDAD del retraso: valida contra
-- `businesses.max_late_minutes`, comprueba que no se traslape con la cita
-- siguiente, y —cuando es factible— aplica las tres columnas
-- (`adjusted_starts_at`, `delay_reported_minutes`, `late_arrival_acknowledged`)
-- DENTRO de la misma transacción. Esa forma es deliberada: sin ella, un UPDATE
-- externo caía en `actor_type='unknown'` en el audit (residuo de 2c-ii).
--
-- El problema: la función clavaba `set_config('app.actor_type', 'bot', true)`.
-- O sea que el ÚNICO escritor posible era el bot — y por eso, sin bot, un cliente
-- que avisa que llega tarde no tenía dónde ser registrado: a los
-- `auto_cancel_after_minutes` el cron lo marcaba ausente igual. Avisar EMPEORABA
-- su situación.
--
-- El arreglo es un parámetro, no una función nueva: `p_actor_staff_id`. NULL (el
-- default) = el bot, y la llamada del bot no cambia ni una letra. Con un uuid =
-- una persona del mostrador, y entonces el audit dice `staff` con su id en vez de
-- afirmar que lo hizo el bot. Firmar como 'bot' un gesto humano sería fabricar
-- evidencia sobre QUIÉN actuó, que es la misma clase de mentira que la regla dura
-- de CLAUDE.md prohíbe sobre los hechos.
--
-- Se hace con DROP + CREATE y no con CREATE OR REPLACE: agregar un parámetro
-- cambia la firma, así que un REPLACE dejaría DOS funciones conviviendo.

DROP FUNCTION IF EXISTS public.check_late_arrival_feasibility(uuid, integer);

CREATE FUNCTION public.check_late_arrival_feasibility(
  p_appointment_id uuid,
  p_delay_minutes  integer,
  p_actor_staff_id uuid DEFAULT NULL
)
RETURNS TABLE(
  feasible               boolean,
  reason                 text,
  adjusted_start         timestamp with time zone,
  adjusted_end           timestamp with time zone,
  next_appointment_start timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT a.starts_at, a.ends_at, a.staff_id, a.business_id
  INTO   v_starts_at, v_ends_at, v_staff_id, v_business_id
  FROM   appointments a
  WHERE  a.id = p_appointment_id;

  IF NOT FOUND THEN
    feasible := FALSE; reason := 'Cita no encontrada';
    adjusted_start := NULL; adjusted_end := NULL; next_appointment_start := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT b.max_late_minutes INTO v_max_late
  FROM   businesses b WHERE b.id = v_business_id;

  IF p_delay_minutes > v_max_late THEN
    feasible := FALSE;
    reason := 'El retraso excede el máximo permitido de ' || v_max_late || ' minutos';
    adjusted_start := NULL; adjusted_end := NULL; next_appointment_start := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_duration  := v_ends_at - v_starts_at;
  v_adj_start := v_starts_at + (p_delay_minutes * INTERVAL '1 minute');
  v_adj_end   := v_adj_start + v_duration;

  SELECT a.starts_at INTO v_next_appt_start
  FROM   appointments a
  WHERE  a.staff_id        = v_staff_id
    AND  a.id             <> p_appointment_id
    AND  a.status NOT IN   ('cancelled')
    AND  a.starts_at::DATE = v_starts_at::DATE
    AND  a.starts_at       > v_starts_at
  ORDER  BY a.starts_at
  LIMIT  1;

  IF v_next_appt_start IS NOT NULL AND v_adj_end > v_next_appt_start THEN
    feasible := FALSE;
    reason := 'El retraso causaria traslape con la siguiente cita';
    adjusted_start := v_adj_start; adjusted_end := v_adj_end;
    next_appointment_start := v_next_appt_start;
    RETURN NEXT; RETURN;
  END IF;

  -- La ÚNICA diferencia con la versión anterior: quién queda firmando.
  IF p_actor_staff_id IS NULL THEN
    PERFORM set_config('app.actor_type', 'bot', true);
  ELSE
    PERFORM set_config('app.actor_type', 'staff', true);
    PERFORM set_config('app.actor_staff_id', p_actor_staff_id::text, true);
  END IF;

  UPDATE public.appointments
     SET adjusted_starts_at        = v_adj_start,
         delay_reported_minutes    = p_delay_minutes,
         late_arrival_acknowledged = true,
         -- Cuando lo registra una persona, la columna de 023 también lo dice: el
         -- GUC vive una transacción, la columna se queda.
         modified_by_staff_id      = COALESCE(p_actor_staff_id, modified_by_staff_id),
         modified_at               = CASE WHEN p_actor_staff_id IS NULL THEN modified_at ELSE now() END
   WHERE id = p_appointment_id;

  feasible := TRUE; reason := 'OK';
  adjusted_start := v_adj_start; adjusted_end := v_adj_end;
  next_appointment_start := v_next_appt_start;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.check_late_arrival_feasibility(uuid, integer, uuid) IS
  'Autoridad del retraso: valida contra max_late_minutes y el traslape, y aplica las tres columnas en la misma txn. p_actor_staff_id NULL = el bot; con uuid = una persona del mostrador (el audit firma staff, no bot).';

-- ─── Higiene que venía con el objeto (advisor de Supabase) ───────────────────
-- Es `SECURITY DEFINER` y MUTA citas, y estaba EXECUTE para `anon` y
-- `authenticated`, o sea alcanzable por `/rest/v1/rpc/` desde cualquier browser.
-- El UUID de una cita no se adivina, así que no había explotación práctica — pero
-- una función que corre con los permisos del dueño y mueve la hora de una cita no
-- tiene por qué estar publicada. Sus dos llamadores (el bot y la server action)
-- hablan por `service_role`, que no se ve afectado.
REVOKE EXECUTE ON FUNCTION public.check_late_arrival_feasibility(uuid, integer, uuid) FROM anon, authenticated;
