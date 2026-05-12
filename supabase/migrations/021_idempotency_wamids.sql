-- ─── Migration 021 — Idempotencia de WAMIDs ────────────────────────────────
-- Registra cada WAMID (WhatsApp Message ID) procesado para evitar duplicados
-- causados por reintentos de Meta. La tabla es append-only — nunca se
-- actualiza ni se elimina.

-- Campo de auditoría en bot_conversations (último WAMID procesado por conv.)
ALTER TABLE bot_conversations
  ADD COLUMN IF NOT EXISTS last_wamid TEXT;

-- Registro canónico de mensajes procesados
CREATE TABLE IF NOT EXISTS processed_wamids (
  wamid        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  whatsapp_id  TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para queries frecuentes por cliente + paciente
CREATE INDEX IF NOT EXISTS idx_processed_wamids_client_whatsapp
  ON processed_wamids (client_id, whatsapp_id);

-- RLS: mismas reglas que bot_conversations
ALTER TABLE processed_wamids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only"
  ON processed_wamids
  USING (auth.role() = 'service_role');
