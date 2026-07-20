-- Paso 7 (rediseño barbero) — propinas, privadas del dueño.
--
-- La propina es un dato del BARBERO, no del local. Vive en tabla APARTE (no como
-- columna de appointments) a propósito — el aislamiento es estructural:
--   1) El Realtime del dueño (DashboardRealtimeProvider) escucha postgres_changes
--      sobre appointments y recibe la fila COMPLETA en payload.new: una columna
--      tip_amount ahí viajaría a su browser en cada update. Esta tabla no emite nada.
--   2) Las queries del dueño/asistente leen appointments — no pueden fugar lo que
--      no está en la tabla que leen.
--   3) Un lint (apps/lifestyle/eslint.config.mjs) prohíbe referenciar
--      appointment_tips fuera del módulo barbero; el repo-check
--      tests/tipsPrivacy.test.ts lo respalda en la malla de tests.
--
-- Semántica: sin fila = sin propina registrada; amount = 0 = propina de $0.
-- Unidad: NUMERIC(10,2), espejo de price_charged / services.price (pesos.centavos).
--
-- 🔴 PRIVACIDAD: NO adjuntar a esta tabla ningún trigger de audit admin-legible
-- (appointment_audit / management_audit son legibles por admin — mig. 045/053).
-- El monto no debe aparecer en ningún registro que el dueño pueda leer.

CREATE TABLE IF NOT EXISTS appointment_tips (
  appointment_id uuid PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount         numeric(10, 2) NOT NULL CHECK (amount >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE appointment_tips IS
  'Propina registrada por el barbero al cerrar una cita. PRIVADA del dueño/asistente: '
  'solo el write/read barbero-scoped la toca (setAppointmentTip / getBarberDayAppointments). '
  'Sin fila = sin registrar; amount 0 = propina de $0. No adjuntar triggers de audit admin-legibles.';

-- RLS deny-all a propósito: RLS habilitada y CERO policies. El tráfico legítimo va
-- por service_role (que la bypasea) + gate de sesión en el server action. Ninguna
-- sesión de browser (anon/authenticated — incluido el dueño logueado por email)
-- puede leerla vía PostgREST ni recibirla vía Realtime. Si a futuro se agrega una
-- policy, SOLO staff-propio — JAMÁS una de admin/select-negocio.
ALTER TABLE appointment_tips ENABLE ROW LEVEL SECURITY;
