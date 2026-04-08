-- ─── 008_indexes_and_rls.sql ──────────────────────────────────────────────────
-- Índices de performance y Row Level Security para todas las tablas.
--
-- Nota: scheduled_notifications ya tiene dos índices creados en 006:
--   idx_scheduled_notifications_pending   — (scheduled_for) WHERE sent_at IS NULL AND failed_at IS NULL
--   idx_scheduled_notifications_appointment — (appointment_id) WHERE appointment_id IS NOT NULL
-- No se duplican aquí.

-- ─── Índices ──────────────────────────────────────────────────────────────────

-- appointments: getAvailableSlots, findBySpecialistAndRange, dashboard day-view
CREATE INDEX IF NOT EXISTS idx_appointments_client_specialist_starts
  ON appointments (client_id, specialist_id, starts_at);

-- appointments: dashboard queries por estado (pending_confirmation, completed, etc.)
CREATE INDEX IF NOT EXISTS idx_appointments_client_status_starts
  ON appointments (client_id, status, starts_at);

-- bot_conversations: routing de mensajes entrantes por número de teléfono
CREATE INDEX IF NOT EXISTS idx_bot_conversations_client_phone
  ON bot_conversations (client_id, patient_phone);

-- events: métricas agregadas por tipo y fecha
CREATE INDEX IF NOT EXISTS idx_events_client_type_created
  ON events (client_id, type, created_at DESC);

-- patients: búsqueda directa por teléfono sin UUID (uso frecuente desde bot)
-- UNIQUE(client_id, phone) ya crea índice implícito — solo confirmar, no crear

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- Política base: client_id debe coincidir con el parámetro de sesión app.client_id.
--
-- El servidor setea: SET LOCAL app.client_id = 'dra-quevedo' antes de cada query.
-- La service_role_key bypasea RLS automáticamente — usada por Edge Functions y
-- API routes del servidor (no afecta operación normal).
-- Esta política es la última línea de defensa ante API routes mal configurados
-- que usen la anon key en lugar de la service role key.

ALTER TABLE patients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE intakes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                 ENABLE ROW LEVEL SECURITY;

-- clients: un cliente solo puede leer su propio registro
CREATE POLICY "clients_select_own" ON clients
  FOR SELECT
  USING (id = current_setting('app.client_id', true));

-- patients
CREATE POLICY "patients_client_isolation" ON patients
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));

-- appointments
CREATE POLICY "appointments_client_isolation" ON appointments
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));

-- intakes
CREATE POLICY "intakes_client_isolation" ON intakes
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));

-- bot_conversations
CREATE POLICY "bot_conversations_client_isolation" ON bot_conversations
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));

-- events
CREATE POLICY "events_client_isolation" ON events
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));

-- scheduled_notifications
CREATE POLICY "scheduled_notifications_client_isolation" ON scheduled_notifications
  FOR ALL
  USING (client_id = current_setting('app.client_id', true));
