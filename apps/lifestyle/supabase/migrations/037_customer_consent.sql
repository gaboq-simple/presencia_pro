-- ─── Migration 037: Customer consent fields (LFPDPPP Art. 8) ──────────────────
-- Agrega campos de consentimiento a la tabla customers.
-- NO hace backfill retroactivo — clientes previos quedan con consent_at NULL.
-- El valor 'manual_registration' se usa cuando staff crea al cliente desde panel.
-- El valor 'whatsapp_first_message' se usa cuando el bot crea al cliente nuevo.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS consent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consented_via    TEXT
    CHECK (consented_via IN ('whatsapp_first_message', 'manual_registration', 'import')),
  ADD COLUMN IF NOT EXISTS consent_message_id TEXT;

COMMENT ON COLUMN public.customers.consent_at IS
  'Timestamp en que el titular otorgó consentimiento. NULL = cliente previo a esta feature (consentimiento no capturado). LFPDPPP Art. 8.';

COMMENT ON COLUMN public.customers.consented_via IS
  'Canal por el que se obtuvo el consentimiento: whatsapp_first_message (bot), manual_registration (staff panel), import (carga masiva).';

COMMENT ON COLUMN public.customers.consent_message_id IS
  'ID del mensaje de WhatsApp donde el cliente recibió el aviso de privacidad. Evidencia para LFPDPPP. Solo aplica cuando consented_via = ''whatsapp_first_message''.';
