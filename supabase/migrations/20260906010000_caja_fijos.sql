-- ─── Los gastos fijos: un recordatorio, NO un dinero ──────────────────────────
-- M4 de S10-ASIS-01.
--
-- LA OBJECIÓN QUE ESTE DISEÑO RESPONDE (Gabriel, 2026-09-06): eliminar la tarea
-- repetitiva está bien, pero un gasto recurrente que se configura una vez y
-- desaparece es PEOR que anotarlo a mano — cuando cambie, no se encuentra y nadie
-- se acuerda de que existía.
--
-- POR ESO EL FIJO NUNCA SE REGISTRA SOLO. No hay cron, no hay job, no hay INSERT
-- automático en `caja_movimientos`. Un fijo VENCE y aparece en la cola del día;
-- una persona lo confirma con un tap y ESE gesto escribe el movimiento, con el
-- monto que se haya tecleado. Dos razones, y la primera es innegociable:
--
--   1. `caja_movimientos` AFIRMA UN HECHO DEL MUNDO. Escribir "salió la renta"
--      porque es día 3 es fabricar evidencia — la misma regla dura que hizo que
--      `sent_at` dejara de escribirse a ciegas y que el walk-in naciera con su
--      `arrived_at` real. Un mes la renta se paga el 5, otro no se paga, y el
--      sistema no tiene forma de saberlo. La automatización que ESCRIBE sola es
--      la que oculta; la que RECUERDA, exhibe.
--   2. Lo que hay que confirmar cada período es imposible de olvidar, porque
--      vuelve a tocar la puerta. Ahí está la respuesta a la objeción: el fijo no
--      se puede esconder, y el monto llega editable en el mismo lugar donde uno
--      se da cuenta de que subió.
--
-- ESTA TABLA NO GUARDA PLATA. Guarda una intención: cuánto suele ser, cada
-- cuánto, y con qué riel se suele pagar. Lo que de verdad pasó vive —como
-- siempre— en `caja_movimientos`, append-only y firmado. Por eso "cuándo se pagó
-- por última vez y cuánto" NO es una columna de acá: se DERIVA de los movimientos
-- por `fijo_id`. Un campo cacheado podría mentir; una derivación, no.

-- ─── 1. La plantilla ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.caja_fijos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Concepto de SALIDA, espejo del CHECK de `caja_movimientos` del lado que
  -- aplica: un fijo es un costo que se repite, y una ENTRADA que se repite sola
  -- no es un gasto fijo — es facturación, que se registra cuando ocurre.
  concept       text NOT NULL CHECK (concept IN (
                  'insumos', 'renta', 'servicios', 'nomina', 'mantenimiento', 'retiro', 'otro'
                )),
  -- Cómo lo llama el negocio ("Renta del local", "Luz", "Internet"). Es lo único
  -- que distingue dos fijos del mismo concepto.
  label         text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),

  -- SUGERIDO, nunca impuesto: llega pre-llenado y editable al confirmar. Si la
  -- persona teclea otro monto, el movimiento guarda el tecleado y esta columna se
  -- actualiza — el ajuste ocurre donde uno se dio cuenta, no en un menú aparte.
  amount_sugerido numeric(10, 2) NOT NULL CHECK (amount_sugerido > 0 AND amount_sugerido <= 99999999.99),
  method_sugerido text NOT NULL CHECK (method_sugerido IN ('efectivo', 'tarjeta', 'transferencia')),

  cadencia      text NOT NULL CHECK (cadencia IN ('mensual', 'semanal')),
  -- Mensual: 1..31, y el día 31 se resuelve al último día del mes que toque (el
  -- clamp vive en `lib/fijos.ts`, con el mismo criterio que `sumarMeses`).
  dia_del_mes   smallint CHECK (dia_del_mes BETWEEN 1 AND 31),
  -- Semanal: 0=domingo, misma convención que `staff_availability.day_of_week`.
  dia_de_semana smallint CHECK (dia_de_semana BETWEEN 0 AND 6),

  -- Desactivar y NO borrar: los movimientos que ya apuntan a este fijo tienen que
  -- poder seguir explicando de dónde salieron.
  active        boolean NOT NULL DEFAULT true,

  created_by    uuid NOT NULL REFERENCES public.staff(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- La cadencia y su día van PAREADOS: un fijo mensual sin día del mes no sabe
  -- cuándo vencer, y uno que trae los dos días no sabe cuál mirar.
  -- OJO con el nombre: el CHECK inline de la columna `cadencia` YA se autonombra
  -- `caja_fijos_cadencia_check`, así que este —el que aparea cadencia con su
  -- día— tiene que llamarse distinto o Postgres rebota con 42710.
  CONSTRAINT caja_fijos_cadencia_dia_check CHECK (
    (cadencia = 'mensual' AND dia_del_mes IS NOT NULL AND dia_de_semana IS NULL) OR
    (cadencia = 'semanal' AND dia_de_semana IS NOT NULL AND dia_del_mes IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS caja_fijos_business_activo_idx
  ON public.caja_fijos (business_id) WHERE active;

-- ─── 2. El movimiento sabe de qué fijo salió ──────────────────────────────────
-- Nullable: la enorme mayoría de los movimientos no vienen de un fijo. Su único
-- trabajo es permitir DERIVAR "cuándo se pagó por última vez y cuánto" de los
-- hechos, en vez de guardarlo en una columna que se puede desactualizar.
-- ON DELETE SET NULL y no CASCADE: si algún día se borra una plantilla, el
-- movimiento —que es plata que se movió de verdad— no se va con ella.

ALTER TABLE public.caja_movimientos
  ADD COLUMN IF NOT EXISTS fijo_id uuid REFERENCES public.caja_fijos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS caja_movimientos_fijo_idx
  ON public.caja_movimientos (fijo_id, occurred_on DESC) WHERE fijo_id IS NOT NULL;

COMMENT ON COLUMN public.caja_movimientos.fijo_id IS
  'De qué gasto fijo salió este movimiento, si salió de alguno. Es lo que permite '
  'derivar el último pago real de una plantilla sin guardarlo en una columna que '
  'podria quedar desactualizada. NULL = movimiento suelto (el caso normal).';

-- ─── 3. RLS deny-all (mismo patrón que el resto de la capa de dinero) ─────────
-- RLS habilitada y CERO policies: el tráfico legítimo entra por service_role con
-- el gate de sesión en la server action. Ninguna sesión de browser puede leer
-- esta tabla por PostgREST ni recibirla por Realtime (la publicación
-- supabase_realtime no es FOR ALL TABLES, así que nace fuera).

ALTER TABLE public.caja_fijos ENABLE ROW LEVEL SECURITY;

-- ─── 4. Lo que esta tabla NO tiene, y es a propósito ──────────────────────────
--   · NO tiene `ultimo_pago_at` ni `ultimo_monto`: se derivan de los movimientos.
--   · NO tiene `proximo_vencimiento`: se CALCULA (`lib/fijos.ts`) a partir de la
--     cadencia y del último movimiento. Una fecha guardada exige a alguien que la
--     mueva, y el día que nadie la mueva la tabla va a mentir en silencio.
--   · NO tiene trigger que inserte movimientos. Ver el encabezado.
