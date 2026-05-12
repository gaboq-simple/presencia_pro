-- ─── 006_business_bot_config.sql ─────────────────────────────────────────────
-- Agrega configuración del bot por negocio a la tabla businesses.
-- Todos los campos tienen valores por defecto para que los negocios existentes
-- funcionen sin migración de datos.

ALTER TABLE businesses
  -- Nombre del bot mostrado al cliente en saludos y confirmaciones.
  -- Configurable por negocio. Default: 'Asistente'.
  ADD COLUMN bot_name TEXT NOT NULL DEFAULT 'Asistente',

  -- Mensaje enviado cuando el cliente escribe fuera del horario de atención.
  ADD COLUMN away_message TEXT NOT NULL DEFAULT
    '¡Hola! Gracias por escribirnos. En este momento estamos fuera de horario. '
    'Te atendemos en cuanto regresemos. 😊',

  -- Mensaje enviado cuando el bot no entiende la respuesta del cliente.
  ADD COLUMN fallback_message TEXT NOT NULL DEFAULT
    'Disculpa, no entendí bien tu mensaje. ¿Puedes reformularlo? '
    'Puedo ayudarte a agendar una cita.',

  -- Horario de atención del bot. JSONB con días y rangos horarios.
  -- Formato: { "0": null, "1": {"start": "09:00", "end": "19:00"}, ... }
  -- Clave: día de la semana (0=domingo, 6=sábado). null = cerrado ese día.
  -- Null en la columna = el bot atiende las 24h (sin restricción de horario).
  ADD COLUMN office_hours JSONB DEFAULT NULL;

COMMENT ON COLUMN businesses.bot_name IS
  'Nombre del asistente virtual mostrado al cliente. Ej: "Asistente", "Carlos Bot".';

COMMENT ON COLUMN businesses.away_message IS
  'Mensaje cuando el cliente escribe fuera de office_hours.';

COMMENT ON COLUMN businesses.fallback_message IS
  'Mensaje cuando el bot no reconoce el input. Máximo 2 veces antes de escalar.';

COMMENT ON COLUMN businesses.office_hours IS
  'Horario de atención del bot por día. {"0":null,"1":{"start":"09:00","end":"19:00"},...}. '
  'null en la columna = 24h.';
