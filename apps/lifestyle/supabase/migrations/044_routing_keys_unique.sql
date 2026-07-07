-- Migration 044: partial UNIQUE indexes on tenant routing keys
-- ─────────────────────────────────────────────────────────────────────────────
-- PROBLEMA QUE RESUELVE
--   whatsapp_phone_number_id (routing del bot Meta) y whatsapp_number (routing
--   del path Twilio) son las dos llaves con las que un mensaje entrante resuelve
--   a qué negocio pertenece. Ambas son NOT NULL pero hoy NO son únicas ni tienen
--   índice: dos negocios podrían quedar configurados con el mismo id/número.
--   El router hace `.eq(<llave>, valor).eq('active', true).maybeSingle()`; ante
--   una colisión, maybeSingle() falla y el mensaje se descarta EN SILENCIO (el
--   cliente no recibe respuesta). Esta migración convierte esa bomba silenciosa
--   en un fallo ruidoso (unique violation) en el momento de configurar.
--
-- POR QUÉ PARCIAL (WHERE <> '')
--   El script de onboarding crea negocios "a medias" en Fase 1 con las dos llaves
--   en '' (string vacío), y las llena al conectar WhatsApp en Fase 2. Un UNIQUE
--   plano chocaría con múltiples borradores en ''. El índice parcial ignora los
--   '' (permite varios borradores) y solo exige unicidad entre valores REALES.
--   El lookup del router siempre usa un valor no-vacío, así que el índice parcial
--   igual lo cubre.
--
-- CONTRACARA (fuera de alcance — MT-06)
--   Con este índice, el UPDATE de Fase 2 que intente fijar una llave ya usada por
--   otro negocio ahora falla con unique violation. Que ese error se presente de
--   forma clara al operador es trabajo de MT-06 (onboarding que no nazca
--   inservible), NO de esta migración.
--
-- ESTRATEGIA
--   Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS. Aplicado vía MCP
--   apply_migration (no db push); el archivo queda en el repo como registro.

CREATE UNIQUE INDEX IF NOT EXISTS businesses_whatsapp_phone_number_id_unique
  ON public.businesses (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS businesses_whatsapp_number_unique
  ON public.businesses (whatsapp_number)
  WHERE whatsapp_number <> '';
