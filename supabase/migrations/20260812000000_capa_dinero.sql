-- ─── Capa de dinero "el cuadre" — Paso D1: migración fundacional ──────────────
--
-- El esquema COMPLETO de la capa en una sola migración, sin que ninguna superficie
-- cambie todavía: nadie lee ni escribe estas columnas/tablas hasta D2–D5. Se hace
-- de una para no pagar migración de datos después (decisión 6 del plan).
--
-- Plan: docs/planes/capa-de-dinero.md · Tarea: SPRINT.md S7-DIN-01.
--
-- El eje del diseño: la comparación pantalla-vs-caja ocurre DENTRO de la app y el
-- descuadre es dato de primera clase, CON SIGNO. De ahí tres propiedades que el
-- schema impone y no deja a la aplicación:
--   · el riel (método de pago) es NOT NULL en toda captura nueva de dinero;
--   · el descuadre es una columna GENERADA (counted − expected): no se puede
--     guardar un descuadre que no cuadre con sus dos números;
--   · las filas de dinero son append-only por trigger — el pasado cerrado no se
--     reescribe en silencio (decisión 10). RLS no alcanza: service_role la bypassa.
--
-- Aplicada al proyecto demo vía MCP; este archivo queda como registro (patrón 046).

-- ─── 1. Columnas nuevas en tablas existentes ──────────────────────────────────

-- El riel de una cita cobrada. NULL = fila LEGADA (todo lo anterior a D2): la
-- obligatoriedad vive en el flujo de captura, no en el schema, porque las ~1,300
-- completadas que ya existen no deben romper ni mentir sobre cómo se pagaron.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS payment_method text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_payment_method_check') THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_payment_method_check
      CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia'));
  END IF;
END $$;

COMMENT ON COLUMN public.appointments.payment_method IS
  'Riel de cobro de la cita (efectivo/tarjeta/transferencia). NULL = fila legada anterior a D2; la obligatoriedad es del flujo de captura, no del schema.';

-- Fondo de cambio del cajón. Sin él el descuadre de efectivo carga un offset
-- sistemático (+fondo) todos los días y la señal se muere: el corte compararía
-- siempre "de más" por la misma cantidad y nadie miraría el número otra vez.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS caja_fondo numeric(10, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_caja_fondo_check') THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_caja_fondo_check CHECK (caja_fondo >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.businesses.caja_fondo IS
  'Fondo de cambio del cajón. El corte lo suma al esperado de efectivo; sin él el descuadre carga un offset sistemático. Se congela por corte en caja_cortes.fondo_snapshot.';

-- Instrumentación del riesgo terminal: "el dueño dejó de abrir la app". Hoy no
-- existe NINGUNA analítica de uso; sin este dato el fracaso más probable del
-- producto (el dueño ausente que nunca vuelve) sería invisible hasta la baja.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS owner_last_seen_at timestamptz;

COMMENT ON COLUMN public.businesses.owner_last_seen_at IS
  'Última vez que el dueño cargó su dashboard (best-effort, D6). Señal del riesgo terminal: sin moverse >7 días tras el primer mes.';

-- Modelo de pago del barbero. SIN UI en v1 a propósito (decisión 6): entra ahora
-- como configuración para que "la raya" (liquidación) no tenga que migrar datos
-- el día que se construya.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS compensation_model text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_compensation_model_check') THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_compensation_model_check
      CHECK (compensation_model IN ('comision', 'renta', 'sueldo'));
  END IF;
END $$;

COMMENT ON COLUMN public.staff.compensation_model IS
  'Modelo de pago del barbero (comision/renta/sueldo). Sin UI en v1: configuración adelantada para no migrar datos cuando se construya la raya.';

-- ─── 2. caja_movimientos — el dinero que NO pasa por la agenda ────────────────
-- Walk-in sin cita, venta de producto, salida por insumos o retiro. Sin esta tabla
-- ese dinero solo existe en el cajón, y entonces el descuadre positivo (ingreso sin
-- capturar) es indistinguible de un error de conteo.
CREATE TABLE IF NOT EXISTS public.caja_movimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('entrada', 'salida')),
  -- Techo alineado con MAX_TIP (apps/lifestyle/src/app/staff/actions.ts) y con el
  -- máximo real de numeric(10,2): un dedo de más en el teclado no entra como dato.
  amount         numeric(10, 2) NOT NULL CHECK (amount > 0 AND amount <= 99999999.99),
  -- Riel OBLIGATORIO (decisión 2). Jamás NULL en filas nuevas: por construcción,
  -- no por validación de la app. Un movimiento sin riel no se puede comparar
  -- contra ningún artefacto físico y por lo tanto no sirve para cuadrar.
  method         text NOT NULL CHECK (method IN ('efectivo', 'tarjeta', 'transferencia')),
  -- Concepto PAREADO con el tipo: una "salida por producto" o una "entrada por
  -- retiro" no significan nada. El CHECK impide la combinación, no la corrige.
  concept        text NOT NULL,
  note           text,
  staff_id       uuid NOT NULL REFERENCES public.staff(id),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  -- Contraentrada: anular es una fila NUEVA que apunta a la anulada, nunca un
  -- UPDATE. UNIQUE porque una fila solo puede anularse una vez (si no, dos
  -- contraentradas dejarían el neto en negativo sobre un movimiento que no existió).
  reverses_id    uuid UNIQUE REFERENCES public.caja_movimientos(id),
  -- Día LOCAL del negocio, calculado por la action (D4). NO es la fecha de
  -- created_at: un walk-in de las 21:40 en México es 03:40Z del día siguiente, y
  -- pertenece al día que lo cobró.
  occurred_on    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_movimientos_concept_check CHECK (
    (type = 'entrada' AND concept IN ('walkin', 'producto', 'otro')) OR
    (type = 'salida'  AND concept IN ('insumos', 'retiro', 'otro'))
  )
);

CREATE INDEX IF NOT EXISTS idx_caja_mov_biz_dia
  ON public.caja_movimientos (business_id, occurred_on);

COMMENT ON TABLE public.caja_movimientos IS
  'Dinero fuera de la agenda (walk-in, producto, insumos, retiro), firmado por staff. Append-only: anular = contraentrada con reverses_id, jamás UPDATE. occurred_on es el día LOCAL del negocio.';
COMMENT ON COLUMN public.caja_movimientos.note IS
  'Texto libre, corto. ⚠️ Fluye a Actividad (D4) → entra en la deuda de retención de PII (SPRINT, S6-SEC-01).';

-- ─── 3. caja_cortes — la verdad externa, congelada ────────────────────────────
-- Dos números leídos de artefactos físicos (el cajón y el voucher de la terminal)
-- capturados A CIEGAS, y la foto del esperado en ESE instante. expected_* NO se
-- recalcula jamás: si mañana se completa una cita de hoy, el corte de hoy no puede
-- cambiar retroactivamente — el corte dice lo que se sabía cuando se contó.
CREATE TABLE IF NOT EXISTS public.caja_cortes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  corte_date     date NOT NULL,
  staff_id       uuid NOT NULL REFERENCES public.staff(id),
  cash_counted   numeric(10, 2) NOT NULL CHECK (cash_counted >= 0),
  card_counted   numeric(10, 2) NOT NULL CHECK (card_counted >= 0),
  expected_cash  numeric(10, 2) NOT NULL,
  expected_card  numeric(10, 2) NOT NULL,
  -- El fondo VIGENTE al momento del corte: cambiar la config del negocio no puede
  -- reescribir el histórico de descuadres.
  fondo_snapshot numeric(10, 2) NOT NULL,
  -- CON SIGNO (decisión 4), y GENERADA: es imposible guardar un descuadre que no
  -- se derive de sus dos números. Negativo = falta efectivo; positivo = ingreso
  -- sin capturar. Nunca en valor absoluto.
  cash_diff      numeric(10, 2) GENERATED ALWAYS AS (cash_counted - expected_cash) STORED,
  card_diff      numeric(10, 2) GENERATED ALWAYS AS (card_counted - expected_card) STORED,
  -- Corregir un corte = fila NUEVA que apunta a la anterior. La última por día
  -- manda; la historia queda visible.
  replaces_id    uuid REFERENCES public.caja_cortes(id),
  -- Resultado del aviso al dueño (D5). Son las ÚNICAS columnas mutables de la
  -- tabla: el envío se resuelve después del INSERT y su resultado —entregado o
  -- no— tiene que poder escribirse sin reabrir el corte.
  notified_at    timestamptz,
  notify_error   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caja_cortes_biz_dia
  ON public.caja_cortes (business_id, corte_date DESC);

COMMENT ON TABLE public.caja_cortes IS
  'Corte de caja a ciegas: contado (artefactos físicos) vs esperado CONGELADO al instante del corte, con descuadre generado y con signo. Inmutable salvo notified_at/notify_error; corregir = fila nueva con replaces_id.';

-- ─── 4. Append-only real (bloquea incluso a service_role) ─────────────────────
-- RLS no sirve para esto: service_role la bypassa y la app entra por ahí. Un
-- trigger BEFORE que RAISE es lo único que hace las filas de dinero inmutables
-- para todos. Misma técnica que trg_appt_audit_immutable (migración 045).
--
-- ⚠️ Misma tensión que el audit con la purga por retención: este RAISE bloquea
-- DELETE para TODOS. Quien implemente la retención (deuda 🟠 del SPRINT, que ya
-- nombra estas dos tablas) debe diseñar primero un bypass CONTROLADO y auditado.
CREATE OR REPLACE FUNCTION public.caja_movimientos_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'caja_movimientos es append-only: % no permitido (anular = contraentrada con reverses_id)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_mov_immutable ON public.caja_movimientos;
CREATE TRIGGER trg_caja_mov_immutable
BEFORE UPDATE OR DELETE ON public.caja_movimientos
FOR EACH ROW
EXECUTE FUNCTION public.caja_movimientos_immutable();

-- El corte es inmutable con UNA excepción: el resultado del aviso. Se compara
-- OLD/NEW columna por columna en vez de listar "lo que no se puede tocar" — así,
-- si mañana alguien agrega una columna, nace inmutable por omisión (fail-closed)
-- en lugar de quedar mutable por olvido.
--
-- cash_diff/card_diff se EXCLUYEN de la comparación, y no es una excepción a la
-- inmutabilidad: en un trigger BEFORE las columnas GENERATED todavía no están
-- calculadas (NEW las trae NULL; Postgres las computa después de los BEFORE ROW),
-- así que compararlas daría siempre "cambió" y ni el aviso podría escribirse.
-- No se pierde nada: se derivan de counted/expected, que sí se comparan — si esos
-- no cambian, el descuadre tampoco puede.
-- ⚠️ Si se agrega otra columna GENERATED a esta tabla, hay que sumarla acá.
CREATE OR REPLACE FUNCTION public.caja_cortes_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'caja_cortes es append-only: DELETE no permitido (corregir = fila nueva con replaces_id)';
  END IF;

  IF to_jsonb(NEW) - 'notified_at' - 'notify_error' - 'cash_diff' - 'card_diff'
     IS DISTINCT FROM
     to_jsonb(OLD) - 'notified_at' - 'notify_error' - 'cash_diff' - 'card_diff' THEN
    RAISE EXCEPTION 'caja_cortes: solo notified_at/notify_error son mutables (corregir un corte = fila nueva con replaces_id)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_cortes_immutable ON public.caja_cortes;
CREATE TRIGGER trg_caja_cortes_immutable
BEFORE UPDATE OR DELETE ON public.caja_cortes
FOR EACH ROW
EXECUTE FUNCTION public.caja_cortes_immutable();

-- ─── 5. RLS deny-all (patrón appointment_tips) ────────────────────────────────
-- RLS habilitada y CERO policies, a propósito: el tráfico legítimo entra por
-- service_role (que la bypassa) con el gate de sesión en la server action. Ninguna
-- sesión de browser —anon o authenticated, incluido el dueño logueado por email—
-- puede leer estas tablas por PostgREST ni recibirlas por Realtime.
-- (La publicación supabase_realtime no es FOR ALL TABLES y está vacía: las tablas
-- nuevas nacen fuera de Realtime sin necesidad de excluirlas.)
ALTER TABLE public.caja_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_cortes      ENABLE ROW LEVEL SECURITY;
