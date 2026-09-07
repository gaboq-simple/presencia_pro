-- ─── Caja: la salida deja de ser "insumos, retiro u otro" ─────────────────────
-- M3 de S10-ASIS-01.
--
-- EL DEFECTO, MEDIDO Y NO SUPUESTO. El catálogo de conceptos ya era cerrado, pero
-- del lado de las SALIDAS era tan grueso que colapsaba hechos distintos en la
-- misma etiqueta: pagar la renta se registraba como `retiro`, y el propio
-- placeholder de la nota lo decía literal —`lib/caja.ts:69` → "Ej. pago de la
-- renta"—. Un RETIRO es el dueño sacando efectivo del cajón; la RENTA es un costo
-- del negocio. Con la misma palabra, ninguna lectura por concepto significa nada:
-- "salió $12,000 en retiros" puede ser el local o puede ser el bolsillo.
--
-- LAS ENTRADAS NO CAMBIAN. `walkin` / `producto` / `otro` ya distinguen lo que hay
-- que distinguir del lado del dinero que entra, y agregar opciones donde no hay
-- confusión solo cuesta tiempo de lectura.
--
-- SIN BACKFILL, por la misma razón de siempre: las filas viejas conservan su
-- concepto viejo. Reclasificar hacia atrás un `retiro` como `renta` sería decidir
-- hoy en qué se gastó ayer, y eso no se sabe — se supone. Un dato impreciso que se
-- nota es mejor que uno preciso que alguien inventó.
--
-- LOS CÓDIGOS SON ESTABLES Y DISTINTOS DE SU ETIQUETA (cimiento fiscal, decisión
-- de Gabriel 2026-09-06: hoy esto es flujo de caja operativo, NO contabilidad
-- fiscal). Se guarda `renta`, se muestra "Renta": renombrar la etiqueta mañana no
-- reescribe la historia. A qué cubo fiscal caería cada código queda anotado acá
-- —y en ningún otro lado, porque es una nota para quien lo necesite, no un campo:
--   insumos       → costo de venta / mercancía y consumibles
--   renta         → arrendamiento
--   servicios     → luz, agua, internet, teléfono
--   nomina        → sueldos, adelantos y liquidaciones al personal
--   mantenimiento → conservación del local y del equipo
--   retiro        → disposición del titular (NO es un gasto del negocio)
--   otro          → sin clasificar; su nota es lo único que lo explica
-- Nada de RFC, CFDI, folios, IVA ni deducibilidad entra acá. Si algún día entra,
-- entra con su propio plan.

ALTER TABLE public.caja_movimientos
  DROP CONSTRAINT IF EXISTS caja_movimientos_concept_check;

ALTER TABLE public.caja_movimientos
  ADD CONSTRAINT caja_movimientos_concept_check CHECK (
    (type = 'entrada' AND concept IN ('walkin', 'producto', 'otro')) OR
    (type = 'salida'  AND concept IN (
      'insumos', 'renta', 'servicios', 'nomina', 'mantenimiento', 'retiro', 'otro'
    ))
  );

COMMENT ON COLUMN public.caja_movimientos.concept IS
  'Concepto PAREADO con el tipo (CHECK caja_movimientos_concept_check). Código '
  'estable, distinto de su etiqueta visible: renombrar la etiqueta no reescribe '
  'la historia. El espejo en la app vive en lib/caja.ts (CONCEPTOS_POR_TIPO) y si '
  'divergen la fila la rebota la BD.';
