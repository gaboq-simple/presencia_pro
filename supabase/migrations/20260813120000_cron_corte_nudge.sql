-- ─── Capa de dinero — Paso D6: el loop diario del corte ──────────────────────
--
-- A las 23:00 de México, un barrido pregunta qué negocios cerraron el día sin
-- contar la caja y le avisa al dueño. El hábito del corte es la señal 1 de la
-- tabla "Cómo se ve el fracaso" del plan ("el ritual no prende"): si depende de
-- que alguien se acuerde todos los días, no prende.
--
-- Por qué una función NUEVA y no `invoke_edge`: el destino es distinto en todo.
-- `invoke_edge` apunta a las edge functions del propio Supabase con la
-- credencial del proyecto; el nudge vive en la APP (Vercel), en
-- `app/api/internal/corte-nudge`, y se autentica con `CRON_SECRET`. Reusar la
-- función anterior obligaría a que un solo secreto sirviera para dos sistemas
-- que no tienen por qué compartirlo.
--
-- Misma postura que D3 en lo que importa: los secretos NO viven en el repo
-- (Vault los resuelve en tiempo de ejecución) y la falta de uno es una falla
-- RUIDOSA, no un cron mudo.
--
-- Plan: docs/planes/capa-de-dinero.md · Tarea: SPRINT.md S7-DIN-01 (D6).

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

  RETURN v_req_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_app(text) IS
  'Invoca una ruta interna de la app (Vercel) desde pg_cron. Base y CRON_SECRET salen de Vault, nunca del repo. Falla ruidosa si falta un secreto.';

REVOKE ALL ON FUNCTION public.invoke_app(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_app(text) FROM anon, authenticated;

-- ─── Schedule ─────────────────────────────────────────────────────────────────
-- 05:00 UTC = 23:00 CDMX. México no tiene horario de verano desde 2022, así que
-- el offset es fijo (UTC−6) y esta hora no se corre sola dos veces al año.
--
-- Por qué 23:00 y no medianoche: el nudge tiene que llegar cuando todavía se
-- puede hacer algo —el local acaba de cerrar y el cajón sigue ahí—, no cuando el
-- día ya cambió y el conteo pertenecería a otra fecha.
--
-- Un solo disparo por día para TODOS los negocios: la ruta barre y decide por
-- negocio con su propia tz. Cuando haya negocios en husos distintos habrá que
-- agendar por huso — anotado, no construido (hoy hay uno).
SELECT cron.schedule(
  'corte-nudge',
  '0 5 * * *',
  $$ SELECT public.invoke_app('/api/internal/corte-nudge'); $$
);
