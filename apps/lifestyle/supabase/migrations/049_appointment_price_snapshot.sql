-- ─── Migration 049: Snapshot de precio en appointments ───────────────────────
-- Precondición de la capa de dinero (vista del Dueño).
--
-- Problema: la vista del Dueño calcula ingresos joineando
--   appointments → services.price EN VIVO. appointments no guarda el precio.
-- Consecuencia: si el dueño edita el precio de un servicio, TODOS los ingresos
--   históricos se reescriben solos (marzo cambia en abril). Letal para una vista
--   cuyo diferenciador es "números creíbles/auditables".
-- Fix: sellar el precio en la cita AL COMPLETARSE, para congelar la historia.
--
-- Cobertura (Paso 1): todos los caminos a 'completed' son UPDATE de status
--   (completeAppointment, updateAppointmentStatus, updateAppointmentStatusAsBarber,
--    PATCH /api/appointments). El bot nunca completa. Ningún path inserta
--   'completed' hoy, pero el enum lo permite → el trigger cubre INSERT también
--   (belt-and-suspenders contra un futuro walk-in-nace-completado).

-- ── 1. Columna ────────────────────────────────────────────────────────────────
-- NULLABLE a propósito: walk-ins sin service_id y filas históricas quedan NULL.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS price_charged NUMERIC(10,2);

COMMENT ON COLUMN appointments.price_charged IS
  'Precio sellado desde services.price al completarse la cita. Congela la historia: '
  'editar el precio del servicio no reescribe ingresos ya cerrados. NULL para filas '
  'previas al sello, o citas sin service_id (walk-ins).';

-- ── 2. Función de sello ───────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE → muta NEW.price_charged en la misma fila (sin UPDATE
-- separado, sin recursión). Espeja la detección de transición de update_visit_stats.

CREATE OR REPLACE FUNCTION seal_appointment_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Sellar SOLO en la transición a 'completed', con service_id presente, y solo
  -- si aún no hay precio sellado (freeze-once: nunca reescribe un precio ya cerrado).
  --   · INSERT: no hay OLD → cualquier fila que nazca 'completed' se sella.
  --   · UPDATE: solo cuando cruza a 'completed' desde otro estado.
  IF NEW.status = 'completed'
     AND NEW.service_id IS NOT NULL
     AND NEW.price_charged IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
  THEN
    -- services.price es NOT NULL → snapshot directo del precio exacto.
    -- (price_min/max son solo para el texto del bot; price es el cobrado.)
    SELECT price
      INTO NEW.price_charged
      FROM services
     WHERE id = NEW.service_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Trigger ────────────────────────────────────────────────────────────────
-- UPDATE OF status: solo dispara cuando el UPDATE toca la columna status
-- (los 4 call-sites de completado la incluyen). INSERT: dispara siempre.

DROP TRIGGER IF EXISTS trg_seal_appointment_price ON appointments;

CREATE TRIGGER trg_seal_appointment_price
BEFORE INSERT OR UPDATE OF status ON appointments
FOR EACH ROW
EXECUTE FUNCTION seal_appointment_price();

-- ── 4. Backfill de completadas existentes ─────────────────────────────────────
-- ⚠️ APROXIMADO: usa services.price ACTUAL, NO el precio histórico real
-- (que no se conoce). Aceptable SOLO porque es demo/seed, cero clientes reales;
-- sirve para que la capa de dinero tenga algo que mostrar. En prod real las
-- filas previas al sello quedarían NULL.

UPDATE appointments a
SET price_charged = s.price
FROM services s
WHERE a.service_id = s.id
  AND a.status = 'completed'
  AND a.price_charged IS NULL;
