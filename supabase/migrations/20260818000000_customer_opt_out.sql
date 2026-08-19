-- ─── Permiso · P1 — el modelo aprende a decir "ya no" (S8-PER-01) ────────────
--
-- Hasta hoy `customers` sabía decir "consintió" —las tres columnas de la
-- migración 037— y no sabía decir lo contrario. Un cliente podía pedir la baja
-- y el modelo de datos no tenía dónde anotarla: se perdía en el aire, y la
-- siguiente reactivación le llegaba igual.
--
-- Estas dos columnas son el ESPEJO EXACTO de las de alta, y eso es deliberado:
-- quien lea la tabla ve el par completo (cuándo consintió / cuándo se dio de
-- baja, y por qué vía cada cosa) sin tener que buscar en otro lado.
--
-- Las tres vías del CHECK, y por qué esas tres:
--   · `whatsapp_keyword` — el cliente escribió BAJA. Es la vía normal (P2).
--   · `manual`           — alguien del negocio la registró a mano (llamada,
--                          mostrador). Todavía sin UI: llega con la capa de
--                          activación, que es donde el dueño lo va a necesitar.
--   · `arco`             — resultado de una solicitud formal de oposición o
--                          cancelación por `/arco`. Es un trámite con plazo
--                          legal, no un opt-out de mensajería, y por eso se
--                          distingue: la evidencia que respalda cada una es
--                          distinta.
--
-- Plan: docs/planes/permiso.md · Tarea: SPRINT.md S8-PER-01 (P1).
-- Aplicada al demo vía MCP; este archivo queda como registro (patrón 046).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS opted_out_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_via TEXT
    CHECK (opted_out_via IN ('whatsapp_keyword', 'manual', 'arco'));

COMMENT ON COLUMN public.customers.opted_out_at IS
  'Instante en que el titular pidió dejar de recibir mensajes PROACTIVOS. NULL = no se dio de baja. Bloquea marketing, reactivación y solicitudes de reseña; NO bloquea las respuestas del bot cuando el cliente escribe, ni los recordatorios de las citas que él mismo agende después (regla de niveles, S8-PER-01).';

COMMENT ON COLUMN public.customers.opted_out_via IS
  'Cómo llegó la baja: whatsapp_keyword (escribió BAJA), manual (el negocio la registró) o arco (solicitud formal de oposición/cancelación). Espejo de consented_via.';

-- ─── Índice parcial para las queries de exclusión (P3) ────────────────────────
--
-- Todas las lecturas de destinatarios preguntan lo MISMO: "los de este negocio
-- que no se dieron de baja". El índice parcial indexa solo esas filas, que son
-- la enorme mayoría y son las únicas que se recorren; las dadas de baja no
-- ocupan lugar en él.
--
-- Verificado antes de crearlo: `customers` tenía tres índices —`customers_pkey`,
-- `customers_business_id_phone_key` e `idx_customers_business_phone`— y ninguno
-- sirve para este predicado. No es un duplicado.
CREATE INDEX IF NOT EXISTS idx_customers_business_active_contactable
  ON public.customers (business_id)
  WHERE opted_out_at IS NULL;

COMMENT ON INDEX public.idx_customers_business_active_contactable IS
  'Parcial para el guard de envío (S8-PER-01 P3): los contactables de un negocio. Las filas dadas de baja no entran al índice.';
