-- ─── PresenciaPro Lifestyle — Schema inicial ─────────────────────────────────
-- Ejecutar con privilegios de superusuario o service_role en Postgres 15+.
-- RLS activado en todas las tablas — ver 002_rls_policies.sql.
--
-- Convenciones:
--   - Columna discriminadora: business_id UUID en todas las tablas operativas
--   - CHECK constraints reflejan los enums TypeScript en lifestyle.types.ts
--   - Toda FK tiene comportamiento explícito ON DELETE
--   - Prefijo de índices: idx_[tabla]_[columnas]

-- ─── businesses ───────────────────────────────────────────────────────────────
-- Registro de cada negocio cliente. El slug es el subdominio público.

CREATE TABLE businesses (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT        NOT NULL,
  slug                     TEXT        NOT NULL UNIQUE,
  business_type            TEXT        NOT NULL,  -- 'barberia' | 'spa' | 'estetica' | etc.
  whatsapp_number          TEXT        NOT NULL,  -- 10-15 dígitos, sin +
  whatsapp_phone_number_id TEXT        NOT NULL,  -- Phone Number ID de Meta — clave de routing del bot
  logo_url                 TEXT,
  cover_image_url          TEXT,
  description              TEXT,
  address                  TEXT        NOT NULL,
  social_links             JSONB       NOT NULL DEFAULT '{}',
  active                   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── staff ────────────────────────────────────────────────────────────────────
-- Personal del negocio. auth_id vincula con Supabase Auth — requerido para RLS.
-- auth_id es NULL para staff sin acceso al dashboard.

CREATE TABLE staff (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  auth_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  whatsapp_id TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('admin', 'barber', 'assistant')),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── services ─────────────────────────────────────────────────────────────────
-- Catálogo de servicios del negocio. Cacheado en /api/catalog TTL 300s.

CREATE TABLE services (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID           NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT           NOT NULL,
  description      TEXT,
  duration_minutes INTEGER        NOT NULL CHECK (duration_minutes > 0),
  price            NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  currency         TEXT           NOT NULL DEFAULT 'MXN',
  active           BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── staff_services ───────────────────────────────────────────────────────────
-- Qué servicios ofrece cada staff. Tabla pivot — PK compuesta.

CREATE TABLE staff_services (
  staff_id   UUID NOT NULL REFERENCES staff(id)    ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- ─── customers ────────────────────────────────────────────────────────────────
-- Clientes del negocio. phone = whatsapp_id canónico (sin + ni espacios).
-- UNIQUE(business_id, phone): un registro por cliente por negocio.

CREATE TABLE customers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  phone               TEXT        NOT NULL,  -- whatsapp_id canónico normalizado
  favorite_staff_id   UUID        REFERENCES staff(id)    ON DELETE SET NULL,
  favorite_service_id UUID        REFERENCES services(id) ON DELETE SET NULL,
  notes               TEXT,                 -- notas libres del staff
  visit_count         INTEGER     NOT NULL DEFAULT 0,
  last_visit          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, phone)
);

-- ─── appointments ─────────────────────────────────────────────────────────────
-- Citas. status y source tienen CHECK constraints — nunca cadena libre.

CREATE TABLE appointments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES staff(id),
  service_id  UUID        NOT NULL REFERENCES services(id),
  customer_id UUID        REFERENCES customers(id) ON DELETE SET NULL,  -- NULL en walk-ins sin cliente
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'walkin')),
  source      TEXT        NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('bot', 'manual', 'walkin')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── staff_availability ───────────────────────────────────────────────────────
-- Disponibilidad semanal recurrente por staff.
-- day_of_week: 0 = domingo, 6 = sábado (convención JavaScript/ISO).
-- UNIQUE(staff_id, day_of_week): un bloque por día por staff.

CREATE TABLE staff_availability (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID    NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TIME    NOT NULL,
  end_time    TIME    NOT NULL CHECK (end_time > start_time),
  UNIQUE (staff_id, day_of_week)
);

-- ─── staff_blocks ─────────────────────────────────────────────────────────────
-- Bloqueos puntuales: vacaciones, citas personales, etc.

CREATE TABLE staff_blocks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── bot_conversations ────────────────────────────────────────────────────────
-- Estado de cada conversación activa en WhatsApp por negocio.
-- context se deserializa con LifestyleBotContextSchema.safeParse() en el engine.

CREATE TABLE bot_conversations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_phone TEXT        NOT NULL,   -- whatsapp_id canónico normalizado
  state          TEXT        NOT NULL DEFAULT 'GREETING',
  context        JSONB       NOT NULL DEFAULT '{}',
  last_message   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── scheduled_notifications ──────────────────────────────────────────────────
-- Cola de notificaciones programadas (recordatorios, follow-ups).
-- Idempotencia: leer solo WHERE sent_at IS NULL AND failed_at IS NULL.

CREATE TABLE scheduled_notifications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID        REFERENCES appointments(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL,   -- 'reminder_24h' | 'reminder_2h' | 'follow_up' | 'review_request'
  scheduled_for  TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,            -- NULL si no enviado
  failed_at      TIMESTAMPTZ,            -- NULL si sin error
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Índices ──────────────────────────────────────────────────────────────────
-- Cubren los queries más frecuentes. Ver ARCHITECTURE-LIFESTYLE.md §3.

-- Vista de agenda por negocio y fecha (dashboard admin)
CREATE INDEX idx_appointments_business_starts
  ON appointments (business_id, starts_at);

-- Vista de agenda por barbero y fecha (vista del staff)
CREATE INDEX idx_appointments_staff_starts
  ON appointments (staff_id, starts_at);

-- Lookup del estado de conversación por teléfono (bot — cada mensaje entrante)
CREATE INDEX idx_bot_conversations_business_phone
  ON bot_conversations (business_id, customer_phone);

-- Upsert de cliente por teléfono (bot — al inicio de cada conversación nueva)
CREATE INDEX idx_customers_business_phone
  ON customers (business_id, phone);
