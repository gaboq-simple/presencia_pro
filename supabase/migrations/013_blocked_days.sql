-- Migration 013: blocked_days
-- Allows doctors to block entire days (vacations, conferences, personal days)
-- without cancelling individual appointments.
-- getAvailableSlots() checks this table before generating slots for any date.

CREATE TABLE blocked_days (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL,
  specialist_id TEXT NOT NULL,
  date          DATE NOT NULL,
  reason        TEXT,              -- 'vacaciones', 'congreso', etc. — opcional
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, specialist_id, date)
);

CREATE INDEX idx_blocked_days_lookup
ON blocked_days (client_id, specialist_id, date);
