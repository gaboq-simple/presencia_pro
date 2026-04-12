-- ─── 020_patient_notes.sql ────────────────────────────────────────────────────
-- Notas operativas del médico sobre cada paciente.
-- No son clínicas — son observaciones de gestión: preferencias, recordatorios,
-- logística. Inmutables una vez creadas (sin UPDATE ni DELETE).

CREATE TABLE patient_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT NOT NULL,
  patient_id  UUID NOT NULL REFERENCES patients(id),
  created_by  UUID NOT NULL,              -- auth.uid() del médico
  body        TEXT NOT NULL,              -- texto libre, máx 500 chars
  created_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT body_not_empty CHECK (TRIM(body) <> ''),
  CONSTRAINT body_max_length CHECK (LENGTH(body) <= 500)
);

-- Índice para cargar notas de un paciente rápidamente
CREATE INDEX idx_patient_notes_patient
  ON patient_notes(client_id, patient_id, created_at DESC);

-- RLS — mismo patrón que el resto de tablas
ALTER TABLE patient_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_select_notes"
  ON patient_notes FOR SELECT
  TO authenticated
  USING (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

CREATE POLICY "doctor_insert_notes"
  ON patient_notes FOR INSERT
  TO authenticated
  WITH CHECK (client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id'));

-- Sin UPDATE ni DELETE — las notas son inmutables una vez creadas
-- Esto protege la integridad del registro operativo
