-- S5-OBS-01: columna metadata para persistir el output de los clasificadores.
-- Aditiva, nullable, sin backfill. Reusada por event_type='classifier_output'.
-- No altera filas existentes ni constraints. Los lectores actuales ignoran la
-- columna (no la seleccionan) y siguen funcionando sin cambios.
ALTER TABLE bot_logs ADD COLUMN metadata JSONB NULL DEFAULT NULL;
