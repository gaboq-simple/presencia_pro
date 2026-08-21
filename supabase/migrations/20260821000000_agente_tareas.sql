-- ─── Agente fase 1 — Paso A3: el primitivo de TAREAS ─────────────────────────
--
-- El cimiento de datos del flujo "Analizar": dónde vive una propuesta del agente
-- desde que nace hasta que se puede decir si sirvió. SIN UI (la viste el ciclo 2
-- de diseño) y SIN envíos (gateados por la WABA).
--
-- Plan: docs/planes/agente-fase-1.md (A3) · Contrato: docs/planes/agente.md
-- Tarea: SPRINT.md S9-AG-02. Aplicada vía MCP; este archivo queda como registro.
--
-- ─── La idea que ordena todo el archivo ──────────────────────────────────────
-- La regla 1 de la constitución dice "el agente propone; el dueño dispone". Eso
-- no se sostiene con disciplina de la app: se sostiene si **la base no deja**
-- avanzar una tarea sin que quede escrito quién la avanzó y cuándo.
--
-- De ahí las tres decisiones que gobiernan el diseño:
--
--   1. **Cada transición es un EVENTO, jamás un UPDATE mudo.** El estado de la
--      tarea es un caché de su último evento; la historia es la tabla de eventos.
--   2. **La máquina de estados vive acá, no en TypeScript.** El módulo espejo
--      (`lib/agenteTareas.ts`) existe para que la UI sepa qué ofrecer, pero la
--      autoridad es esta función: un cliente que se equivoque rebota.
--   3. **Un UPDATE directo NO puede saltarse el evento.** El trigger exige un GUC
--      transaction-local que SOLO pone la función de transición — el mismo patrón
--      de atribución de 047/048/056. Sin eso, cualquiera con `service_role`
--      (que es como entra la app) podría mover `estado` a mano y la historia
--      mentiría por omisión.

-- ─── 1. agente_tareas — la propuesta ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agente_tareas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Identidad ESTABLE de la propuesta ("reactivar-cliente-<uuid>-2026-08").
  -- Es lo que hace que una descartada no reaparezca sola: el agente que vuelva a
  -- proponer lo mismo choca contra el UNIQUE de abajo en vez de crear un duplicado
  -- que nadie relaciona con la decisión ya tomada.
  clave       text NOT NULL,
  tipo        text NOT NULL,
  titulo      text NOT NULL,

  -- NOT NULL y no vacía, por la regla de voz del contrato: una propuesta que no
  -- se puede explicar no se puede aprobar. El CHECK es contra el string vacío
  -- porque `NOT NULL` solo no alcanza — '' pasaría y diría lo mismo que nada.
  explicacion text NOT NULL CHECK (btrim(explicacion) <> ''),

  -- Los veredictos que la sostienen, tal como los emitió el módulo puro. Es la
  -- evidencia, no el argumento: el argumento es `explicacion`.
  evidencia   jsonb NOT NULL DEFAULT '{}'::jsonb,

  estado      text NOT NULL DEFAULT 'propuesta'
                CHECK (estado IN ('propuesta', 'aprobada', 'ejecutada', 'medida', 'descartada')),

  -- Lo llena el corte al medir. NULL hasta entonces, y la transición a 'medida'
  -- lo EXIGE: una tarea "medida" sin resultado sería el peor estado posible —
  -- dice que ya sabemos si sirvió, y no lo sabemos.
  resultado   jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agente_tareas_clave_unica UNIQUE (business_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_agente_tareas_biz_estado
  ON public.agente_tareas (business_id, estado, created_at DESC);

COMMENT ON TABLE public.agente_tareas IS
  'Propuestas del agente. El estado es un CACHÉ del último evento: la historia vive en agente_tarea_eventos y solo se mueve por agente_tarea_transicionar(). Un UPDATE directo de estado/resultado rebota (trigger + GUC).';
COMMENT ON COLUMN public.agente_tareas.clave IS
  'Identidad estable de la propuesta, UNIQUE por negocio. Es lo que impide que una descartada reaparezca como propuesta nueva.';

-- ─── 2. agente_tarea_eventos — la historia ───────────────────────────────────
-- Append-only por trigger (patrón caja/audit): editar el pasado de una decisión
-- es peor que no tenerlo, porque se ve igual de confiable.
CREATE TABLE IF NOT EXISTS public.agente_tarea_eventos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id       uuid NOT NULL REFERENCES public.agente_tareas(id) ON DELETE CASCADE,
  -- Desnormalizado para consulta y RLS por tenant, como appointment_audit.
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- NULL solo en el evento de nacimiento. Guardar el "desde" hace que la
  -- historia se lea sin reconstruirla: cada fila dice el salto completo.
  estado_desde   text CHECK (estado_desde IN ('propuesta', 'aprobada', 'ejecutada', 'medida', 'descartada')),
  estado_hasta   text NOT NULL
                   CHECK (estado_hasta IN ('propuesta', 'aprobada', 'ejecutada', 'medida', 'descartada')),

  -- Quién. 'staff' EXIGE staff_id (ver el CHECK pareado): un "lo aprobó una
  -- persona" sin decir cuál no es atribución, es un rumor.
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  actor_tipo     text NOT NULL CHECK (actor_tipo IN ('staff', 'agente', 'system')),

  nota           text,
  resultado      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agente_evento_actor_pareado CHECK (
    (actor_tipo = 'staff' AND actor_staff_id IS NOT NULL) OR
    (actor_tipo <> 'staff' AND actor_staff_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agente_eventos_tarea
  ON public.agente_tarea_eventos (tarea_id, created_at, id);

COMMENT ON TABLE public.agente_tarea_eventos IS
  'Una fila por transición de una tarea del agente, append-only. El actor va pareado con su tipo: actor_tipo=staff exige staff_id.';

-- ─── 3. Append-only real (bloquea incluso a service_role) ────────────────────
--
-- ⚠️ CONSECUENCIA MEDIDA, no teórica (sondeo N9 de A3): con eventos presentes,
-- **borrar la tarea también rebota** — el `ON DELETE CASCADE` de arriba dispara
-- este trigger BEFORE DELETE fila por fila. Es correcto (el historial de una
-- decisión no se borra de refilón), pero significa que la purga por retención va
-- a necesitar un bypass CONTROLADO, exactamente como el que ya deben
-- `appointment_audit` y las tablas de caja (SPRINT.md → S6-SEC-01). La limpieza
-- de los sondeos se hizo suspendiendo este trigger a mano y volviéndolo a poner,
-- que es lo mismo que hace `scripts/seed-demo-densa.sql` con el audit.
CREATE OR REPLACE FUNCTION public.agente_eventos_inmutables()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agente_tarea_eventos es append-only: % no permitido (corregir = transición nueva)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_agente_eventos_inmutables ON public.agente_tarea_eventos;
CREATE TRIGGER trg_agente_eventos_inmutables
BEFORE UPDATE OR DELETE ON public.agente_tarea_eventos
FOR EACH ROW
EXECUTE FUNCTION public.agente_eventos_inmutables();

-- ─── 4. El candado: no hay estado sin evento ─────────────────────────────────
-- `estado` y `resultado` solo se mueven desde agente_tarea_transicionar(), que es
-- la única que pone el GUC. Todo lo demás de la fila (título, evidencia) queda
-- libre a propósito: corregir la redacción de una propuesta no es una transición.
--
-- Por qué un GUC y no un rol dedicado: la app entra con `service_role`, que
-- bypassa RLS y tiene todos los privilegios. Contra eso, un permiso no sirve —
-- el único candado que funciona es uno que exija pasar POR la función.
CREATE OR REPLACE FUNCTION public.agente_tareas_estado_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.estado    IS DISTINCT FROM OLD.estado)
  OR (NEW.resultado IS DISTINCT FROM OLD.resultado) THEN
    IF COALESCE(current_setting('app.agente_transicion', true), '') <> 'si' THEN
      RAISE EXCEPTION
        'agente_tareas: el estado y el resultado solo se mueven por agente_tarea_transicionar() (un UPDATE directo dejaría la tarea sin evento)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agente_tareas_estado_guard ON public.agente_tareas;
CREATE TRIGGER trg_agente_tareas_estado_guard
BEFORE UPDATE ON public.agente_tareas
FOR EACH ROW
EXECUTE FUNCTION public.agente_tareas_estado_guard();

-- ─── 5. El mapa de estados (FUENTE DE VERDAD) ────────────────────────────────
-- ⚠️ El test de repo `tests/agenteTareas.repo.test.ts` LEE estas líneas y falla
-- si no coinciden con `apps/lifestyle/src/lib/agenteTareas.ts`. No es un
-- comentario: es el `CASE` que de verdad corre. Si cambia el mapa, cambia acá y
-- allá en el mismo commit, o el build rompe.
CREATE OR REPLACE FUNCTION public.agente_tarea_permitidas(p_desde text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_desde
    WHEN 'propuesta'  THEN ARRAY['aprobada','descartada']
    WHEN 'aprobada'   THEN ARRAY['ejecutada','descartada']
    WHEN 'ejecutada'  THEN ARRAY['medida']
    WHEN 'medida'     THEN ARRAY[]::text[]
    WHEN 'descartada' THEN ARRAY[]::text[]
  END;
$$;

COMMENT ON FUNCTION public.agente_tarea_permitidas(text) IS
  'Mapa de transiciones. Fuente de verdad: lib/agenteTareas.ts lo espeja y tests/agenteTareas.repo.test.ts rompe el build si divergen. medida y descartada son terminales.';

-- ─── 6. Proponer — nace la tarea con su primer evento ────────────────────────
-- El INSERT de la tarea y el de su evento van en la MISMA transacción: una tarea
-- sin evento de nacimiento sería una propuesta que apareció sola.
CREATE OR REPLACE FUNCTION public.agente_tarea_proponer(
  p_business_id uuid,
  p_clave       text,
  p_tipo        text,
  p_titulo      text,
  p_explicacion text,
  p_evidencia   jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.agente_tareas (business_id, clave, tipo, titulo, explicacion, evidencia)
  VALUES (p_business_id, p_clave, p_tipo, p_titulo, p_explicacion, p_evidencia)
  RETURNING id INTO v_id;

  -- actor_tipo='agente' y sin staff_id: proponer es lo ÚNICO que el agente hace
  -- solo. Aprobar y descartar exigen persona (ver la transición).
  INSERT INTO public.agente_tarea_eventos
    (tarea_id, business_id, estado_desde, estado_hasta, actor_tipo)
  VALUES (v_id, p_business_id, NULL, 'propuesta', 'agente');

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.agente_tarea_proponer(uuid, text, text, text, text, jsonb) IS
  'Crea una propuesta con su evento de nacimiento en la misma transacción. Choca con 23505 si la clave ya existe en el negocio: una descartada no reaparece sola.';

-- ─── 7. Transicionar — la única puerta ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agente_tarea_transicionar(
  p_tarea_id       uuid,
  p_estado_hasta   text,
  p_actor_tipo     text,
  p_actor_staff_id uuid    DEFAULT NULL,
  p_nota           text    DEFAULT NULL,
  p_resultado      jsonb   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde   text;
  v_biz     uuid;
  v_permite text[];
BEGIN
  -- FOR UPDATE: dos aprobaciones simultáneas de la misma tarea se serializan.
  -- Sin esto, las dos leerían 'propuesta', las dos pasarían la validación y
  -- quedarían dos eventos de aprobación sobre una sola decisión.
  SELECT estado, business_id INTO v_desde, v_biz
    FROM public.agente_tareas WHERE id = p_tarea_id FOR UPDATE;

  IF v_desde IS NULL THEN
    RAISE EXCEPTION 'agente_tarea_transicionar: la tarea % no existe', p_tarea_id;
  END IF;

  v_permite := public.agente_tarea_permitidas(v_desde);

  IF NOT (p_estado_hasta = ANY (v_permite)) THEN
    RAISE EXCEPTION 'agente_tarea_transicionar: % → % no es una transición válida (desde % solo se puede ir a %)',
      v_desde, p_estado_hasta, v_desde,
      CASE WHEN cardinality(v_permite) = 0 THEN 'ningún estado: es terminal'
           ELSE array_to_string(v_permite, ' o ') END;
  END IF;

  -- Decidir es de una PERSONA. El agente puede proponer y puede ejecutar lo ya
  -- aprobado; aprobar y descartar, no — es la regla 1 de la constitución escrita
  -- como candado y no como intención.
  IF p_estado_hasta IN ('aprobada', 'descartada')
     AND (p_actor_tipo <> 'staff' OR p_actor_staff_id IS NULL) THEN
    RAISE EXCEPTION 'agente_tarea_transicionar: pasar a % exige un actor humano identificado (actor_tipo=staff con staff_id)', p_estado_hasta;
  END IF;

  IF p_estado_hasta = 'medida' AND p_resultado IS NULL THEN
    RAISE EXCEPTION 'agente_tarea_transicionar: pasar a medida exige resultado (una tarea medida sin resultado afirma que ya sabemos si sirvió)';
  END IF;

  -- El GUC que el trigger exige. transaction-local (is_local=true): al COMMIT se
  -- descarta solo y nunca se filtra a la próxima request del pooler — la lección
  -- de 2c-i, escrita en 047.
  PERFORM set_config('app.agente_transicion', 'si', true);

  UPDATE public.agente_tareas
     SET estado     = p_estado_hasta,
         resultado  = COALESCE(p_resultado, resultado),
         updated_at = now()
   WHERE id = p_tarea_id;

  INSERT INTO public.agente_tarea_eventos
    (tarea_id, business_id, estado_desde, estado_hasta, actor_staff_id, actor_tipo, nota, resultado)
  VALUES
    (p_tarea_id, v_biz, v_desde, p_estado_hasta,
     CASE WHEN p_actor_tipo = 'staff' THEN p_actor_staff_id ELSE NULL END,
     p_actor_tipo, p_nota, p_resultado);
END;
$$;

COMMENT ON FUNCTION public.agente_tarea_transicionar(uuid, text, text, uuid, text, jsonb) IS
  'La ÚNICA puerta para mover una tarea del agente: valida el mapa, exige actor humano para aprobada/descartada y resultado para medida, y deja el evento. Pone el GUC transaction-local que el trigger de la tabla exige.';

-- ─── 8. Privilegios y RLS ────────────────────────────────────────────────────
-- RLS habilitada y CERO políticas (patrón appointment_tips / caja): el tráfico
-- legítimo entra por service_role con el gate de sesión en la server action.
-- Ninguna sesión de browser puede leer estas tablas por PostgREST ni recibirlas
-- por Realtime (la publicación no es FOR ALL TABLES: nacen fuera).
ALTER TABLE public.agente_tareas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_tarea_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.agente_tarea_proponer(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_tarea_proponer(uuid, text, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agente_tarea_proponer(uuid, text, text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.agente_tarea_transicionar(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agente_tarea_transicionar(uuid, text, text, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agente_tarea_transicionar(uuid, text, text, uuid, text, jsonb) TO service_role;
