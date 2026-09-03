-- El alta manual deja de fabricar consentimiento (S8-PER-01 · P4).
--
-- `manual_registration` afirmaba que el titular consintió porque una recepcionista
-- tecleó su nombre. El titular no vio nada. Es la vía por la que más rápido crece
-- la base y la de evidencia más débil.
--
-- `pending_notice` dice lo que de verdad pasó: **el dato existe, el
-- consentimiento no** — hasta que el titular vea el aviso. Su primer mensaje al
-- bot lo consolida por la vía que ya existe (`whatsapp_first_message`).
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_consented_via_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_consented_via_check
  CHECK (consented_via IN ('whatsapp_first_message', 'manual_registration', 'import', 'pending_notice'));

COMMENT ON COLUMN public.customers.consented_via IS
  'Canal por el que se obtuvo el consentimiento: whatsapp_first_message (el titular vio el aviso), manual_registration (histórico, previo a S8-PER-01), import (carga masiva) o pending_notice (alta manual: el dato existe, el consentimiento NO — cuenta como NO consentido para todo envío proactivo hasta que el titular vea el aviso).';

-- ─── Nota de procedencia (S9-DATA-01, 2026-09-03) ─────────────────────────────
-- Este archivo se escribió DESPUÉS de que la migración corriera. El 2026-08-19 se
-- aplicó directo a producción sin dejar archivo en el repo, y el hueco recién se
-- vio en la auditoría del 2026-09-03: `find` + `git log -S` sobre `pending_notice`
-- daban cero, mientras el CHECK en prod ya admitía el valor y 39 clientes lo
-- tenían escrito.
--
-- El contenido de arriba NO está reescrito de memoria: es literal el `statements`
-- que el ledger de prod (`supabase_migrations.schema_migrations`) guardó de esa
-- corrida, con su version `20260819030909` puesta en el nombre del archivo. Por
-- eso es idempotente y se puede volver a correr sobre una base que ya lo tenga.
--
-- Lo que el hueco costaba, y es la razón de que esto sea una tarea y no un `touch`:
-- `createAssistantAppointment` escribe `consented_via: 'pending_notice'` en cada
-- alta manual de cliente nuevo, así que una base reconstruida SOLO desde el repo
-- rechazaba ese INSERT — y el llamador descartaba el error, dejando la cita sin
-- cliente y sin aviso. El candado contra la repetición vive en la suite:
-- `tests/schemaChecks.repo.test.ts`.
