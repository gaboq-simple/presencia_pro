-- ─── appointments.arrived_at ─────────────────────────────────────────────────
-- Marca de llegada del cliente (Paso 3B — botón "Llegó" de la card del asistente).
-- arrived_at NULL = no marcado. Registrar la llegada PROTEGE la cita del auto-cancel:
-- tanto el fetch de dispatch-auto-cancel como el guard del RPC mark_appointment_no_show
-- ignoran las citas con arrived_at IS NOT NULL.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz;

COMMENT ON COLUMN public.appointments.arrived_at IS
  'Timestamp en que el staff marcó que el cliente llegó (botón "Llegó" de la card del asistente). NULL = no marcado. Protege de auto-cancel/no_show.';

-- Guard de arrived_at en el RPC de auto-cancel: una cita cuyo cliente ya llegó NO se
-- marca no_show aunque venza el deadline (race-safe respecto al fetch del edge fn).
CREATE OR REPLACE FUNCTION public.mark_appointment_no_show(p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_marked boolean;
BEGIN
  PERFORM set_config('app.actor_type', 'system', true);

  UPDATE public.appointments
     SET status = 'no_show'
   WHERE id = p_appointment_id
     AND status = 'confirmed'
     AND arrived_at IS NULL
  RETURNING true INTO v_marked;

  RETURN COALESCE(v_marked, false);
END;
$function$;
