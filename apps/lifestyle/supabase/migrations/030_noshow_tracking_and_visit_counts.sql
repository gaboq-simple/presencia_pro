-- ─── Migration 030: No-show tracking + visit count automation ────────────────
-- Agrega noshow_count e is_flagged a customers.
-- Agrega max_noshows_before_flag a businesses.
-- Backfill desde appointments existentes.
-- Trigger para mantener stats automáticamente en UPDATE de status.

-- ── 1. Nuevas columnas ────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS noshow_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_flagged   BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS max_noshows_before_flag INT NOT NULL DEFAULT 3;

-- ── 2. Backfill noshow_count ──────────────────────────────────────────────────

UPDATE customers c
SET noshow_count = (
  SELECT COUNT(*)
  FROM appointments a
  WHERE a.customer_id = c.id
    AND a.status = 'no_show'
);

-- ── 3. Backfill is_flagged ─────────────────────────────────────────────────────
-- Marca los clientes que ya superan el límite actual de su negocio.

UPDATE customers c
SET is_flagged = TRUE
WHERE c.noshow_count >= (
  SELECT b.max_noshows_before_flag
  FROM businesses b
  WHERE b.id = c.business_id
);

-- ── 4. Trigger function ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_visit_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_threshold INT;
BEGIN
  -- Solo actuar cuando customer_id está presente
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cita completada: incrementar visit_count y actualizar last_visit
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    UPDATE customers
    SET
      visit_count = visit_count + 1,
      last_visit  = NOW()
    WHERE id = NEW.customer_id;
  END IF;

  -- No-show: incrementar noshow_count y evaluar flag
  IF NEW.status = 'no_show' AND OLD.status <> 'no_show' THEN
    UPDATE customers
    SET noshow_count = noshow_count + 1
    WHERE id = NEW.customer_id;

    -- Leer umbral del negocio
    SELECT max_noshows_before_flag
    INTO v_threshold
    FROM businesses
    WHERE id = NEW.business_id;

    -- Flaggear si supera el umbral
    UPDATE customers
    SET is_flagged = TRUE
    WHERE id = NEW.customer_id
      AND noshow_count >= v_threshold;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Trigger ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_update_visit_stats ON appointments;

CREATE TRIGGER trg_update_visit_stats
AFTER UPDATE OF status ON appointments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_visit_stats();
