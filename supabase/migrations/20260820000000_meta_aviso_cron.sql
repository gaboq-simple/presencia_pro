-- ─── Agente fase 1 — Paso A1: el meta-aviso del cron ─────────────────────────
--
-- `invoke_app` e `invoke_edge` devuelven el ID de la petición que ENCOLARON, no
-- su resultado: pg_cron marca el job `succeeded` en cuanto la función retorna.
-- Medido el 2026-08-20 sobre este mismo proyecto: 10,295 corridas de
-- `dispatch-auto-cancel`, 7 de `corte-nudge` y 1 de `senales-digest` desde el
-- 13-ago, y CERO con estado distinto de `succeeded` — mientras siete de esas
-- corridas del nudge y la única del digest pegaban contra un 401 de la propia
-- ruta. Un aviso que no puede avisar de su propia falla no es un aviso.
--
-- Plan: docs/planes/agente-fase-1.md (A1) · Tarea: SPRINT.md S8-OPS-01.
-- Aplicada al proyecto vía MCP; este archivo queda como registro (patrón 046).
--
-- ─── Por qué NO se verifica dentro del mismo job ──────────────────────────────
-- La tarea proponía esperar el status y hacer RAISE en la misma función. No se
-- puede, y se midió antes de escribir esto:
--   · una petición encolada dentro de un bloque `DO $$` y poleada 25 veces cada
--     200 ms (req_id 10297) NUNCA apareció en `net._http_response`;
--   · la misma petición fuera de transacción (req_id 10298) resolvió en menos de
--     lo que tardó una sola de esas consultas.
-- pg_net despacha DESPUÉS del COMMIT. Un job que espere su propia respuesta
-- espera para siempre, y un RAISE abortaría la transacción que contiene la
-- petición: el aviso se cancelaría a sí mismo antes de que la petición saliera.
--
-- De ahí los tres tiempos, que son tres funciones y no una:
--   1. ENCOLAR deja rastro     — `invoke_app`/`invoke_edge` escriben la fila.
--   2. VERIFICAR escribe       — `verificar_invocaciones()`, cada 5 min, sin gritar.
--   3. ALARMAR grita           — `alarma_invocaciones()`, cada 15 min, sin escribir.
-- El (2) no puede hacer RAISE porque revertiría lo que acaba de guardar; el (3)
-- no escribe nada, así que su RAISE no tiene qué revertir. Separarlos no es
-- elegancia: es la única combinación que deja evidencia Y deja marca roja.

-- ─── 1. El rastro propio ──────────────────────────────────────────────────────
-- `pg_net.ttl` son 6 HORAS (medido: 361 filas entre 15:41 y 21:40 UTC) y su
-- contexto es `sighup` — no se cambia con SQL de usuario en Supabase. La
-- evidencia no se puede retener: se COPIA antes de que el barrido la borre.
--
-- No es registro de negocio, es telemetría del operador. Por eso —y a diferencia
-- de `caja_movimientos`/`caja_cortes`— NO lleva trigger append-only y sí lleva
-- purga por edad: acá borrar lo viejo es correcto.
CREATE TABLE IF NOT EXISTS public.cron_invocaciones (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Qué se invocó, con su riel adelante: 'app:/api/internal/corte-nudge',
  -- 'edge:dispatch-auto-cancel'. Es la LLAVE DE SALUD que mira la alarma, y se
  -- prefiere al nombre del job de pg_cron por una razón práctica: la función
  -- invocadora no conoce el nombre del job que la llamó, y el destino identifica
  -- lo mismo (hoy la correspondencia job↔destino es 1 a 1) además de cubrir las
  -- invocaciones manuales, que es como se prueba todo esto.
  destino       text   NOT NULL,
  -- El id que devuelve pg_net. UNIQUE: una petición se verifica una sola vez.
  req_id        bigint NOT NULL UNIQUE,
  encolada_at   timestamptz NOT NULL DEFAULT now(),
  verificada_at timestamptz,
  status_code   int,
  -- Error de transporte de pg_net (timeout, DNS), NO el cuerpo de la respuesta.
  error_msg     text,
  -- Cuerpo recortado, y SOLO cuando el status es no-2xx. Un 401 rinde
  -- {"error":"No autorizado"}, que es justo lo que hace falta para diagnosticar;
  -- un 200 rinde el digest completo, que es dato del NEGOCIO y no tiene por qué
  -- vivir en una tabla de telemetría del operador. Los encabezados no se guardan
  -- nunca: ahí viaja el Authorization.
  cuerpo        text,
  veredicto     text NOT NULL DEFAULT 'pendiente'
                  CHECK (veredicto IN ('pendiente', 'ok', 'falla', 'sin_respuesta')),
  CONSTRAINT cron_invocaciones_cuerpo_check CHECK (
    cuerpo IS NULL OR status_code IS NULL OR status_code < 200 OR status_code >= 300
  )
);

-- Para el verificador (busca pendientes) y para la alarma (última por destino).
CREATE INDEX IF NOT EXISTS idx_cron_inv_pendientes
  ON public.cron_invocaciones (encolada_at) WHERE veredicto = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_cron_inv_destino
  ON public.cron_invocaciones (destino, encolada_at DESC);

COMMENT ON TABLE public.cron_invocaciones IS
  'Telemetría del operador: una fila por invocación HTTP disparada desde la base (pg_cron → pg_net). Existe porque net._http_response retiene 6 h y su TTL no se puede cambiar. Sin PII, sin encabezados, y el cuerpo solo en respuestas no-2xx. Purga a 90 días desde verificar_invocaciones().';

-- RLS deny-all (patrón caja/tips): ninguna sesión de browser la ve. La escribe
-- y la lee service_role, que la bypassa, y las funciones SECURITY DEFINER.
ALTER TABLE public.cron_invocaciones ENABLE ROW LEVEL SECURITY;

-- ─── 2. Encolar deja rastro — las dos invocadoras ─────────────────────────────
-- Se re-crean para agregar el INSERT. La FIRMA NO CAMBIA (siguen devolviendo el
-- req_id) y los tres `cron.job` existentes NO se tocan: el radio de explosión de
-- este paso es una tabla nueva y dos jobs nuevos.
--
-- El INSERT va en la misma transacción que el http_post, así que si la petición
-- no se encola tampoco queda rastro, y si queda rastro la petición salió.

CREATE OR REPLACE FUNCTION public.invoke_app(path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_base   text;
  v_secret text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_base   FROM vault.decrypted_secrets WHERE name = 'app_base_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'invoke_app: faltan secretos en Vault (app_base_url / cron_secret)';
  END IF;

  SELECT net.http_post(
    url     := v_base || path,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 30000
  ) INTO v_req_id;

  INSERT INTO public.cron_invocaciones (destino, req_id)
  VALUES ('app:' || path, v_req_id);

  RETURN v_req_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_app(text) IS
  'Invoca una ruta interna de la app (Vercel) desde pg_cron. Base y CRON_SECRET salen de Vault, nunca del repo. Falla ruidosa si falta un secreto. Deja rastro en cron_invocaciones (A1): el status real lo escribe verificar_invocaciones() en otra transacción, porque pg_net despacha después del COMMIT.';

REVOKE ALL ON FUNCTION public.invoke_app(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_app(text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.invoke_edge(fn text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_base   text;
  v_secret text;
  v_req_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_base   FROM vault.decrypted_secrets WHERE name = 'edge_base_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'edge_invoke_secret';

  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'invoke_edge: faltan secretos en Vault (edge_base_url / edge_invoke_secret)';
  END IF;

  SELECT net.http_post(
    url     := v_base || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 20000
  ) INTO v_req_id;

  INSERT INTO public.cron_invocaciones (destino, req_id)
  VALUES ('edge:' || fn, v_req_id);

  RETURN v_req_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_edge(text) IS
  'Invoca una edge function desde pg_cron. Base y credencial salen de Vault (nunca del repo). Falla ruidosa si falta un secreto. Deja rastro en cron_invocaciones (A1).';

REVOKE ALL ON FUNCTION public.invoke_edge(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_edge(text) FROM anon, authenticated;

-- ─── 3. Verificar — escribe el veredicto, nunca grita ─────────────────────────
-- Cruza las pendientes contra `net._http_response` por req_id. Devuelve cuántas
-- resolvió, para que su corrida en cron.job_run_details tenga algo que decir.
--
-- El minuto de gracia evita marcar `pendiente` como perdida cuando la respuesta
-- viene en camino; los 10 minutos convierten en `sin_respuesta` lo que ya no va a
-- llegar (worker de pg_net caído, o una petición que se perdió). `sin_respuesta`
-- NO es un estado benigno: para la alarma cuenta como falla, porque un aviso que
-- nadie sabe si salió es exactamente el problema que este paso vino a matar.
CREATE OR REPLACE FUNCTION public.verificar_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_resueltas integer;
BEGIN
  UPDATE public.cron_invocaciones ci
     SET verificada_at = now(),
         status_code   = r.status_code,
         error_msg     = r.error_msg,
         -- El cuerpo SOLO en no-2xx, y recortado. Ver el comentario de la columna.
         cuerpo        = CASE
                           WHEN r.status_code IS NOT NULL
                            AND (r.status_code < 200 OR r.status_code >= 300)
                           THEN left(r.content, 300)
                           ELSE NULL
                         END,
         veredicto     = CASE
                           WHEN r.error_msg IS NOT NULL THEN 'falla'
                           WHEN r.status_code BETWEEN 200 AND 299 THEN 'ok'
                           ELSE 'falla'
                         END
    FROM net._http_response r
   WHERE r.id = ci.req_id
     AND ci.veredicto = 'pendiente'
     AND ci.encolada_at < now() - interval '1 minute';

  GET DIAGNOSTICS v_resueltas = ROW_COUNT;

  -- Encoladas hace más de 10 minutos y sin respuesta: ya no va a llegar.
  UPDATE public.cron_invocaciones
     SET veredicto     = 'sin_respuesta',
         verificada_at = now()
   WHERE veredicto = 'pendiente'
     AND encolada_at < now() - interval '10 minutes';

  -- Purga: 90 días. Telemetría, no registro de negocio.
  DELETE FROM public.cron_invocaciones
   WHERE encolada_at < now() - interval '90 days';

  RETURN v_resueltas;
END;
$$;

COMMENT ON FUNCTION public.verificar_invocaciones() IS
  'Copia el status real de net._http_response a cron_invocaciones antes de que el TTL de 6 h lo borre, marca sin_respuesta lo que ya no va a llegar y purga a 90 días. NO hace RAISE a propósito: su propio RAISE revertiría lo que acaba de guardar. De gritar se encarga alarma_invocaciones().';

REVOKE ALL ON FUNCTION public.verificar_invocaciones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verificar_invocaciones() FROM anon, authenticated;

-- ─── 4. Alarmar — grita, y no escribe nada ────────────────────────────────────
-- Mira, por cada destino, su ÚLTIMA invocación verificada. Si es no-2xx, RAISE:
-- el fallo aparece en `cron.job_run_details`, que es donde ya se mira.
--
-- Se eligió "estado actual" y no "historial" por tres razones:
--   · cuando la siguiente corrida sale bien, la alarma se pone verde SOLA — nadie
--     tiene que acusar recibo ni marcar nada como visto;
--   · no escribe, así que su RAISE no tiene qué revertir (ver el encabezado);
--   · mientras algo esté roto, falla CADA 15 MINUTOS. Es deliberado: una alarma
--     que suena una vez y se calla es la falla que este paso vino a matar.
CREATE OR REPLACE FUNCTION public.alarma_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_detalle text;
  v_rotos   integer;
BEGIN
  WITH ultima AS (
    SELECT DISTINCT ON (destino)
           destino, veredicto, status_code, req_id, encolada_at
      FROM public.cron_invocaciones
     WHERE veredicto <> 'pendiente'
     ORDER BY destino, encolada_at DESC
  )
  SELECT count(*),
         string_agg(
           format('%s → %s (status %s, req_id %s, %s)',
                  destino, veredicto, coalesce(status_code::text, 'sin status'),
                  req_id, to_char(encolada_at, 'YYYY-MM-DD HH24:MI UTC')),
           '; ' ORDER BY destino)
    INTO v_rotos, v_detalle
    FROM ultima
   WHERE veredicto <> 'ok';

  IF v_rotos > 0 THEN
    RAISE EXCEPTION 'cron: % destino(s) con la última invocación en falla — %', v_rotos, v_detalle;
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.alarma_invocaciones() IS
  'Falla ruidosa si la ÚLTIMA invocación de algún destino fue no-2xx o sin respuesta, para que el fallo aparezca en cron.job_run_details. Refleja el estado ACTUAL del riel: se pone verde sola cuando la siguiente corrida sale bien. No escribe nada (si escribiera, su propio RAISE lo revertiría).';

REVOKE ALL ON FUNCTION public.alarma_invocaciones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alarma_invocaciones() FROM anon, authenticated;

-- ─── 5. Los dos schedules nuevos ──────────────────────────────────────────────
-- Verificar cada 5 min: por debajo del TTL de 6 h con margen de sobra, y lo
-- bastante seguido para que la evidencia de una corrida esté guardada antes de
-- que a nadie se le ocurra buscarla.
SELECT cron.schedule(
  'verificar-invocaciones',
  '*/5 * * * *',
  $$ SELECT public.verificar_invocaciones(); $$
);

-- Alarmar cada 15 min: suficiente para que un rojo se vea el mismo día sin
-- inundar `cron.job_run_details` cuando todo está bien (cuando todo está bien no
-- escribe una sola línea de error).
SELECT cron.schedule(
  'alarma-invocaciones',
  '*/15 * * * *',
  $$ SELECT public.alarma_invocaciones(); $$
);
