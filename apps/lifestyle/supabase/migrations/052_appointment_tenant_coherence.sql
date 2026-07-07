-- ─── Migration 046: coherencia de tenant en appointments (MT-04) ───────────────
-- Las FK de appointments (staff_id, service_id, customer_id) validan EXISTENCIA
-- pero no PERTENENCIA al mismo negocio → nada impedía una cita "Frankenstein"
-- (cita del negocio A con staff/service/customer del negocio B). Con multi-tenant
-- eso es una fuga de aislamiento silenciosa (invisible con 1 negocio).
--
-- Fix: trigger BEFORE INSERT OR UPDATE que valida que el business_id de las filas
-- referenciadas coincida con appointments.business_id.
--
-- Por qué trigger y no FK compuesta (id, business_id): customer_id es
-- ON DELETE SET NULL y appointments.business_id es NOT NULL → una FK compuesta
-- con SET NULL intentaría nular business_id y violaría el NOT NULL. El trigger es
-- uniforme, maneja los nullables (service_id/customer_id) y no toca el borrado.
--
-- Notas:
--   · search_path fijo ('') + objetos full-qualified → inmune a hijacking.
--   · NO SECURITY DEFINER: los inserts reales son service_role (lee todo).
--   · Cubre INSERT y UPDATE (mudar un *_id a otro tenant también se bloquea).
--   · Solo bloquea el cross-tenant; la NO-existencia la maneja la FK.
-- Aplicada al remoto vía MCP; este archivo queda como registro.

CREATE OR REPLACE FUNCTION public.check_appointment_tenant_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bid uuid;
BEGIN
  -- staff_id (NOT NULL en appointments)
  SELECT business_id INTO v_bid FROM public.staff WHERE id = NEW.staff_id;
  IF v_bid IS NOT NULL AND v_bid <> NEW.business_id THEN
    RAISE EXCEPTION
      'appointment tenant mismatch: staff % es del negocio %, la cita es del negocio %',
      NEW.staff_id, v_bid, NEW.business_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- service_id (nullable)
  IF NEW.service_id IS NOT NULL THEN
    SELECT business_id INTO v_bid FROM public.services WHERE id = NEW.service_id;
    IF v_bid IS NOT NULL AND v_bid <> NEW.business_id THEN
      RAISE EXCEPTION
        'appointment tenant mismatch: service % es del negocio %, la cita es del negocio %',
        NEW.service_id, v_bid, NEW.business_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- customer_id (nullable)
  IF NEW.customer_id IS NOT NULL THEN
    SELECT business_id INTO v_bid FROM public.customers WHERE id = NEW.customer_id;
    IF v_bid IS NOT NULL AND v_bid <> NEW.business_id THEN
      RAISE EXCEPTION
        'appointment tenant mismatch: customer % es del negocio %, la cita es del negocio %',
        NEW.customer_id, v_bid, NEW.business_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointment_tenant_coherence ON public.appointments;
CREATE TRIGGER trg_appointment_tenant_coherence
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_tenant_coherence();
