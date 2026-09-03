# Costos, producto y su reflejo en las vistas (R3 · `S9-OPS-09`)

> **Fase:** relevamiento. Cero código de producción, cero migraciones, cero `push`.
> **Base:** `main` en `9786bb9051baee0529a493729206dd109c119d0e` (`git reset --hard
> origin/main` + `git rev-parse HEAD`, árbol limpio). **Suite:** 898 tests / 891
> asserts / 0 fail (`npm test`, 130 s).
> **Modelo:** este documento lo ejecuta Claude Code. Los pasos de la sección final
> están troceados para que Opus los ejecute sin volver a leer la conversación.
>
> **Cómo leer las marcas.** `verificado` = hay un comando en la línea que lo probó
> contra este HEAD o contra prod. `verificar` = hipótesis, no evidencia. No hay
> estado intermedio: lo que no está marcado `verificado` no vale como hecho.

---

## La respuesta, antes del detalle

**El encargo tiene seis premisas que el repo contradice.** Ninguna es fatal, pero
tres cambian el orden de los pasos y una cambia el destino de la captura. Van
primero porque el resultado más valioso del relevamiento es la lista de lo que
resultó falso:

1. **«El detector de cambios está clavado en `appointment_audit`.»** — **Falso en
   `main`: no hay detector.** `apps/lifestyle/src/lib/appointmentChanges.ts` y
   `app/api/appointments/changes/route.ts` **no existen** en el árbol. Viven solo
   en la rama local huérfana `feat/appointment-changes-endpoint`.
2. **«La captura de insumo debe vivir donde la persona ya está — probablemente el
   corte de caja.»** — **El corte de caja es a ciegas por diseño.** Meterle
   captura de costo rompe la única propiedad que lo hace servir. El destino
   correcto ya existe y ya está montado en las dos vistas: `CajaMovimientos`.
3. **«¿Hay ya algún egreso a medio usar?»** — **Hay egreso, y no está a medio.**
   `caja_movimientos` con `type='salida'` y `concept IN ('insumos','retiro')` está
   completo, en uso y con datos. Lo que falta no es el egreso: es el **rubro**.
4. **«Comisión: derivada, cero captura.»** — **Cero captura no es cero
   configuración.** Hoy la comisión no es derivable: `staff.compensation_model` es
   `NULL` en los 7 barberos y **no existe ninguna tasa en ninguna parte del
   repo**.
5. **«Productos llevan costo unitario real.»** — **Hoy el producto no tiene
   identidad.** Una venta es una fila de monto plano con `concept='producto'`. No
   hay nada que costear unitariamente hasta que exista un catálogo.
6. **«Si hay más de una implementación, "una atribución, una implementación" ya se
   rompió.»** — **Se rompió, pero no donde el encargo apunta.** Hay **dos reglas
   de atribución** (derivada y confirmada) y son **legítimas y deliberadas**: el
   repo las nombra, las separa y prohíbe confundirlas. Lo que sí está roto es que
   la **fórmula del precio** está copiada **13 veces**, 5 de ellas en el browser.

Y el hallazgo que ordena todo el plan: **el costo no puede entrar antes de que el
precio tenga una sola implementación.** Si el margen se escribe hoy, nace siendo
la decimoséptima copia de un `??` y hereda las dieciséis divergencias futuras.

---

## A · Censo del dinero que sale

### A.1 · `caja_movimientos` — la forma

`verificado` — `cat supabase/migrations/20260812000000_capa_dinero.sql`, y contra
prod con `information_schema` + `pg_trigger`.

12 columnas: `id`, `business_id`, `type`, `amount`, `method`, `concept`, `note`,
`staff_id`, `appointment_id`, `reverses_id`, `occurred_on`, `created_at`.

Los candados que ya existen, y que el plan de costos **hereda en vez de reinventar**:

| Candado | Cómo está impuesto |
|---|---|
| Riel obligatorio | `method text NOT NULL CHECK (method IN ('efectivo','tarjeta','transferencia'))` |
| Monto sano | `CHECK (amount > 0 AND amount <= 99999999.99)` |
| Concepto **pareado con el tipo** | `CHECK ((type='entrada' AND concept IN ('walkin','producto','otro')) OR (type='salida' AND concept IN ('insumos','retiro','otro')))` |
| Append-only real | `trg_caja_mov_immutable` → `RAISE` en UPDATE **y** DELETE. Bloquea incluso a `service_role` |
| Anular ≠ editar | `reverses_id uuid UNIQUE REFERENCES caja_movimientos(id)` |
| Día local, no UTC | `occurred_on date NOT NULL`, calculado por la action |
| RLS | deny-all (habilitada, cero policies) |

`verificado` — `pg_trigger`: `caja_movimientos` tiene **un solo** trigger
(`trg_caja_mov_immutable`). No hay trigger de auditoría, **y no le hace falta**:
una tabla append-only es su propio log. Esto importa más adelante (§C.3).

### A.2 · Qué hay adentro, en prod

`verificado` — `select type, concept, method, count(*), sum(amount) … group by`.

| tipo | concepto | filas | monto |
|---|---|---|---|
| entrada | `walkin` | 30 | $5,491 |
| entrada | `producto` | 15 | $3,668 |
| **salida** | **`insumos`** | **5** | **$525** |
| **salida** | **`retiro`** | **5** | **$846** |

**55 filas · 4 de los 6 conceptos posibles en uso** (`otro` nunca se usó, en
ninguno de los dos tipos) · **0 contraentradas** (`reverses_id` siempre `NULL`) ·
**0 filas con `appointment_id`** · **0 filas con `note`**.

Tres lecturas, y las tres entran al plan:

- **El egreso ya opera.** `salida/insumos` no es un esqueleto: tiene monto, riel,
  firma de staff, día local y ya resta del esperado del corte. Lo único que le
  falta para ser costo es **decir de qué fue**.
- **`appointment_id` es una columna sin escritor.** `verificado` — `git grep
  appointment_id apps/lifestyle/src/app/staff/caja-actions.ts
  apps/lifestyle/src/lib/caja.ts` → **cero resultados**. La columna existe desde
  D1 y nadie la escribe nunca. Es el punto de enganche natural para colgar una
  venta de producto de una cita, y está libre.
- **`otro` con 0 filas** confirma que la lista cerrada aguanta: nadie necesitó el
  escape en 55 capturas.

### A.3 · Todo lo que hoy suma dinero — «una atribución, una implementación»

`verificado` — `git grep -nE "price_charged \?\?|coalesce\(price_charged"`.

**18 ocurrencias del patrón `price_charged ?? …precio de lista`.** Descontando 5
que son comentarios (`equipoSemana.ts:20`, `equipoSemanaData.ts:5`), quedan
**16 implementaciones ejecutables** — 11 en el servidor y 5 en el browser:

**Servidor (8):**

| Archivo | Línea |
|---|---|
| `apps/lifestyle/src/lib/corteData.ts` | 76 |
| `apps/lifestyle/src/lib/pulsoHoy.ts` | 93 |
| `apps/lifestyle/src/lib/semanaHero.ts` | 99 |
| `apps/lifestyle/src/lib/senalesData.ts` | 80 |
| `apps/lifestyle/src/lib/negocioMetrics.ts` | 61 |
| `apps/lifestyle/src/lib/equipoSemanaData.ts` | 82 |
| `apps/lifestyle/src/lib/analisisData.ts` | 108 |
| `apps/lifestyle/src/lib/dashboard.types.ts` | 567 **y** 627 (dos en el mismo archivo) |

**Rutas API (2):** `api/reports/weekly/route.ts:156` · `api/reports/staff-metrics/route.ts:182`

**Browser (5):** `AppointmentSheet.tsx:74` · `AppointmentThread.tsx:315` ·
`AssistantControlDesk.tsx:1257` · `StaffLayout.tsx:463` · `TipSheet.tsx:51`

Y **no son idénticas**: `dashboard.types.ts:567` y `analisisData.ts:108` hacen
`?? row.service.price` (revientan si el join vino `null`); las otras once hacen
`?? row.service?.price ?? 0`. Cuatro envuelven en `Number()` y nueve no —
irrelevante hoy porque PostgREST devuelve `numeric` como string en unas rutas y
como número en otras, que es exactamente el tipo de divergencia que un día da dos
totales distintos en dos pantallas.

**El matiz sobre la atribución, que el encargo pide y que hay que respetar.** Las
**dos reglas** que conviven NO son un bug:

- **Derivada** — agenda × precio (`price_charged ∥ services.price`), atribuida por
  `starts_at`. Es lo que pinta `DiaRail`, `AnalisisView`, `EquipoSemana`.
- **Confirmada** — eventos que una persona firmó, atribuida por `completed_at`
  local. Es `lib/cobrado.ts` (D6) y `lib/corte.ts` (D5).

`verificado` — `DiaRail.tsx:10-18` lleva un bloque rotulado **«🔴 FRONTERA
DERIVADO/CONFIRMADO (D6) — innegociable de esta pestaña»** que prohíbe por escrito
llamar «Cobrado» al derivado. `AnalisisView.tsx:56` pinta un chip literal
`estimado`. La frontera **existe, está nombrada y está pintada**.

Conclusión: hay **una** regla de atribución rota (ninguna) y **una** fórmula de
precio rota (dieciséis copias). El plan repara la segunda y **hereda** la primera.

### A.4 · `compensation_model` — existe, y nadie la toca

`verificado`:

- Escritores: **ninguno**. `git grep compensation_model -- 'apps/lifestyle/src/**'
  'packages/**'` → **0 resultados**. Solo aparece en la migración D1 y en `CLAUDE.md`.
- Lectores: **ninguno** (mismo grep).
- UI: **ninguna**.
- Datos en prod: `select compensation_model, count(*) from staff group by 1` →
  **`NULL` × 7**.

El CHECK `IN ('comision','renta','sueldo')` está puesto. La columna es un hueco
correctamente moldeado y absolutamente vacío.

### A.5 · Tasas de comisión — no hay ninguna, y eso es una buena noticia

`verificado` — `git grep -nE "0\.45|45|comisi[oó]n|commission"`.

- **En `apps/lifestyle`: cero.** Ni una tasa, ni un porcentaje, ni un cálculo.
- Los ~25 hits de `commission` viven **todos** en `apps/sellers-portal` — las
  comisiones de los **vendedores de Zentriq**, otro producto, otro modelo de datos
  (`commission_payouts`, `commission_setup_pct`, `commission_monthly_mxn`). **No
  tienen relación con la comisión del barbero** y no deben tomarse como referencia
  de diseño.
- El único `0.45` del repo es `rgba(0, 0, 0, 0.45)` en dos modales de
  `clients/dra-quevedo`. Es un color.

**No hay ninguna tasa hardcodeada que desactivar.** El riesgo del plan no es
limpiar una tasa vieja: es **no inventar una nueva por default**. Prohibición
explícita del encargo, y acá queda con su verificación.

### A.6 · `caja_fondo` — el patrón invertido

La memoria de sesión decía «¿sigue sin escritor?». La respuesta es más rara que eso.

`verificado` — `git grep -n "caja_fondo\|cajaFondo"`:

- **Lectores: 2**, ambos en `apps/lifestyle/src/lib/corteData.ts` (líneas 69 y 88).
  El corte lo lee y lo congela en `caja_cortes.fondo_snapshot`.
- **Escritores en la app: 0.** El único `update businesses set caja_fondo` del
  repo está en `scripts/seed-demo-densa.sql:130`.
- **En prod:** `caja_fondo = 500` en el único negocio — **puesto por el seed**.

O sea: **el fondo se lee, se congela por corte y alimenta el descuadre de efectivo
de todos los días, y no hay forma de cambiarlo desde el producto.** Para el cliente
fundador, el fondo real de su cajón sólo se puede fijar corriendo SQL a mano.

Es el mismo patrón que `compensation_model` invertido: allá una columna con CHECK y
sin nadie; acá una columna **con consumidor activo** y sin captura. Y es directamente
relevante para costos: el fondo entra en el esperado de efectivo, así que un fondo
equivocado desplaza el descuadre — el número que la capa entera existe para producir.

**Mismo patrón, barrido completo** `verificado` (`git grep -c` por columna sobre
`apps/lifestyle/src/**` + `packages/**`):

| Columna | Refs en `src` | Veredicto |
|---|---|---|
| `staff.compensation_model` | **0** | sin lector ni escritor |
| `businesses.organization_id` | **0** | residuo de PR #152 |
| `businesses.caja_fondo` | 2 | **lectores sí, escritor no** |
| `caja_movimientos.appointment_id` | 0 en la action | columna libre |
| `appointments.payment_method` | 12 | vivo (D2 + corte) |
| `caja_cortes.sin_riel_snapshot` | 4 | vivo (S9-OPS-06) |

---

## B · Censo de producto

### B.1 · No existe ningún catálogo que no sea de servicios

`verificado` — `information_schema.tables` sobre prod: **24 tablas** en `public`.
Ninguna se llama `productos`, `inventario`, `compras`, `stock`, `proveedores` ni
nada equivalente. Ni vacía, ni muerta, ni a medias.

`verificado` — inventario de tablas realmente consultadas por el código
(`git grep -ohE "\.(from|table)\('[a-z_]+'\)"` sobre `apps/lifestyle/src` +
`packages`): `appointments` (81), `businesses` (48), `staff` (41), `customers`
(32), `scheduled_notifications` (19), `bot_conversations` (19), `services` (16),
`waitlist` (11), `staff_blocks` (11), `staff_availability` (11),
**`caja_movimientos` (9)**, `staff_services` (6), `staff_schedule_exceptions` (6),
`conversation_messages` (6), **`caja_cortes` (5)**, `appointment_tips` (4),
`bot_logs` (3), `management_audit` (2), `arco_requests` (1),
`appointment_audit` (1).

**«Producto» existe hoy exactamente como un valor de string:** `concept='producto'`
en `caja_movimientos`. Nada más.

### B.2 · Dónde se sella el precio, exactamente

`verificado` — lectura de `lib/cobro.ts`, `app/staff/assistant-actions.ts:305-325`
y `pg_trigger`.

El sello tiene **dos mitades deliberadas**, y el diseño de producto tiene que
respetarlas:

1. **`resolveCobro()`** (`lib/cobro.ts`, puro) traduce lo que una persona tecleó a
   `{ amount, method }`, **y devuelve `undefined` cuando nadie tecleó**. Ambos
   `undefined` significan «no escribir esa columna». Desde S9-OPS-06 el riel ya no
   cae en `DEFAULT_RAIL`: sin declarar es `NULL`, no `'efectivo'`.
2. **`trg_seal_appointment_price`** rellena `price_charged` con el precio de lista
   **sólo si quedó `NULL`**. Si una persona tecleó un monto, ese manda.

`verificado` — **escritores únicos** (`git grep -nE "<campo>\s*:"` sobre
`apps/lifestyle/src/**` + `packages/**`):

| Campo de hecho del mundo | Escritores en la app |
|---|---|
| `price_charged` | **1** — `assistant-actions.ts:320` |
| `payment_method` | **1** — `assistant-actions.ts:319` |
| `completed_at` | **1** — `assistant-actions.ts:310` |
| `arrived_at` | **2** — `assistant-actions.ts:418` (tocar «Llegó») y `:657` (el walk-in nace llegado, S9-OPS-03) |

Las dos apariciones de `arrived_at` en `AssistantControlDesk.tsx` (609, 868) son
**estado optimista de React**, no escrituras a la BD: `mutateAppt(id, a => ({...a,
arrived_at: …}), markArrived, …)` pinta y delega el hecho a la server action.
`verificado` por lectura del bloque.

**El punto de enganche natural para una venta sin cita** existe y está libre:
`caja_movimientos.appointment_id`, cero escritores. Una venta de producto **junto
a** un corte se cuelga de la cita; una venta suelta va sin ella. El mismo riel, sin
tabla nueva para el evento de venta.

### B.3 · ¿`caja_movimientos` puede recibir líneas hoy? — No. Es monto plano.

`verificado` — `lib/caja.ts`: `resolveMovimiento(input)` toma **un** `amount`
escalar. `CONCEPTOS_POR_TIPO = { entrada: ['walkin','producto','otro'], salida:
['insumos','retiro','otro'] }`. `CajaMovimientos.tsx` captura **monto → concepto →
Registrar**, tres taps, un solo importe.

**Esta respuesta decide el esquema de producto**, que era justamente lo que el
encargo pedía que decidiera:

- Una venta de producto hoy es **una fila plana**: «$180, producto, efectivo».
  No hay qué se vendió, ni cuántos, ni a qué costó.
- Para que el producto lleve **costo unitario sellado**, hace falta identidad del
  producto y cantidad. Eso **no cabe** en la forma actual.
- Pero **tampoco hace falta una tabla de venta nueva**: `caja_movimientos` ya es el
  evento de venta (append-only, firmado, con riel, con día local, con
  contraentrada). Lo que falta son **atributos de la línea**, y hoy un movimiento
  es exactamente una línea.

**Recomendación (§E.6): extender, no duplicar.** Un movimiento = una línea de
venta. Dos productos en la misma transacción = dos movimientos. Es honesto (cada
uno con su riel y su firma), preserva el append-only y no obliga a inventar una
tabla `ventas` que sería `caja_movimientos` con otro nombre. El costo del trade-off
—no se puede agrupar «una venta de 3 artículos» como un solo ticket— se paga con
un gesto más y se declara acá para que nadie lo descubra después.

---

## C · Censo de las vistas y el reflejo

### C.1 · Las superficies, por rol, y cuál abre primero

`verificado` — `find apps/lifestyle/src/app -name page.tsx` (9 rutas) + lectura de
`app/staff/page.tsx`, `app/dashboard/page.tsx`, `StaffLayout.tsx`,
`AssistantControlDesk.tsx`, `AdministrarView.tsx`.

| Rol | Ruta que abre | Qué monta | Superficies de dinero que YA tiene |
|---|---|---|---|
| **Barbero** (`role='barber'`) | `/staff` | `StaffLayout`, pestañas **Hoy · Semana · Cierre**, arranca en **Hoy** | `CajaMovimientos` (en **Hoy**, junto a «+ Nueva cita») · `TipSheet` / `TipsSummary` (en **Cierre**) · `EndOfDaySummary` |
| **Asistente** (`role='assistant'`) | `/dashboard` → diverge | `AssistantControlDesk` (diseño congelado) | `CajaMovimientos` (línea 917) · **`CorteCard`** (línea 922) |
| **Dueño** (`owner`/`admin`) | `/dashboard` | `OwnerTabs`: **Panorama · Clientela · Administrar · Actividad**, abre en **Panorama** | `NegocioView` (héroe cobrado, pulso) · `AdministrarView` → `DiaRail` + `EquipoSemana` + `DashboardLayout` (cabos, **`CorteResumen`**) · **`Actividad`** (feed unificado con caja) |

**Dos hechos que reordenan el destino de la captura:**

1. **`CajaMovimientos` ya está montado en las dos vistas presenciales** —
   `StaffLayout.tsx:345` (barbero) y `AssistantControlDesk.tsx:917` (asistente).
   `verificado`. Es literalmente «donde la persona ya está», y el comentario del
   código lo justifica: *va junto a «+ Nueva cita» porque son el mismo tipo de
   gesto: registrar algo que acaba de pasar*.
2. **El corte NO puede ser el destino de la captura.** `verificado` —
   `lib/corteData.ts:6-9`: *«🔴 **A CIEGAS**: nada de este módulo se expone al
   cliente antes de capturar el conteo»*. La ceguera es la propiedad que hace que
   el descuadre signifique algo. Un formulario de costo dentro del corte le
   mostraría números a quien está a punto de contar. **El encargo apuntaba acá y
   hay que corregirlo.**

### C.2 · Estado real de la sincronización

| Pregunta del encargo | Respuesta | Marca |
|---|---|---|
| ¿Se mergeó el endpoint de cambios? | **No.** `feat/appointment-changes-endpoint` = `aa61960` (25-jul-2026), **sin upstream**, **+1 / −73** contra `main`, `git merge-base --is-ancestor` → **NO MERGED** | `verificado` |
| ¿Existe en `main`? | **No.** `apps/lifestyle/src/app/api/appointments/` contiene **sólo** `route.ts`; `lib/appointmentChanges.ts` y `tests/appointmentChanges.test.ts` no existen | `verificado` (`ls`, `git log -- <path>` vacío) |
| ¿Sigue el poll de 20 s? | **Sí.** `AssistantControlDesk.tsx:64` → `const POLL_MS = 20_000` · `:253-263` `setInterval(tick, POLL_MS)` | `verificado` |
| ¿`AssistantControlDesk` sigue siendo dueño único del estado? | **Sí.** `:220` `useState<DashboardAppointment[]>(initialAppointments)`; toda mutación pasa por `mutateAppt` (`:796`) con optimista + server action | `verificado` |
| ¿Su tarea está en `SPRINT.md`? | **No.** `git grep "S6-UI-13" SPRINT.md SPRINT-PROMPTS.md docs/` → **0 hits**. Las 21 líneas de `SPRINT.md` que la declaraban viajan en el commit huérfano | `verificado` |

**O sea: la tarea, el código y el test existen sólo en una rama local sin remoto.**
Si el disco de Gabriel se pierde, se pierden 686 líneas escritas y probadas. Eso
entra al plan como paso 0, y es independiente de costos.

### C.3 · El sondeo clave: ¿hay audit sobre `caja_movimientos`?

**No hay, y resulta que no hace falta.** Este es el hallazgo que más ahorra.

`verificado` — `pg_trigger` sobre prod: los 10 triggers no internos de `public` son
`trg_agente_eventos_inmutables`, `trg_agente_tareas_estado_guard`,
`trg_appt_audit_immutable`, `trg_appointment_tenant_coherence`,
`trg_log_appointment_audit`, `trg_seal_appointment_price`,
`trg_update_visit_stats`, `trg_caja_cortes_immutable`, `trg_caja_mov_immutable`,
`trg_mgmt_audit_immutable`. **`caja_movimientos` tiene inmutabilidad, no auditoría.**

La razón por la que da igual: `appointment_audit` existe porque `appointments` es
**mutable** — una fila cambia y sin log no queda rastro. `caja_movimientos` es
**append-only por trigger**, incluso contra `service_role`. Una fila jamás cambia y
jamás se borra; anular es **otra fila**. Entonces **la tabla es su propio log**, y
un cursor sobre `created_at` es exactamente equivalente a un cursor sobre un audit
que no existe. Lo mismo para `caja_cortes`.

**Y esto ya está construido y en producción.** `verificado` — `lib/activityFeed.ts`
unifica **tres** fuentes (`:253` `appointment_audit`, `:258` `management_audit`,
`:263` `caja_movimientos`), pagina con cursor por `created_at`, y su encabezado
explica por qué la caja va ahí: *«el dueño del cliente #1 NO está en el local. Un
movimiento que sólo se ve en la mesa del asistente es dinero que él nunca mira»*.

**Las tres opciones, anotadas y sin decidir** (la decisión es de Gabriel):

- **Opción 1 — Generalizar el detector a feed multi-tabla, sin migración.**
  Viable: `appointment_audit` aporta ids de cita, `caja_movimientos` y
  `caja_cortes` aportan sus propias filas por `created_at`. **Cero DDL.** Requiere
  rescatar la rama huérfana y generalizar su `since`/`cursor` a N fuentes. Costo:
  medio. Hereda gratis el problema resuelto del solapamiento de 30 s
  (`CHANGES_OVERLAP_MS`) que la rama ya documenta y prueba.
- **Opción 2 — Dejar el poll de 20 s y que el costo viva con vista rancia de ≤20 s.**
  Costo: cero. La rancidez de un costo es cualitativamente distinta de la de una
  cita: nadie agenda contra un insumo. **Es la opción honesta si el margen se
  presenta como cierre del día y no como número vivo.**
- **Opción 3 — Realtime de Supabase sobre las tablas de caja.** **Descartable con
  argumento**: `caja_movimientos` y `caja_cortes` son **RLS deny-all** y nacen
  fuera de la publicación `supabase_realtime` a propósito (D1, §5). Habilitarlo
  exigiría abrir policies sobre las dos tablas más sensibles del sistema. El costo
  de seguridad supera el beneficio de latencia.

**El costo NO nace con vista rancia obligatoria.** Nace con la vista que se elija,
y la opción 2 no requiere trabajo.

### C.4 · La frontera derivado/confirmado, para que el margen la herede

`verificado` — `DiaRail.tsx:10-18` (bloque «FRONTERA DERIVADO/CONFIRMADO
innegociable»), `AnalisisView.tsx:17,56,81` (chip `estimado` + nota *«Estimado
sobre el precio de cada servicio al completarse. No incluye propinas ni
productos»*), `cobrado.ts:1-24` (las tres consecuencias de la regla confirmada).

Cómo la pinta hoy, y qué hereda el margen:

| Mecanismo existente | Qué hace | Cómo lo hereda el margen |
|---|---|---|
| **La palabra** | «Ingresos de agenda del día» ≠ «Cobrado». Prohibido intercambiarlas | «Margen estimado» ≠ «Margen del cierre» |
| **El chip `estimado`** | Píldora gris, borde `line-2`, 11px, junto al número | Cada componente del margen lleva su chip si es derivado |
| **La nota al pie** | Dice qué NO incluye («ni propinas ni productos») | El margen dice qué costo está estimado y cuál firmado |
| **Un solo héroe 44px** | Sólo el titular de Panorama. Todo lo demás a 26px | El margen **no** es un segundo 44px |
| **`cobrado.ts` regla 3** | Las salidas **jamás** se netean del titular | El margen es un número **aparte**, nunca el cobrado menos algo |

Esa última fila es la más importante y la más fácil de romper: **el margen no puede
presentarse como una corrección del cobrado.** `cobrado.ts` lo prohíbe por escrito
—*«un día de $1,700 con $120 de salidas no es un día de $1,580: son dos hechos
distintos»*— y el margen es la tentación exacta de hacerlo.

---

## D · Sondeos negativos — buscar la ausencia

### D.1 · Columnas que nadie lee (o que nadie escribe)

Comando: `git grep -c "<columna>" -- 'apps/lifestyle/src/**' 'packages/**'`.
Resultado: tabla completa en §A.6. **Tres hallazgos:** `compensation_model` (0/0),
`organization_id` (0/0, residuo PR #152), `caja_fondo` (2 lectores / 0 escritores).

### D.2 · Componentes que calculan dinero en el cliente

Comando: el mismo `git grep -nE "price_charged \?\?"`, filtrando `components/`.
**5 hallazgos, todos en el browser:**

`AppointmentSheet.tsx:74` · `AppointmentThread.tsx:315` ·
`AssistantControlDesk.tsx:1257` · `StaffLayout.tsx:463` · `TipSheet.tsx:51`

**Matiz honesto, y cambia la severidad:** los cinco calculan el **precio de UNA
cita para mostrarlo**, no una agregación. No hay ninguna suma de dinero hecha en el
cliente. `verificado`. El riesgo no es un total mal sumado en el browser: es que la
fórmula del precio tiene cinco copias más en un lugar donde ni el guard de select
ni el lint las alcanzan.

### D.3 · Cálculos de margen o comisión ya dispersos

Comando: `git grep -nE "margen|margin|utilidad|ganancia|comisi[oó]n|commission"`.
**Cero en `apps/lifestyle`.** Todo lo de comisión vive en `sellers-portal` (§A.5).
**El terreno del margen está limpio: no hay nada que consolidar, sólo que no
dispersar.**

### D.4 · Rutas que montan componentes muertos en el área de dinero

Comando: barrido de cada `components/**/*.tsx` contra sus importadores.
**3 componentes huérfanos:** `ClientProfileCard.tsx`, `NextClientCard.tsx`,
`StaffDayTimeline.tsx`. **Ninguno toca dinero.** `verificado`.

**Ninguna ruta monta un componente muerto.** `/staff/gestion` es un `redirect()`
puro a `/staff` (`verificado`, lectura del archivo completo).

**Pero el barrido encontró otra cosa: `CLAUDE.md` documenta siete componentes que
no existen.** `verificado` — `find apps/lifestyle/src/components -name "<X>.tsx"`
para cada uno:

`AssistantLayout` · `DayTimeline` · `AppointmentCard` · `AssistantDayTimeline` ·
`AssistantUpcoming` · `ConsolidatedView` · `BranchSelector`

`CLAUDE.md` dedica una fila entera de tabla a `AssistantLayout.tsx` describiéndolo
como «CÓDIGO MUERTO — ninguna ruta lo renderiza», con su lista de subcomponentes.
**El archivo fue borrado.** La documentación describe un fantasma con precisión.

### D.5 · Escrituras a campos de hecho del mundo desde caminos no esperados

Comando: `git grep -nE "<campo>\s*:"` por campo. **Resultado limpio** — tabla en
§B.2: un escritor por campo, dos para `arrived_at` y ambos justificados por
S9-OPS-03. Las apariciones en componentes son estado optimista de React,
verificado por lectura.

**No hay ningún camino inesperado.** La regla dura «presente no es ausente» está
sostenida por el código, no sólo por el documento.

### D.6 · Hallazgo lateral: el guard de voseo tiene un hueco

No estaba en la lista de sondeos, pero salió del barrido de copy de dinero y es
una regla explícita del encargo.

`verificado` — `git grep -nE "trabajás|tenés|podés|querés|sabés|hacés"`:

- `apps/lifestyle/src/components/admin/NegocioView.tsx:165` — «*hasta ~$X/mes si
  **trabajás** esas franjas*» → **visible para el dueño**, y es copy de dinero.
- `apps/lifestyle/src/components/staff/DayBar.tsx:185` — «*Sin jornada — no
  **trabajás** este día*» → **visible para el barbero**.

`tests/copyVoseo.test.ts` existe y pasa. La causa: su constante `VOSEO` es una
**lista de denegación de ~60 formas**, y `trabajás` no está en ella. Una denylist
tiene huecos por construcción; el propio encabezado del test lo admite al listar
sus fronteras. Dos usos en copy visible, escritos después de que la regla y el
guard existieran.

---

## E · Esquema propuesto, con sus candados

Todo lo de abajo es **propuesta**. Cada tabla nueva viene con la demostración de
que no duplica una existente, como pide la contraprueba.

### E.1 · Comisión — derivada, pero necesita una tasa

`staff.compensation_model` ya existe con su CHECK (§A.4). **Falta la tasa**, y no
puede tener default (§A.5).

```
ALTER TABLE staff ADD COLUMN compensation_rate numeric(5,4);
-- CHECK (compensation_rate > 0 AND compensation_rate <= 1)
-- CHECK: rate NOT NULL  ⟺  compensation_model = 'comision'
```

**Candados:**
- **Sin default.** `NULL` = «nadie declaró cómo se le paga a este barbero». La
  regla dura aplica igual: un `0.45` por default sería fabricar el modelo de
  negocio de Gabriel.
- **El CHECK pareado** (rate ⟺ modelo `comision`) impide la fila incoherente
  «sueldo con tasa del 45%», con el mismo idiom que `caja_movimientos_concept_check`.
- **Cero captura por cita:** la comisión se deriva de `price_charged × rate` sobre
  completadas. Nunca se escribe una fila por comisión devengada.
- **Supuesto visible para el usuario:** «Comisión estimada sobre lo cobrado. No
  incluye propinas» — las propinas son privadas del barbero (`appointment_tips`,
  RLS deny-all) y **no pueden entrar al margen del dueño** sin romper el Paso 7.

### E.2 · Fijos — se declaran una vez y se devengan

Tabla nueva `costos_fijos`. **No duplica nada:** `caja_movimientos` es un **hecho
puntual con riel y artefacto físico**; un costo fijo es una **declaración vigente
en el tiempo, sin riel y sin instante**. Meter la renta mensual como una `salida`
de caja mentiría en el corte (restaría del efectivo esperado un dinero que no salió
del cajón ese día).

```
costos_fijos (
  id uuid PK,
  business_id uuid NOT NULL REFERENCES businesses,
  rubro text NOT NULL CHECK (rubro IN (
    'renta','servicios','nomina','software','licencias','publicidad','otro')),
  monto numeric(10,2) NOT NULL CHECK (monto > 0 AND monto <= 99999999.99),
  periodicidad text NOT NULL CHECK (periodicidad IN ('mensual')),
  vigente_desde date NOT NULL,
  vigente_hasta date,              -- NULL = vigente
  nota text,
  staff_id uuid NOT NULL REFERENCES staff,   -- quién lo declaró
  replaces_id uuid REFERENCES costos_fijos,  -- corregir = fila nueva
  created_at timestamptz NOT NULL DEFAULT now()
)
```

**Candados, todos heredados de la capa que ya existe:**
- **Append-only por trigger** (idiom `trg_caja_mov_immutable`): corregir es fila
  nueva con `replaces_id`. Cambiar la renta en junio **no puede** reescribir el
  margen de mayo.
- **RLS deny-all**, como las dos tablas de caja.
- **`periodicidad` con un solo valor hoy.** Deliberado: la lista cerrada nace con
  el valor que se usa, y `'quincenal'`/`'anual'` entran cuando alguien los pida. Un
  CHECK con valores que nadie escribe es el patrón `status='walkin'` de
  `appointments` — valor muerto en el CHECK, documentado en `CLAUDE.md` como cosa
  a no repetir.
- **El devengo es DERIVADO, jamás escrito.** No hay tabla de «costo fijo devengado
  del mes». Se calcula: `monto × (días del período ∩ vigencia) / días del mes`.
  Escribirlo sería afirmar un hecho del mundo que nadie firmó.

### E.3 · Insumos — extensión, no tabla

`caja_movimientos` con `type='salida'`, `concept='insumos'` **ya es el egreso**
(§A.2). Sólo falta el rubro.

```
ALTER TABLE caja_movimientos ADD COLUMN rubro text;
-- CHECK (rubro IS NULL OR rubro IN (
--   'consumibles','herramienta','limpieza','mantenimiento','otro'))
-- CHECK: rubro NOT NULL ⟺ concept = 'insumos'
```

**Candados:**
- **Pareado con el concepto**, mismo idiom que el CHECK tipo/concepto que ya
  existe: un «retiro de rubro limpieza» no significa nada y el CHECK lo impide.
- **Nullable a propósito**, y esto es una decisión, no un descuido: las **5 filas
  de `insumos` que ya existen en prod** se escribieron cuando el rubro no existía.
  Ponerles uno sería inventarlo. `NULL` = «nadie declaró el rubro», exactamente
  como `payment_method` tras S9-OPS-06, y el margen las cuenta en su propio cubo
  «sin rubro» — nunca repartidas.
- **`otro` revisable**, como pide el encargo: la vista de margen lo muestra
  separado, no diluido.

### E.4 · Productos — catálogo

```
productos (
  id uuid PK,
  business_id uuid NOT NULL REFERENCES businesses,
  name text NOT NULL,
  precio numeric(10,2) NOT NULL CHECK (precio >= 0),
  costo_unitario numeric(10,2) CHECK (costo_unitario >= 0),  -- NULL = sin declarar
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

**No duplica `services`.** `verificado` — `services` tiene 12 columnas
(`duration_minutes` NOT NULL, `price_min`/`price_max`/`price_note`,
`staff_services` como junction, y es consumida por el FSM del bot, por
`get_available_slots()` y por la landing pública). Un producto **no tiene duración,
no se agenda, no se asigna a un barbero y no lo ofrece el bot**. Meterlo en
`services` lo metería en el catálogo que el bot le lee al cliente por WhatsApp.

> Nota de deriva `verificado`: `CLAUDE.md` documenta `services` con **8 columnas**.
> La BD tiene **12** — `price_min`, `price_max`, `price_note` y `created_at` no
> están documentadas, y las tres primeras tienen 28/26/18 referencias en `src`. La
> corrección va en el paso P0.

### E.5 · Existencia derivada — el conteo es el único hecho

```
conteos_producto (
  id uuid PK,
  business_id uuid NOT NULL REFERENCES businesses,
  producto_id uuid NOT NULL REFERENCES productos,
  unidades integer NOT NULL CHECK (unidades >= 0),
  contado_on date NOT NULL,        -- día LOCAL
  staff_id uuid NOT NULL REFERENCES staff,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

Append-only. **No hay columna `stock` en `productos`, a propósito.** La existencia
se calcula: `último conteo − ventas desde ese conteo`, y **se presenta siempre con
su fecha**: «≈14 piezas · contado el 28 de agosto». Sin conteo previo no se muestra
un número: se muestra «sin conteo». Es la decisión ya cerrada del encargo, y el
esquema la hace imposible de violar porque **no existe el lugar donde escribir un
stock inventado**.

### E.6 · La venta de producto — extender `caja_movimientos`

Justificado en §B.3: el movimiento **ya es** el evento de venta.

```
ALTER TABLE caja_movimientos
  ADD COLUMN producto_id uuid REFERENCES productos,
  ADD COLUMN unidades integer CHECK (unidades > 0),
  ADD COLUMN costo_unitario_snapshot numeric(10,2) CHECK (costo_unitario_snapshot >= 0);
-- CHECK: (producto_id IS NULL AND unidades IS NULL)
--     OR (producto_id IS NOT NULL AND unidades IS NOT NULL AND concept = 'producto')
```

**Candados:**
- **El costo se SELLA en la venta**, igual que `price_charged` (decisión cerrada
  del encargo). `costo_unitario_snapshot` se copia de `productos.costo_unitario` al
  insertar y **jamás** se recalcula. El append-only de la tabla lo garantiza a
  nivel de trigger: ni `service_role` puede reescribirlo.
- **`NULL` si el producto no tenía costo declarado.** No se pone 0 — un costo de
  cero es una afirmación («este producto me salió gratis») y el margen la creería.
  Va al cubo «sin costo declarado».
- **Las 15 ventas de `producto` que ya existen en prod** quedan con los tres campos
  `NULL`: fueron ventas reales sin identidad de producto, y así se quedan. **Sin
  backfill**, mismo criterio que `consent_at` (migración 037).
- **La contraentrada sigue funcionando sin cambios**: anular una venta de producto
  es una fila con `reverses_id`, y el derivado de existencias tiene que restar la
  anulación. Eso es lógica del cálculo, no del esquema.

---

## F · Las vistas: qué gesto se agrega a qué superficie existente

**Regla que gobierna esta sección:** ninguna superficie nueva. Cada gesto se cuelga
de un componente que ya está montado y que la persona ya abre.

| Gesto | Superficie (existe hoy) | Rol | Qué cambia |
|---|---|---|---|
| **Declarar el rubro del insumo** | `CajaMovimientos` — `StaffLayout.tsx:345` y `AssistantControlDesk.tsx:917` | barbero + asistente | Una fila de chips **sólo cuando `concept='insumos'`**. De 3 taps a 4, y sólo en el caso que lo necesita. **NO va en el corte** (§C.1) |
| **Vender un producto** | `CajaMovimientos`, `type='entrada'`, `concept='producto'` | barbero + asistente | Al elegir «Producto» aparece el selector del catálogo + unidades. Si no hay catálogo, se comporta **exactamente como hoy** (monto plano) |
| **Contar existencias** | `StaffLayout` pestaña **Cierre** | barbero | Junto a `TipsSummary`. Es el gesto de fin de jornada por naturaleza. Opcional siempre: nunca bloquea el cierre |
| **Declarar costos fijos** | `DashboardLayout` (bloque de configuración de **Administrar**), detrás de un `<details>` como los paneles legacy | dueño | Se toca una vez al mes o menos. **No** merece lugar en Panorama |
| **Declarar el modelo y la tasa del barbero** | `StaffManagementPanel` (ya edita PIN, activo, horario) | dueño | Dos campos en el editor que ya existe. Cierra de paso el hueco de `compensation_model` |
| **Fijar el fondo de caja** | mismo panel de configuración | dueño | Cierra el hallazgo §A.6. **Es independiente de costos y se puede hacer solo** |
| **Ver el margen** | `NegocioView` (**Panorama**), bajo el héroe de la semana | dueño | Un bloque de 26px, **nunca** un segundo 44px |
| **Ver el margen del día** | `CorteResumen` / `AdministrarView` | dueño | Después del corte, no antes. La ceguera se respeta |

### Qué muestra cada número, y con qué grado de certeza

Esta es la tabla que el plan tiene que hacer visible **en la pantalla**, no sólo acá:

| Número | Origen | Certeza | Cómo se rotula |
|---|---|---|---|
| **Cobrado** | `cobrado.ts` — completadas por `completed_at` + entradas de caja | **Confirmado** — alguien lo firmó | sin chip (es el estado por default del héroe) |
| **Insumos con rubro** | `caja_movimientos` salida/insumos con `rubro` | **Confirmado** | sin chip |
| **Insumos sin rubro** | las mismas filas con `rubro IS NULL` | **Confirmado en monto, desconocido en rubro** | cubo propio: «sin rubro declarado» |
| **Costo de producto vendido** | `costo_unitario_snapshot × unidades` | **Confirmado** (sellado en la venta) | sin chip |
| **Producto sin costo declarado** | ventas con `costo_unitario_snapshot IS NULL` | **Desconocido** | cubo propio, nunca 0 |
| **Comisión** | `price_charged × compensation_rate` | **Derivada** | chip `estimado` |
| **Fijos devengados** | prorrateo de `costos_fijos` vigentes | **Derivada** | chip `estimado` |
| **Margen** | cobrado − (todos los anteriores) | **Mixta** → se rotula por su eslabón más débil | chip `estimado` **siempre** que haya un componente derivado |
| **Existencia de producto** | último conteo − ventas posteriores | **Estimada, con fecha** | «≈14 · contado el 28 ago». Sin conteo → «sin conteo», nunca un número |

**Tres prohibiciones que se heredan del código existente y no se re-litigan:**

1. **El margen nunca es «el cobrado menos algo».** Es un número aparte.
   `cobrado.ts` regla 3 prohíbe netear las salidas del titular; el margen no puede
   entrar por la puerta de atrás a hacer lo mismo.
2. **Las propinas jamás entran al margen del dueño.** `appointment_tips` es RLS
   deny-all + lint + `tests/tipsPrivacy.test.ts`. El margen no las resta ni las
   suma, y la nota al pie lo dice.
3. **Ningún cubo «desconocido» se reparte.** Mismo argumento que `sinRiel` en
   `corte.ts`: adivinar produce dos mentiras donde había un dato ausente.

---

## G · Contraprueba mecánica

### G.1 · Conteos en prod de toda tabla que el plan toca

`verificado` — una sola query agregada contra prod:

| Tabla | Filas | Nota |
|---|---|---|
| `businesses` | 1 | `caja_fondo = 500` (puesto por el seed) |
| `staff` | 7 | `compensation_model` `NULL` × 7 |
| `services` | 8 | **12 columnas**, no 8 |
| `appointments` | 1,292 | `completed` 1,011 · `cancelled` 122 · `no_show` 112 · `confirmed` 30 · `pending` 17 |
| `caja_movimientos` | 55 | 4 de 6 conceptos · 0 contraentradas · 0 con `appointment_id` · 0 con `note` |
| `caja_cortes` | 20 | los 20 con `sin_riel_snapshot = 0` |
| `appointment_tips` | **0** | |
| `appointment_audit` | 652 | |
| `management_audit` | **0** | |

**Esquema sin filas no es evidencia de uso, y acá muerde dos veces:**

- `management_audit` tiene **0 filas** pese a ser una de las tres fuentes de
  `activityFeed`. La pestaña Actividad funciona con dos de tres.
- Las **1,011 completadas tienen `payment_method` NO nulo** (759 efectivo / 225
  tarjeta / 27 transferencia) y **`price_charged` en las 1,011**. O sea: **ninguna
  fila de prod ejercita el camino `sinRiel`** que S9-OPS-06 construyó, y los 20
  cortes tienen `sin_riel_snapshot = 0`. El código está probado
  (`tests/corte.test.ts:117-155`) pero **el dato de campo no existe todavía**. No
  es un bug; es un `verificar` que el plan no debe confundir con un `verificado`.

### G.2 · `git grep` por cada columna que el plan reusa

| Columna reusada | Refs en `src` | Consecuencia para el plan |
|---|---|---|
| `staff.compensation_model` | **0** | Añadir `compensation_rate` **obliga** a escribir también el primer lector y el primer escritor de `compensation_model`, o se duplica el hueco |
| `caja_movimientos.appointment_id` | **0** | Libre. Es el enganche de la venta a la cita, sin DDL |
| `businesses.caja_fondo` | 2 (lectores) | Añadir el escritor es un paso **independiente** y de valor propio |
| `appointments.price_charged` | 63 | **16 implementaciones.** Bloquea al margen hasta P1 |
| `caja_cortes.sin_riel_snapshot` | 4 | Vivo, y es el precedente del idiom «cubo propio» que los costos copian |

### G.3 · Cada tabla nueva, contra la sospecha de duplicar

| Tabla propuesta | ¿Duplica? | Demostración |
|---|---|---|
| `costos_fijos` | **No** a `caja_movimientos` | El movimiento es un hecho puntual **con riel obligatorio** y artefacto físico que contar; el fijo es una **declaración vigente en el tiempo, sin riel**. Meter la renta como `salida` restaría del efectivo esperado del corte un dinero que no salió del cajón ese día → descuadre inventado, exactamente el daño que S9-OPS-06 acaba de reparar |
| `productos` | **No** a `services` | `services` tiene `duration_minutes NOT NULL`, junction `staff_services`, la consume `get_available_slots()`, el FSM del bot y la landing pública. Un producto no se agenda ni se ofrece por WhatsApp. `verificado` — 16 `from('services')` en el código |
| `conteos_producto` | **No** a nada | No existe ninguna tabla de inventario. `verificado` — `information_schema.tables`, 24 tablas |
| **`ventas`** (rechazada) | **Sí** a `caja_movimientos` | Por eso **no se propone**. La venta se extiende sobre el movimiento (§E.6) |

### G.4 · El test-guard que impide un segundo cálculo de margen

**Dos guards, y el orden importa: el primero es prerequisito del segundo.**

**Guard 1 — `tests/precioUnico.test.ts` (paso P1, antes que cualquier costo).**
Idiom `tipsPrivacy.test.ts`: puro, `git grep --untracked` sobre los árboles de
fuente, allowlist explícita.

- Regla: el patrón `price_charged ?? …price` sólo puede aparecer en
  `apps/lifestyle/src/lib/precioCita.ts`. Ningún otro archivo.
- Allowlist: exactamente un archivo. Es la regla, no una excepción.
- Complemento idiom `appointmentSelect.test.ts`: pinnear la firma de
  `precioDeCita()` para que cambiarla sea deliberado y visible en el diff.
- **Verificación por mutación** (obligatoria para aceptar el paso): reintroducir a
  mano el `??` en `lib/pulsoHoy.ts` → la suite debe ponerse **roja nombrando el
  archivo y la línea**. Revertir. Si pasa verde, el guard no sirve.

**Guard 2 — `tests/margenUnico.test.ts` (paso P5).** Mismo idiom, tres reglas:

1. **Fuente única.** La resta del margen (`cobrado − costos`) sólo en
   `apps/lifestyle/src/lib/margen.ts`. Allowlist de un archivo.
2. **Cero margen en el cliente.** Ningún archivo bajo `components/` referencia
   `margen`, `comision`, `costoFijo` ni `costo_unitario_snapshot` salvo para
   **mostrar** un valor ya calculado por el servidor. Cierra el hallazgo §D.2 en el
   terreno nuevo antes de que se abra.
3. **La propina no entra.** Ningún archivo de la cadena del margen menciona
   `appointment_tips` ni `tipAmount`. Es `tipsPrivacy.test.ts` restringido a la
   cadena del margen, y hace fallar de inmediato el error más caro posible.

- **Verificación por mutación:** copiar la resta a `lib/negocioMetrics.ts` →
  suite roja. Añadir `tipAmount` al insumo del margen → suite roja. Revertir ambas.

**Guard 3 — `copyVoseo`: cerrar el hueco (paso P0).** Añadir `trabajás` (y el
barrido completo de `-ás` de segunda persona) a la constante `VOSEO` y arreglar los
dos usos de §D.6. **Verificación por mutación:** reintroducir «trabajás» → roja.

---

## H · Sin esto no funciona

Lo que **tiene** que estar antes de que un dueño real vea un número de margen.

1. **Una sola fórmula de precio.** Trece implementaciones divergentes (dos de ellas
   ya distintas en el manejo de `null`). Sin P1, el margen nace siendo la
   decimoséptima. `verificado` §A.3.
2. **Una tasa de comisión declarada por barbero.** No hay ninguna en el repo y no
   puede haber default. Sin ella, el mayor costo variable de una barbería vale cero
   y el margen sale inflado. `verificado` §A.5.
3. **Un escritor para `caja_fondo`.** Ya alimenta el descuadre de efectivo de todos
   los días y sólo se puede cambiar por SQL. `verificado` §A.6.
4. **El rubro del insumo.** El egreso ya existe y ya opera; sin rubro, «costos» es
   un número único sin nada que mirar cuando sube. `verificado` §A.2.
5. **Que el corte siga siendo a ciegas.** Ninguna captura de costo dentro de
   `CorteCard`. `verificado` §C.1.
6. **Que las propinas no toquen el margen.** `verificado` — `tests/tipsPrivacy.test.ts`.
7. **Decidir la opción de sincronización** (§C.3). La 2 —dejar el poll y presentar
   el margen como cierre— cuesta cero y es defendible. **Es la decisión de Gabriel,
   no del ejecutor.**

## I · Después

Lo que el relevamiento encontró y **no** bloquea a los costos.

1. **Rescatar o borrar `feat/appointment-changes-endpoint`.** 686 líneas escritas y
   probadas, en una rama local sin remoto, cuya tarea (S6-UI-13) no existe en
   `SPRINT.md`. Decisión de Gabriel: `push` para preservar, o borrar y anotarlo.
2. **`management_audit` con 0 filas.** Una de las tres fuentes de Actividad nunca
   escribió. `verificar` si es correcto (nadie tocó configuración) o si el escritor
   no dispara.
3. **`sinRiel` sin dato de campo.** Las 1,011 completadas tienen riel. El camino
   está probado y nunca ejercitado en prod.
4. **La deriva de `CLAUDE.md`:** 24 tablas documentadas como 21; `services` con 12
   columnas documentadas como 8; siete componentes fantasma. Va en P0.
5. **`organizations` / `businesses.organization_id`,** 0 filas y 0 referencias. La
   migración de borrado sigue pendiente desde PR #152.
6. **Los 3 componentes huérfanos** (`ClientProfileCard`, `NextClientCard`,
   `StaffDayTimeline`). Ninguno toca dinero.
7. **Multi-producto en un solo ticket.** El diseño de §E.6 obliga a un movimiento
   por producto. Si el cliente fundador vende cestas de 3 artículos seguido, esto
   se reabre — con datos de campo, no antes.

---

## J · Pasos troceados para Opus — uno por PR

**Contrato de cada paso:** una rama desde `origin/main` actualizado · un commit
lógico · `npm test` verde · `cd apps/lifestyle && npx tsc --noEmit` limpio · merge
`--ff-only` a `main` + push como parte del cierre (`SPRINT.md`, «Al cerrar una
tarea» punto 4) · **frenar y avisar si el ff-only no aplica** · estado en
`SPRINT.md` 🔵 al iniciar y 🟢 con fecha al cerrar · una línea en la Bitácora ·
**no avanzar al siguiente sin confirmación de Gabriel.**

Los pasos **P0 y P1 no tocan esquema** y son prerequisito de todo lo demás.

---

### **P0 — Higiene: la documentación y el guard de voseo** · sin esquema

- Corregir `CLAUDE.md`: **24 tablas** en prod (agregar `agente_tareas`,
  `agente_tarea_eventos`, `cron_invocaciones`); `services` con **12 columnas**
  (documentar `price_min`, `price_max`, `price_note`, `created_at`); **borrar las
  filas de los siete componentes que no existen** (§D.4).
- Añadir `trabajás` y el resto de las formas `-ás` de segunda persona a la
  constante `VOSEO` de `tests/copyVoseo.test.ts`; arreglar `NegocioView.tsx:165` y
  `DayBar.tsx:185` (→ «trabajas»).
- Anotar la deriva en la Bitácora.
- **Aceptación:** `npm test` verde con el guard ampliado. **Mutación:**
  reintroducir «trabajás» → roja. Revertir.

### **P1 — `precioDeCita()`: la fórmula del precio, una sola vez** · sin esquema · **BLOQUEANTE**

- Crear `apps/lifestyle/src/lib/precioCita.ts`: módulo **puro**, sin DB ni React,
  con la única definición de `price_charged ∥ precio de lista`. Resolver la
  divergencia `?? row.service.price` vs `?? row.service?.price ?? 0` **hacia la
  variante segura**, y documentar la decisión en el encabezado.
- Migrar las **16 implementaciones** de §A.3, incluidas las 5 del browser.
- Crear `tests/precioUnico.test.ts` (guard 1 de §G.4).
- **Aceptación:** `git grep -nE "price_charged \?\?"` devuelve **una sola** línea
  ejecutable, en `precioCita.ts`. **Mutación:** reintroducir el `??` en
  `lib/pulsoHoy.ts` → roja nombrando archivo y línea. Revertir.
- **No tocar** la frontera derivado/confirmado: `computeDayRevenue` sigue siendo
  derivado y `cobrado.ts` sigue siendo confirmado. Este paso unifica **el precio**,
  no la atribución.

### **P2 — El escritor de `caja_fondo`** · sin esquema

- UI en el bloque de configuración de **Administrar** (`DashboardLayout`).
- Server action con `requireBusinessSession` + fila en `management_audit` (cierra
  de paso el hallazgo I.2 con un escritor real).
- **Aceptación:** cambiar el fondo → el siguiente corte usa el valor nuevo y los
  cortes anteriores **no cambian** (`fondo_snapshot` congelado). Verificar contra
  los 20 cortes existentes en el demo.

### **P3 — El rubro del insumo** · migración pequeña

- `ALTER TABLE caja_movimientos ADD COLUMN rubro` + los dos CHECK de §E.3.
- `lib/caja.ts`: `RUBROS_INSUMO` (lista cerrada) + validación en
  `resolveMovimiento`.
- `CajaMovimientos.tsx`: fila de chips **sólo** cuando `concept === 'insumos'`.
- `activityFeed`/`describeMovimiento`: el rubro entra en la línea legible.
- **Aceptación:** las 5 filas de `insumos` que ya existen quedan con `rubro NULL` y
  el corte sigue dando **exactamente** los mismos números. **Sin backfill.**

### **P4 — Modelo y tasa del barbero** · migración pequeña

- `ALTER TABLE staff ADD COLUMN compensation_rate` + CHECK pareado de §E.1.
- Primer lector **y** primer escritor de `compensation_model` (§G.2): dos campos en
  `StaffManagementPanel` + fila de `management_audit`.
- **Sin default en la UI.** El selector arranca vacío.
- **Aceptación:** los 7 barberos siguen en `NULL` hasta que alguien los toque.
  Guardar «sueldo» **con** tasa → rechazado por el CHECK.

### **P5 — Costos fijos: tabla, devengo puro y captura** · migración

- Tabla `costos_fijos` de §E.2, con trigger de inmutabilidad (idiom
  `trg_caja_mov_immutable`) y RLS deny-all.
- `lib/costosFijos.ts` **puro**: prorrateo por vigencia. Sin DB, sin React.
  Tests de borde: alta a mitad de mes, baja a mitad de mes, corrección con
  `replaces_id`, mes de 28 y de 31 días.
- Captura detrás de un `<details>` en el bloque de configuración de Administrar.
- **Aceptación:** cambiar la renta hoy **no** altera el devengo del mes pasado.

### **P6 — `lib/margen.ts` y su superficie** · sin esquema · depende de P1, P3, P4, P5

- Módulo **puro** con la única resta del margen, y con **cubos separados** para
  cada desconocido (§F): insumo sin rubro, producto sin costo, barbero sin tasa.
  **Ningún cubo se reparte.**
- Superficie: bloque de 26px en `NegocioView` bajo el héroe. Chip `estimado`
  siempre que haya un componente derivado. Nota al pie que dice qué no incluye.
- `tests/margenUnico.test.ts` (guard 2 de §G.4).
- **Aceptación / mutación:** copiar la resta a `negocioMetrics.ts` → roja. Añadir
  `tipAmount` al insumo → roja. Revertir ambas. **El héroe de 44px sigue siendo uno
  solo en toda la vista del dueño.**

### **P7 — Catálogo de productos y venta con costo sellado** · migración

- Tabla `productos` (§E.4) + CRUD en el bloque de configuración de Administrar.
- Extensión de `caja_movimientos` (§E.6) con su CHECK pareado.
- `CajaMovimientos.tsx`: al elegir «Producto», selector del catálogo + unidades.
  **Sin catálogo, el formulario se comporta exactamente como hoy** (monto plano):
  el paso no puede romper la captura que ya opera.
- **Aceptación:** las 15 ventas de `producto` que existen quedan con los tres
  campos `NULL` y no se les inventa nada. Vender → `costo_unitario_snapshot` se
  copia. Cambiar el costo del catálogo → la venta anterior **no cambia** (probado
  contra el trigger de inmutabilidad).

### **P8 — Existencia derivada y conteo** · migración · depende de P7

- Tabla `conteos_producto` (§E.5), append-only.
- Gesto de conteo en la pestaña **Cierre** del barbero, junto a `TipsSummary`.
  **Opcional siempre**; nunca bloquea el cierre.
- Presentación: «≈14 piezas · contado el 28 de agosto». **Sin conteo previo → «sin
  conteo», jamás un número.** Restar las anulaciones (`reverses_id`) del derivado.
- **Aceptación:** un producto sin conteo **no** muestra existencia. Anular una
  venta devuelve la unidad al derivado.

### **P9 — (opcional, decisión de Gabriel) Sincronización del costo**

Sólo si Gabriel elige la **opción 1** de §C.3. Rescatar
`feat/appointment-changes-endpoint`, generalizar `appointmentChanges.ts` a feed
multi-tabla (`appointment_audit` + `caja_movimientos` + `caja_cortes`, cursor por
`created_at`, cero DDL) y conectar el consumidor. **Si elige la opción 2, este paso
no existe** y el margen se presenta como cierre del día.

---

## K · Correcciones al repo que este relevamiento encontró

Todas `verificado`, todas fuera del alcance de costos, todas anotadas para que no
se pierdan:

1. **`CLAUDE.md` dice 21 tablas; prod tiene 24.** Faltan `agente_tareas`,
   `agente_tarea_eventos`, `cron_invocaciones`.
2. **`CLAUDE.md` documenta `services` con 8 columnas; tiene 12.**
3. **`CLAUDE.md` describe siete componentes que ya no existen**, incluida una fila
   de tabla completa para `AssistantLayout.tsx`.
4. **`tests/copyVoseo.test.ts` no atrapa `trabajás`**; dos usos en copy visible.
5. **`feat/appointment-changes-endpoint`** — 686 líneas sin remoto, tarea S6-UI-13
   ausente de `SPRINT.md`.
6. **`businesses.caja_fondo`** — consumidor activo, cero escritores en la app.
7. **`management_audit` con 0 filas** pese a estar cableada en Actividad.
8. **La memoria de sesión decía «suite 889 tests»; son 898.**
