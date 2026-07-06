-- ─── Migration 047 — Atribución nominativa del CRON (Fase 2c-ii, parte 1/2) ─────
--
-- Activa el GUC `app.actor_type` que 045 dejó dormido (líneas 62-63, 96-102 de
-- `log_appointment_audit`) para el flujo automático del cron `dispatch-auto-cancel`.
-- Hoy ese UPDATE (status→no_show) cae en `actor_type='unknown'` porque el trigger
-- solo infiere `bot` en `INSERT source='bot'`. Con este RPC pasa a `'system'`.
--
-- ⚠️ POR QUÉ UN RPC (no un set_config suelto): todo muta vía supabase-js/PostgREST
-- sobre un POOLER de conexiones. Un `set_config(...)` a nivel sesión se filtra a la
-- próxima request de OTRO cliente → atribución cruzada (peor que 'unknown'). La única
-- forma segura es `set_config(..., is_local => true)` (transaction-local) + la mutación
-- en la MISMA transacción. PostgREST envuelve cada `.rpc()` en un BEGIN…COMMIT, y una
-- función plpgsql corre en una sola transacción: el `set_config` local y el UPDATE
-- viven juntos, el AFTER-trigger de 045 lee el GUC, y al COMMIT se limpia solo. Nunca
-- se filtra. (Ver bitácora 2c-i: el `set_config` ingenuo NO sirve con el pooler.)
--
-- El bot (cancel/confirm/retraso) se ataca en la migración 048 con el mismo patrón,
-- después de verificar este checkpoint aislado.

-- ─── mark_appointment_no_show ──────────────────────────────────────────────────
-- Reemplaza el `.update({status:'no_show'}).eq('id').eq('status','confirmed')` del
-- cron. El guard atómico `status='confirmed'` se PRESERVA dentro del RPC (solo marca
-- si sigue confirmada → si otra instancia del cron ya la tomó, no hace nada).
-- Retorna TRUE si la marcó, FALSE si ya estaba tomada (mismo semantic que el
-- `if (!updated || updated.length === 0) return false` de hoy).
CREATE OR REPLACE FUNCTION public.mark_appointment_no_show(p_appointment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE                       -- escribe: NO puede ser STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_marked boolean;
BEGIN
  -- GUC transaction-local: visible para el AFTER-trigger de 045 en esta misma txn,
  -- se descarta al COMMIT. is_local=true es la garantía anti-filtración del pooler.
  PERFORM set_config('app.actor_type', 'system', true);

  UPDATE public.appointments
     SET status = 'no_show'
   WHERE id = p_appointment_id
     AND status = 'confirmed'   -- guard atómico: idéntico al del cron actual
  RETURNING true INTO v_marked;

  RETURN COALESCE(v_marked, false);
END;
$$;

COMMENT ON FUNCTION public.mark_appointment_no_show(uuid) IS
  'Cron auto-cancel: marca no_show con actor_type=system (GUC transaction-local). Guard status=confirmed atómico. Retorna false si ya fue tomada.';

-- ─── Privilegios ───────────────────────────────────────────────────────────────
-- Solo el cron (service_role) la invoca. Se le quita a anon/authenticated para que
-- el panel/público no pueda marcar no_show por esta vía.
REVOKE ALL ON FUNCTION public.mark_appointment_no_show(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_appointment_no_show(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_appointment_no_show(uuid) TO service_role;
