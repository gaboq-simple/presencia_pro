-- ─── 019_whatsapp_id.sql ───────────────────────────────────────────────────────
-- Introduce whatsapp_id como identificador canónico de pacientes en el sistema.
--
-- Motivación:
--   1. WhatsApp entrega el mismo número en formatos distintos (con/sin +, con/sin espacios).
--      Con phone como UNIQUE se crean pacientes duplicados.
--   2. phone era NOT NULL pero el webhook ya tiene el identificador desde el primer mensaje.
--      Pedirlo en el intake es redundante.
--
-- Estrategia:
--   - whatsapp_id = phone normalizado (sin '+', sin espacios)
--   - phone sigue existiendo como dato del paciente — solo deja de ser el identificador
--   - UNIQUE se mueve a (client_id, whatsapp_id)
--   - phone pasa a ser nullable

-- ─── patients ──────────────────────────────────────────────────────────────────

-- 1. Agregar columna whatsapp_id (sin constraint todavía — los datos existentes son NULL)
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS whatsapp_id TEXT;

-- 2. Poblar whatsapp_id desde phone para filas existentes
--    Normalización: quitar '+' inicial y espacios en blanco
UPDATE patients
SET whatsapp_id = REGEXP_REPLACE(
  REGEXP_REPLACE(phone, '^\+', ''),
  '\s', '', 'g'
)
WHERE whatsapp_id IS NULL
  AND phone IS NOT NULL;

-- 3. Constraint único: (client_id, whatsapp_id)
--    Reemplaza el antiguo UNIQUE(client_id, phone)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patients_whatsapp_id_unique'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_whatsapp_id_unique
      UNIQUE(client_id, whatsapp_id);
  END IF;
END $$;

-- 4. phone pasa a ser nullable — ya no es el identificador del sistema
ALTER TABLE patients
  ALTER COLUMN phone DROP NOT NULL;

-- 5. Índice para búsqueda rápida por whatsapp_id
CREATE INDEX IF NOT EXISTS idx_patients_whatsapp_id
  ON patients(client_id, whatsapp_id);

-- ─── bot_conversations ─────────────────────────────────────────────────────────

-- 6. Agregar whatsapp_id a bot_conversations para consistencia con patients
ALTER TABLE bot_conversations
  ADD COLUMN IF NOT EXISTS whatsapp_id TEXT;

-- 7. Poblar whatsapp_id desde patient_phone para filas existentes
UPDATE bot_conversations
SET whatsapp_id = REGEXP_REPLACE(
  REGEXP_REPLACE(patient_phone, '^\+', ''),
  '\s', '', 'g'
)
WHERE whatsapp_id IS NULL
  AND patient_phone IS NOT NULL;

-- 8. Índice para búsqueda de conversación por whatsapp_id
CREATE INDEX IF NOT EXISTS idx_bot_conversations_whatsapp_id
  ON bot_conversations(client_id, whatsapp_id);

-- ─── scheduled_notifications ──────────────────────────────────────────────────
-- patient_phone se mantiene por compatibilidad con datos existentes.
-- whatsapp_id se agrega como columna paralela — el dispatcher usará la que esté presente.

ALTER TABLE scheduled_notifications
  ADD COLUMN IF NOT EXISTS whatsapp_id TEXT;

UPDATE scheduled_notifications
SET whatsapp_id = REGEXP_REPLACE(
  REGEXP_REPLACE(patient_phone, '^\+', ''),
  '\s', '', 'g'
)
WHERE whatsapp_id IS NULL
  AND patient_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_whatsapp_id
  ON scheduled_notifications(client_id, whatsapp_id);
