-- ─── Migration 027: Bot ↔ Human Handoff ───────────────────────────────────────
-- Agrega soporte de handoff al sistema de conversaciones del bot.
--
-- Cambios:
--   1. bot_conversations: tres columnas nuevas (session_mode, taken_by, taken_at)
--   2. Nueva tabla conversation_messages: historial de mensajes durante handoff
--
-- Comportamiento:
--   session_mode = 'bot'    → FSM del engine procesa el mensaje (default)
--   session_mode = 'human'  → el staff tiene control; los mensajes entrantes
--                             se persisten en conversation_messages pero NO
--                             pasan al FSM. Auto-release a 'bot' si taken_at
--                             supera 30 minutos sin actividad del staff.
--   session_mode = 'paused' → mensajes entrantes se persisten pero no se
--                             responden. Sin auto-release (pausa intencional).

-- ─── 1. ALTER bot_conversations ───────────────────────────────────────────────

ALTER TABLE bot_conversations
  ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'bot'
    CHECK (session_mode IN ('bot', 'human', 'paused')),
  ADD COLUMN taken_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN taken_at TIMESTAMPTZ;

-- Índice para el gate: lookup por (business_id, customer_phone) ya existe
-- en idx_bot_conversations_business_phone — no se necesita índice adicional.

-- ─── 2. CREATE conversation_messages ──────────────────────────────────────────
-- Historial de mensajes durante sesiones de handoff (session_mode != 'bot').
-- También persiste mensajes salientes enviados por staff desde el panel.
--
-- sent_by:
--   'customer' → mensaje entrante del cliente (direction='inbound')
--   'bot'      → mensaje saliente del FSM    (direction='outbound')
--   'human'    → mensaje saliente del staff  (direction='outbound')

CREATE TABLE conversation_messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone TEXT        NOT NULL,
  direction      TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body           TEXT        NOT NULL,
  sent_by        TEXT        NOT NULL CHECK (sent_by IN ('bot', 'human', 'customer')),
  staff_id       UUID        REFERENCES staff(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El query más frecuente: últimos N mensajes de una conversación específica
CREATE INDEX idx_conv_messages_business_phone
  ON conversation_messages (business_id, customer_phone, created_at DESC);
