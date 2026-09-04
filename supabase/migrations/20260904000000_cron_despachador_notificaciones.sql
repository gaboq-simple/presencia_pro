-- ─── El cron del despachador de notificaciones (S7-NOTIF-01) ──────────────────
-- Agenda `dispatch-lifestyle-notifications`, que quedó SIN agendar en
-- `20260813000000_crons_versionados.sql` a propósito: la function no estaba
-- desplegada, y un job pegándole cada minuto habría sido un 404 permanente que
-- no prueba nada. Aquella migración dejó el `cron.schedule` comentado a la
-- espera; esto es ese comentario, cobrado.
--
-- 🔴 ORDEN OBLIGATORIO — esta migración va DESPUÉS del deploy, nunca antes:
--
--   1. `supabase functions deploy dispatch-lifestyle-notifications`
--   2. verificar que responde (una invocación manual, o `list_edge_functions`)
--   3. recién entonces, aplicar esta migración
--
-- Al revés se recrea exactamente el ruido que la nota de D3 quiso evitar. El
-- deploy es una acción de Gabriel; esta migración también.
--
-- Qué empieza a pasar cuando esto corre: la cola de `scheduled_notifications`
-- —que hoy tiene 0 filas y desde el primer cliente real va a tener
-- recordatorios— empieza a DESPACHARSE. Es decir, el sistema empieza a mandarle
-- WhatsApp a personas por su cuenta. Los dos tipos proactivos respetan la baja y
-- el consentimiento desde el guard de esta misma tanda (`supresion.ts`); los
-- siete de utilidad salen siempre, que es la regla de niveles de
-- `docs/planes/permiso.md`.
--
-- Para desagendarlo: SELECT cron.unschedule('dispatch-lifestyle-notifications');

SELECT cron.schedule(
  'dispatch-lifestyle-notifications',
  '* * * * *',
  $$ SELECT public.invoke_edge('dispatch-lifestyle-notifications'); $$
);
