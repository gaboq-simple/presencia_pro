-- ─── S9-OPS-06 · Lo sin riel declarado, congelado en el corte ─────────────────
-- `expectedByRail` ya calculaba `sinRiel` —lo cobrado cuyo `payment_method` no es
-- ninguno de los tres rieles— y ya lo dejaba FUERA de la comparación, que es lo
-- correcto: no hay artefacto físico contra el cual contarlo. Pero ese número
-- **se evaporaba**: viajaba una sola vez en la respuesta de `createCorte`, se
-- pintaba mientras la card seguía montada y al recargar ya no existía.
--
-- Un número que sólo se ve una vez no es un dato: es un aviso. Y acá importa que
-- sea dato, porque desde este mismo paso el riel de una cita puede quedar SIN
-- DECLARAR a propósito (antes se inventaba `'efectivo'`), así que este cubo deja
-- de ser un residuo legado y pasa a ser una salida normal del día.
--
-- Se congela como columna y no se recalcula, por la misma razón que
-- `expected_cash` / `expected_card` son columnas: **un corte es una foto, no un
-- reporte**. Si mañana alguien completa una cita de hoy, el corte de hoy tiene
-- que seguir diciendo lo que se sabía cuando se contó.
--
-- NOT NULL DEFAULT 0: los 20 cortes que ya existen se quedan en 0, y es
-- verdadero — se firmaron cuando ningún cobro podía quedar sin riel, porque la
-- app siempre escribía uno.
ALTER TABLE public.caja_cortes
  ADD COLUMN IF NOT EXISTS sin_riel_snapshot numeric(10, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'caja_cortes_sin_riel_check'
  ) THEN
    ALTER TABLE public.caja_cortes
      ADD CONSTRAINT caja_cortes_sin_riel_check CHECK (sin_riel_snapshot >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.caja_cortes.sin_riel_snapshot IS
  'Cobrado del día cuyo riel NADIE declaró, congelado al firmar el corte (S9-OPS-06). Queda FUERA de expected_cash y expected_card a propósito: no hay artefacto físico contra el cual contarlo, así que meterlo en cualquiera de los dos inventaría un descuadre. Se muestra con su nombre — "sin riel declarado" es un dato; "faltan $X" sería una acusación.';
