-- ─── Migration 044: Controles de creación de citas (Fase 2a sistema de control) ──
-- Additive-only. Negocios existentes obtienen los defaults permisivos y siguen
-- funcionando exactamente como hoy.
--
-- Dos controles configurables por negocio para acotar el inflado de agenda por
-- barberos en /staff/gestion (createAssistantAppointment):
--
--   · max_appointments_per_staff_per_day — tope SUAVE de citas por barbero por día.
--       Solo se aplica cuando el actor es role='barber'. Frena el inflado GROSERO
--       (decenas de citas falsas); NO frena el inflado fino (ej. 19/día) — eso lo
--       cubre el audit trail visible (fase posterior). Es complemento, no reemplazo.
--       Default 20: ningún barbero honesto lo alcanza out-of-the-box.
--
--   · require_customer_phone — política de calidad de dato. Cuando TRUE, cualquier
--       alta manual (barbero O recepcionista) exige teléfono del cliente. Default
--       FALSE para preservar el walk-in legítimo con solo-nombre.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS max_appointments_per_staff_per_day INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS require_customer_phone BOOLEAN NOT NULL DEFAULT FALSE;

-- El tope debe ser positivo (0 bloquearía toda creación del barbero).
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_max_appts_per_staff_per_day_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_max_appts_per_staff_per_day_check
  CHECK (max_appointments_per_staff_per_day > 0);

COMMENT ON COLUMN public.businesses.max_appointments_per_staff_per_day IS
  'Tope suave de citas que un barbero puede tener asignadas por día al crear desde gestión. Solo aplica a role=barber. Default 20. Frena inflado grosero, no fino (eso es el audit visible).';

COMMENT ON COLUMN public.businesses.require_customer_phone IS
  'Si TRUE, el alta manual de cita (cualquier rol) exige teléfono del cliente. Default FALSE (preserva walk-in con solo-nombre).';
