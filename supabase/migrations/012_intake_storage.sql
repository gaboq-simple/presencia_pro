-- ─── Migration 012 — Intake Signatures Storage ────────────────────────────────
-- Creates the private Supabase Storage bucket for patient signature images.
-- Access is restricted to the service role only — the anon key cannot read or
-- write to this bucket. Signatures are retrieved server-side by the dashboard.

-- ─── Storage bucket ───────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('intake-signatures', 'intake-signatures', false)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS policy — service role only ──────────────────────────────────────────

CREATE POLICY "intake-signatures service role only"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'intake-signatures');
