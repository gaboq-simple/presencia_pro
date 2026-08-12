-- ─── Migration 056 — Atribución del BOT al CREAR cita (residuo de la Fase 2c-ii) ─
--
-- Cierra el último hueco de `actor_type='unknown'` por SESIÓN del audit de citas:
-- el INSERT del bot. El trigger de 045 infiere 'bot' SOLO en `INSERT source='bot'`,
-- así que la cita de WALK-IN del bot (`confirmed.ts` escribe source='walkin' cuando
-- el cliente pide "ahorita") caía en 'unknown' → en Actividad se lee "Acción sin
-- identificar" para algo que sí tiene autor conocido.
--
-- Por qué NO se resolvió ensanchando la inferencia del trigger a source='walkin':
-- 'walkin' NO identifica al autor. Lo escriben tres orígenes distintos —el bot, el
-- panel (createAssistantAppointment, que ya se atribuye por las columnas 023) y SQL
-- directo (`scripts/seed-demo-densa.sql` siembra 203 walk-ins sin actor)—. Ensanchar
-- la inferencia firmaría "lo hizo el bot" sobre filas sembradas por SQL, y además
-- sobrevivirían a la limpieza del seed (que borra los 'unknown' pero preserva los
-- 'bot'). Atribución fabricada = exactamente lo que 2c-i se prohibió ("actor ausente
-- NO es error: es información"). Acá se atribuye en POSITIVO: solo el bot pasa por
-- esta función, y por eso solo el bot queda firmado.
--
-- Mismo patrón probado en 047 (cron) y 048 (bot update): set_config(..., is_local=true)
-- + mutación ATÓMICOS dentro de una función invocada por `.rpc()` (PostgREST = 1 txn)
-- → el AFTER-trigger de 045 lee el GUC y al COMMIT se limpia solo (nunca se filtra
-- en el pooler).

-- ─── bot_create_appointment — la ÚNICA vía de alta de cita del bot ──────────────
-- Reemplaza el `.insert({...})` de `confirmed.ts` (el único INSERT de appointments
-- de todo el engine). Candados, en el espíritu de 048:
--   · source ∈ ('bot','walkin')  — los dos únicos que el bot escribe.
--   · status = 'confirmed' fijo  — el bot no crea citas en ningún otro estado.
-- Lo que NO cambia: la coherencia de tenant (trigger 052) y el constraint de
-- solapamiento siguen corriendo — SECURITY DEFINER saltea RLS, no triggers ni
-- constraints. Las excepciones NO se capturan a propósito: el call-site distingue
-- 23P01 (solapamiento) y 23505 (unicidad) por su SQLSTATE para ofrecer otro horario.
CREATE OR REPLACE FUNCTION public.bot_create_appointment(
  p_business_id  uuid,
  p_staff_id     uuid,
  p_service_id   uuid,
  p_customer_id  uuid,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_source       text,
  p_booking_name text
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
  IF p_source NOT IN ('bot', 'walkin') THEN
    RAISE EXCEPTION 'bot_create_appointment: source no permitido: %', p_source;
  END IF;

  PERFORM set_config('app.actor_type', 'bot', true);

  INSERT INTO public.appointments (
    business_id, staff_id, service_id, customer_id,
    starts_at, ends_at, status, source, booking_name
  ) VALUES (
    p_business_id, p_staff_id, p_service_id, p_customer_id,
    p_starts_at, p_ends_at, 'confirmed', p_source, p_booking_name
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.bot_create_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text) IS
  'Bot: alta de cita (source bot/walkin, status confirmed) con actor_type=bot (GUC transaction-local). Reemplaza el .insert() directo del bot; cierra el residuo walk-in→unknown de la Fase 2c-ii.';

REVOKE ALL ON FUNCTION public.bot_create_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bot_create_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_create_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text) TO service_role;
