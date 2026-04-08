-- Migration 014: patient_photos + storage bucket
-- Stores before/after treatment photos linked to a specific appointment.
-- Photos are private — served via signed URLs, never public.
-- The storage bucket uses service_role only — no client-side uploads.

CREATE TABLE patient_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  patient_id      UUID REFERENCES patients(id),
  appointment_id  UUID REFERENCES appointments(id),
  type            TEXT NOT NULL CHECK (type IN ('before', 'after')),
  storage_path    TEXT NOT NULL,   -- path in Supabase Storage
  url             TEXT NOT NULL,   -- signed URL (refreshed on read)
  notes           TEXT,            -- optional note from the doctor
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patient_photos_patient
ON patient_photos (client_id, patient_id, created_at DESC);

CREATE INDEX idx_patient_photos_appointment
ON patient_photos (appointment_id);

-- ─── Storage bucket ───────────────────────────────────────────────────────────
-- Private bucket — no public access. Only service_role can read/write.

INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-photos', 'patient-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Only service role may access objects in this bucket.
-- Client-side code never calls Storage directly — it goes through API routes.
CREATE POLICY "service role only"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'patient-photos');
