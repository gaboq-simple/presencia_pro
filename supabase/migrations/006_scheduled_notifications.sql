-- ─── 006_scheduled_notifications.sql ─────────────────────────────────────────
-- Tabla para recordatorios y notificaciones programadas.
-- scheduled_for <= now() + sent_at IS NULL + failed_at IS NULL = pendiente de despacho.

CREATE TABLE scheduled_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
  patient_phone   TEXT,
  patient_email   TEXT,
  type            TEXT NOT NULL
                    CHECK (type IN (
                      'appointment_reminder',
                      'appointment_confirmation',
                      'appointment_confirmed',
                      'appointment_cancelled',
                      'review_request',
                      'reactivation'
                    )),
  channel         TEXT NOT NULL
                    CHECK (channel IN ('whatsapp', 'email')),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para el cron: busca filas pendientes por fecha
CREATE INDEX idx_scheduled_notifications_pending
  ON scheduled_notifications (scheduled_for)
  WHERE sent_at IS NULL AND failed_at IS NULL;

-- Índice para consultas por cita (cancelar recordatorios al cancelar cita)
CREATE INDEX idx_scheduled_notifications_appointment
  ON scheduled_notifications (appointment_id)
  WHERE appointment_id IS NOT NULL;
