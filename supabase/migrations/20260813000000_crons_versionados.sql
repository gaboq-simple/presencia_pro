-- ─── Capa de dinero — Paso D3: los crons dejan de vivir en el Dashboard ───────
--
-- Hasta hoy los schedules de las edge functions se configuraban A MANO en el
-- Dashboard de Supabase: no estaban en el repo, nadie podía verlos en un diff y
-- se perdían si se recreaba el proyecto. Peor: la Fase 0 de este plan encontró
-- que `dispatch-auto-cancel` estaba MUERTO en producción — y al ejecutar D3
-- (2026-08-13) se vio la causa raíz: la function **nunca se había desplegado**
-- (cero functions en el proyecto), así que ningún schedule tenía a qué llamar.
--
-- Desde acá el schedule es código versionado. Lo único que sigue siendo manual
-- —inevitable— son los dos secretos, que no viven en el repo (ver scripts/README).
--
-- Plan: docs/planes/capa-de-dinero.md · Tarea: SPRINT.md S7-DIN-01 (D3).
-- Aplicada al proyecto vía MCP; este archivo queda como registro (patrón 046).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── invoke_edge — el puente pg_cron → edge function ──────────────────────────
-- Lee de Vault la base y la credencial de invocación y hace un POST asíncrono
-- (pg_net encola; la respuesta aterriza en net._http_response).
--
-- Por qué los secretos van en Vault y no como literales en esta migración: la
-- migración es un archivo del repo, y una credencial en el repo es una
-- credencial quemada. Vault los guarda cifrados y `invoke_edge` los resuelve en
-- tiempo de ejecución — cambiar la credencial no exige re-desplegar nada.
--
-- Falla RUIDOSA a propósito: si falta un secreto, RAISE. Un cron que "no hace
-- nada en silencio" es exactamente el modo de falla que este paso vino a matar.
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

  RETURN v_req_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_edge(text) IS
  'Invoca una edge function desde pg_cron. Base y credencial salen de Vault (nunca del repo). Falla ruidosa si falta un secreto.';

REVOKE ALL ON FUNCTION public.invoke_edge(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_edge(text) FROM anon, authenticated;

-- ─── Schedules ────────────────────────────────────────────────────────────────
-- `dispatch-auto-cancel` cada minuto: es el que convierte "el cliente no llegó"
-- en un no_show con actor 'system' (RPC de la migración 047).
SELECT cron.schedule(
  'dispatch-auto-cancel',
  '* * * * *',
  $$ SELECT public.invoke_edge('dispatch-auto-cancel'); $$
);

-- ⚠️ `dispatch-lifestyle-notifications` NO se agenda todavía, a propósito.
-- Al ejecutar D3 se verificó que esa function TAMPOCO está desplegada en el
-- proyecto; agendarla ahora crearía un job fallando 404 cada minuto — ruido
-- permanente que no prueba nada. Su schedule entra JUNTO con su deploy, y el
-- hueco que deja (qué recordatorios debieron enviarse y no se enviaron) se
-- dimensiona aparte. Cuando se despliegue:
--   SELECT cron.schedule('dispatch-lifestyle-notifications', '* * * * *',
--     $$ SELECT public.invoke_edge('dispatch-lifestyle-notifications'); $$);
