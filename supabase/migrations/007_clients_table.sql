-- ─── 007_clients_table.sql ────────────────────────────────────────────────────
-- Registro de clientes activos del sistema.
-- Usado por las Edge Functions (cron) para saber a qué instancias servir.
-- Un cliente activo = active = TRUE.

CREATE TABLE clients (
  id          TEXT PRIMARY KEY,                                -- 'dra-quevedo', nunca cambia
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  timezone    TEXT NOT NULL DEFAULT 'America/Mexico_City',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Cliente inicial ───────────────────────────────────────────────────────────
INSERT INTO clients (id, name, domain, timezone)
VALUES (
  'dra-quevedo',
  'Dra. Jaasiel Quevedo',
  'drajaasielquevedo.com',
  'America/Mexico_City'
);
