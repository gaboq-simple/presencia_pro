-- ─── Deduplicación de mensajes por message_id ─────────────────────────────────
-- Agrega last_message_id a bot_conversations para detectar mensajes duplicados
-- o reintentos del webhook de Meta/Twilio.
--
-- Caso cubierto:
--   - Meta y Twilio reenvían el webhook si no reciben 200 en < 20 s.
--   - Si el mismo message_id llega dos veces, el segundo se ignora.
--
-- Limitación documentada:
--   No resuelve el race condition de doble-tap simultáneo (< 50 ms entre
--   dos mensajes distintos del mismo usuario). Para ese caso, el constraint
--   no_overlapping_appointments en appointments es la última línea de defensa.
--   Resolver el race condition verdadero requiere transacciones Postgres directas
--   (no disponibles en el cliente JS de Supabase).

ALTER TABLE bot_conversations
  ADD COLUMN IF NOT EXISTS last_message_id TEXT;

-- Índice para la verificación O(log n) del message_id.
-- La consulta es: SELECT last_message_id FROM bot_conversations
--   WHERE business_id = $1 AND customer_phone = $2
-- El índice existente idx_bot_conversations_business_phone ya cubre el WHERE.
-- No se necesita índice adicional — el SELECT es sobre la fila única de la clave.
