-- Migration 042: make idx_bot_conversations_business_phone UNIQUE
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE
--   La migración 001 creó idx_bot_conversations_business_phone como índice NO
--   único sobre (business_id, customer_phone). El handler del bot persiste el
--   estado de la conversación con un UPSERT (INSERT ... ON CONFLICT
--   (business_id, customer_phone) DO UPDATE). Postgres exige que la columna o
--   expresión de un ON CONFLICT tenga un índice UNIQUE (o una constraint única);
--   con el índice no-único el upsert falla con
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification".
--
--   En la base viva ya se aplicó el fix a mano (DROP + CREATE UNIQUE INDEX).
--   Esta migración deja el repo reflejando esa realidad para que una DB nueva
--   quede correcta desde el inicio.
--
-- ESTRATEGIA
--   Idempotente: DROP IF EXISTS del índice no-único y recreación como UNIQUE.
--   Mismo nombre y mismas columnas que el original, solo cambia la unicidad.

DROP INDEX IF EXISTS idx_bot_conversations_business_phone;

CREATE UNIQUE INDEX idx_bot_conversations_business_phone
  ON bot_conversations (business_id, customer_phone);
