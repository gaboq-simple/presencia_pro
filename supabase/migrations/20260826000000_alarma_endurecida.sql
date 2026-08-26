-- ─── S8-OPS-04 · Cerrar la alarma ─────────────────────────────────────────────
-- Tres agujeros que S8-OPS-03 midió en vivo, cerrados de una vez. Ninguno es una
-- hipótesis: los tres salieron de una contraprueba con relojes anotados.
--
-- 1. LA COLISIÓN. `verificar-invocaciones` es `*/5` y `alarma-invocaciones` era
--    `*/15`, así que CADA corrida de la alarma coincidía con una del verificador
--    —no a veces: siempre, por construcción de los dos cron—. pg_cron las arranca
--    en paralelo; medido el 2026-08-25, la alarma leyó 7 ms después de que
--    arrancara el verificador y 2 s antes de que commiteara, vio la fila todavía
--    en `pendiente`, su filtro la descartó y salió VERDE sobre un 401 recién
--    verificado. El rojo llegó 15 minutos tarde.
--    Se arregla desfasándola (`7,22,37,52`), que elimina la colisión por
--    CONSTRUCCIÓN y no por probabilidad: 7 no es múltiplo de 5 y ninguno de los
--    cuatro minutos cae en un tick del verificador.
--
-- 2. `pendiente` DEJABA DE SER UN PROBLEMA. La alarma filtraba
--    `veredicto <> 'pendiente'` — razonable cuando el verificador vive, porque él
--    resuelve toda pendiente en a lo sumo dos períodos. Pero si el verificador se
--    detiene, TODO queda pendiente para siempre y la alarma se queda verde
--    mirando un riel muerto. Ahora una verificación estancada es ROJA.
--
-- 3. NADIE VIGILABA AL VIGILANTE. Si el job del verificador muere, no hay quien
--    lo diga. Ahora la alarma mira su última corrida.
--
-- Los dos textos nuevos son DISTINTOS a propósito: "destino en falla" es un
-- problema de la punta (la ruta o la edge function responden mal) y "verificación
-- estancada" / "verificador detenido" son problemas del RIEL (pg_net, pg_cron).
-- El dueño del problema no es el mismo, y una alarma que los mezcla obliga a
-- diagnosticar antes de saber a quién llamar.
--
-- El umbral NO es un número inventado: sale del período del verificador, leído
-- de su propio `cron.job.schedule`. Ver `periodo_verificador()`.

-- ─── El período del verificador, como dato y no como suposición ───────────────
-- Todo umbral de este archivo se mide en múltiplos de ESTE número. Si mañana el
-- verificador pasa a `*/2` o a `*/10`, los umbrales lo siguen solos y nadie tiene
-- que acordarse de dos lugares.
--
-- Falla RUIDOSA si no puede leerlo: un umbral adivinado es peor que ninguno,
-- porque se ve igual de firme y no lo es.
CREATE OR REPLACE FUNCTION public.periodo_verificador()
RETURNS interval
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  v_sched   text;
  v_minutos int;
BEGIN
  SELECT schedule INTO v_sched
    FROM cron.job WHERE jobname = 'verificar-invocaciones';

  IF v_sched IS NULL THEN
    RAISE EXCEPTION 'periodo_verificador: no existe el job verificar-invocaciones';
  END IF;

  -- Solo se acepta la forma `*/N` en el campo de minutos, que es la que el job
  -- usa. Cualquier otra cosa se rechaza en vez de interpretarse a medias.
  v_minutos := NULLIF((regexp_match(v_sched, '^\*/([0-9]+) \* \* \* \*$'))[1], '')::int;

  IF v_minutos IS NULL OR v_minutos <= 0 THEN
    RAISE EXCEPTION 'periodo_verificador: no sé leer el schedule "%" — se esperaba la forma */N * * * *', v_sched;
  END IF;

  RETURN make_interval(mins => v_minutos);
END;
$$;

COMMENT ON FUNCTION public.periodo_verificador() IS
  'El período de verificar-invocaciones leído de su propio cron.job.schedule. Fuente ÚNICA de los umbrales de alarma_invocaciones(): si el verificador cambia de frecuencia, los umbrales lo siguen solos. Falla ruidosa si no puede leerlo — un umbral adivinado se ve igual de firme que uno derivado, y no lo es.';

REVOKE ALL ON FUNCTION public.periodo_verificador() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.periodo_verificador() FROM anon, authenticated;

-- ─── La alarma, con las tres miradas ──────────────────────────────────────────
-- Sigue sin escribir nada (su RAISE revertiría lo que escribiera) y sigue
-- reflejando el estado ACTUAL, no el historial: se pone verde sola cuando el riel
-- vuelve a estar sano, sin que nadie acuse recibo.
--
-- Las tres condiciones se acumulan en UN solo mensaje en vez de cortar en la
-- primera: si el verificador está detenido Y además un destino viene fallando,
-- esconder el segundo detrás del primero obligaría a arreglar dos veces.
CREATE OR REPLACE FUNCTION public.alarma_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  v_periodo   interval := public.periodo_verificador();
  v_ultima    timestamptz;
  v_problemas text[] := '{}';
  v_detalle   text;
  v_cuantos   integer;
BEGIN
  -- ── (a) ¿Corrió el verificador? ────────────────────────────────────────────
  -- Se tolera UN tick perdido (un reinicio, una corrida lenta); dos seguidos ya
  -- no son ruido. Solo cuentan las corridas `succeeded`: un verificador que
  -- corre y falla no está verificando nada.
  SELECT max(d.start_time) INTO v_ultima
    FROM cron.job_run_details d
    JOIN cron.job j USING (jobid)
   WHERE j.jobname = 'verificar-invocaciones'
     AND d.status  = 'succeeded';

  IF v_ultima IS NULL THEN
    v_problemas := v_problemas || format(
      'verificador detenido → sin ninguna corrida registrada (esperada cada %s)', v_periodo);
  ELSIF v_ultima < now() - (2 * v_periodo) THEN
    v_problemas := v_problemas || format(
      'verificador detenido → última corrida %s, hace %s (esperada cada %s)',
      to_char(v_ultima, 'YYYY-MM-DD HH24:MI UTC'),
      date_trunc('second', now() - v_ultima), v_periodo);
  END IF;

  -- ── (b) ¿Hay verificaciones estancadas? ────────────────────────────────────
  -- El verificador da por perdida una petición a los 2 períodos y la marca
  -- `sin_respuesta` (que ya cuenta como falla en (c)). Por lo tanto una fila que
  -- sigue `pendiente` al TERCER período no está esperando: nadie la miró. El
  -- tercer período es el margen para que la corrida que le tocaba haya ocurrido.
  SELECT count(*),
         string_agg(format('%s (req_id %s, encolada %s)',
                           destino, req_id, to_char(encolada_at, 'YYYY-MM-DD HH24:MI UTC')),
                    '; ' ORDER BY encolada_at)
    INTO v_cuantos, v_detalle
    FROM public.cron_invocaciones
   WHERE veredicto = 'pendiente'
     AND encolada_at < now() - (3 * v_periodo);

  IF v_cuantos > 0 THEN
    v_problemas := v_problemas || format(
      'verificación estancada → %s invocación(es) sin resolver tras %s: %s',
      v_cuantos, 3 * v_periodo, v_detalle);
  END IF;

  -- ── (c) ¿Algún destino con su última invocación en falla? ──────────────────
  -- La mirada original, intacta.
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
    INTO v_cuantos, v_detalle
    FROM ultima
   WHERE veredicto <> 'ok';

  IF v_cuantos > 0 THEN
    v_problemas := v_problemas || format(
      'destino en falla → %s destino(s) con la última invocación en falla: %s',
      v_cuantos, v_detalle);
  END IF;

  IF array_length(v_problemas, 1) > 0 THEN
    RAISE EXCEPTION 'cron: %', array_to_string(v_problemas, ' | ');
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.alarma_invocaciones() IS
  'Falla ruidosa si el riel de invocaciones no está sano, con TRES miradas y tres textos distintos porque el dueño del problema no es el mismo: "verificador detenido" (el job de verificación no corrió), "verificación estancada" (peticiones que nadie resolvió) y "destino en falla" (la última invocación de un destino fue no-2xx o sin respuesta). Los umbrales derivan de periodo_verificador(), no de números fijos. No escribe nada (si escribiera, su propio RAISE lo revertiría) y refleja el estado ACTUAL: se pone verde sola cuando el riel vuelve a estar sano.';

REVOKE ALL ON FUNCTION public.alarma_invocaciones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alarma_invocaciones() FROM anon, authenticated;

-- ─── El desfase ───────────────────────────────────────────────────────────────
-- `7,22,37,52` y no `*/15`: cada 15 minutos igual que antes, pero a 2 minutos del
-- tick del verificador en vez de encima. Ninguno de los cuatro minutos es
-- múltiplo de 5, así que la colisión no puede volver mientras el verificador siga
-- en `*/5` — y si cambiara de período, `periodo_verificador()` seguiría siendo
-- correcta para los umbrales, pero ESTE desfase habría que revisarlo a mano. Se
-- dice acá para que quien lo cambie lo lea.
--
-- LO QUE LA ALARMA PROMETE DE VERDAD, y es lo que hay que escribir en vez de un
-- número redondo: un fallo se ve, como máximo, un período de verificador (hasta
-- 5 min hasta que el veredicto se graba) más un período de alarma (hasta 15 min
-- hasta que alguien lo mire) después de la invocación. **Peor caso ~20 minutos,
-- típico ~10.** El comentario de `20260820000000_meta_aviso_cron.sql` decía
-- "≤15 min" y era falso incluso antes de la colisión: 15 es el período de la
-- alarma, no la latencia del sistema.
SELECT cron.unschedule('alarma-invocaciones');

SELECT cron.schedule(
  'alarma-invocaciones',
  '7,22,37,52 * * * *',
  $$ SELECT public.alarma_invocaciones(); $$
);
