-- ─── "Quién cobró" deja de inferirse (S9-DIN-02) ─────────────────────────────
-- Hasta acá, la única pista de quién cerró una venta era `modified_by_staff_id`,
-- y esa columna dice **la última persona que TOCÓ la cita**, no la que cobró: la
-- pisa cualquier edición posterior —una nota, un reagendado, un cambio de riel—.
-- Con cinco barberos cobrando en su silla y comisión al 45%, eso no es
-- atribución: es una suposición que se degrada sola con el uso.
--
-- El campo se sella en el TRIGGER y no en la app, y esa es la decisión que
-- importa. Hay tres escritores de `status='completed'` (la server action del
-- mostrador, la del barbero y `PATCH /api/appointments`) y R2 ya había anotado
-- que **no escriben lo mismo**: sólo uno de los tres escribe `completed_at`.
-- Repartir la responsabilidad en tres call-sites garantiza que el cuarto que
-- aparezca nazca olvidándose. En el trigger, ninguno puede.
--
-- Molde: `seal_appointment_price` (migración 049). Mismas tres reglas:
--   · Sella SOLO en la transición a 'completed' (INSERT que nace completada, o
--     UPDATE que cruza desde otro estado).
--   · **Freeze-once**: si ya hay valor, no lo toca. Quién cobró no se corrige con
--     una edición posterior; si hiciera falta, es una operación deliberada de BD.
--   · Si no hay a quién atribuir, queda NULL. Un NULL visible es preferible a un
--     actor plausible: la regla dura de CLAUDE.md, aplicada a la autoría.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS charged_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.appointments.charged_by_staff_id IS
  'Quién CERRÓ el cobro, sellado en la transición a completed y nunca reescrito. Distinto de modified_by_staff_id, que es la última persona que tocó la fila y la pisa cualquier edición posterior. Base de la liquidación por barbero (la raya). NULL = no se pudo atribuir.';

CREATE INDEX IF NOT EXISTS idx_appointments_charged_by
  ON public.appointments (charged_by_staff_id, completed_at)
  WHERE charged_by_staff_id IS NOT NULL;

-- ─── El sello ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seal_appointment_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_guc_actor text := current_setting('app.actor_staff_id', true);
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
  THEN
    -- Quién cobró: la columna de atribución que el call-site ya escribe, y si no,
    -- el GUC que usa el resto del sistema para nombrar al actor. Los dos pueden
    -- ser NULL (una cita cerrada por SQL, por ejemplo) y entonces queda NULL.
    IF NEW.charged_by_staff_id IS NULL THEN
      NEW.charged_by_staff_id := COALESCE(
        NEW.modified_by_staff_id,
        NULLIF(v_guc_actor, '')::uuid
      );
    END IF;

    -- Y CUÁNDO se cobró, por la misma razón por la que se sella el quién: de los
    -- tres escritores de 'completed', **sólo uno escribía `completed_at`**
    -- (`completeAppointment`); el de la vista del barbero y el PATCH lo dejaban
    -- NULL. `completed_at` es la ATRIBUCIÓN del dinero a un día (D6) — una cita
    -- cerrada sin él se evapora del cuadre. Se sella acá para que ninguna vía
    -- pueda olvidarlo, y respeta el valor que el call-site ya haya puesto.
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seal_appointment_charge ON public.appointments;

CREATE TRIGGER trg_seal_appointment_charge
BEFORE INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.seal_appointment_charge();

-- ─── Sin backfill, a propósito ────────────────────────────────────────────────
-- Las citas ya completadas NO se rellenan. `modified_by_staff_id` de una fila
-- vieja es la última persona que la tocó, que es justamente lo que este campo
-- viene a dejar de confundir con "quién cobró"; copiarlo hacia atrás fabricaría
-- la atribución que la columna existe para tener de verdad. Quedan NULL, que es
-- lo que se sabe de ellas. (En el demo, además, son seed.)

REVOKE EXECUTE ON FUNCTION public.seal_appointment_charge() FROM anon, authenticated;
