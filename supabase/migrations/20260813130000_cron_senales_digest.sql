-- ─── Capa de dinero — Paso D7: el digest del operador ────────────────────────
--
-- Lunes 08:00 CDMX (14:00 UTC): un correo a Gabriel con las cuatro señales de la
-- tabla "Cómo se ve el fracaso". Reusa `invoke_app` (D6) — mismo destino (la app
-- en Vercel) y mismo secreto, así que no hace falta una función nueva.
--
-- El lunes temprano y no el domingo: la ventana de 14 días que leen las señales
-- ya tiene la semana completa cerrada, y el correo llega cuando hay margen para
-- hacer algo con lo que dice.
--
-- Plan: docs/planes/capa-de-dinero.md · Tarea: SPRINT.md S7-DIN-01 (D7).

SELECT cron.schedule(
  'senales-digest',
  '0 14 * * 1',
  $$ SELECT public.invoke_app('/api/internal/senales-digest'); $$
);
