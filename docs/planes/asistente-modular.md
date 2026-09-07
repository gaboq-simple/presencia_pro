# El Asistente modular — Agenda · Caja · los bloques escondidos

> **Estado:** **aprobada y en ejecución.** Gabriel aprobó la ola el 2026-09-06
> (tarea de sprint, diseño DESCONGELADO) y **cerró las cuatro decisiones del §10 el
> mismo día**, las cuatro como estaban recomendadas: los **4 slots** declarados
> desde M1 · el corte **sigue ciego** · el asistente **sí ve el período** · el
> barbero **no** hereda la barra. En ejecución: **M1**.
>
> **Qué es.** La vista del Asistente deja de ser una pila vertical y pasa a ser un
> shell de módulos. Dos se construyen ahora —**Agenda** y **Caja**—, dos que hoy
> están escondidos detrás de un botón se promueven, y el shell deja el lugar
> declarado para los que vengan.
>
> **Qué NO es.** No es contabilidad fiscal (§7), no es la raya (P11, bloqueada por
> la decisión del modelo de comisión), no es el rediseño del dueño (S7-DV3-01, que
> sigue su propio orden), y no toca el bot.

---

## 1. El censo: qué existe hoy, verificado

No se propone sobre lo que uno se imagina que hay. Esto es lo que hay, con su línea.

| Pieza | Dónde | Estado |
|---|---|---|
| Mesa de control del asistente | `components/staff/AssistantControlDesk.tsx` (**1,334 líneas**) | viva; dueña ÚNICA del estado del día (`POLL_MS = 20_000`, línea 65) |
| Movimientos de caja | `components/staff/CajaMovimientos.tsx` + `app/staff/caja-actions.ts` | vivos, montados en la mesa (línea 941) |
| El corte a ciegas | `components/staff/CorteCard.tsx` + `lib/corte.ts` | vivo, montado (línea 946); revela DESPUÉS de firmar |
| Catálogo de conceptos | `lib/caja.ts:28` (`CONCEPTOS_POR_TIPO`) | **ya es un catálogo cerrado**, espejo del CHECK de la BD |
| Regla única del dinero del día | `lib/cobrado.ts` | viva; la usan el corte, el pulso del dueño y la semana |
| Cubo de "sin declarar" | `caja_cortes.sin_riel_snapshot` + `CorteCard.tsx:226` | vivo desde S9-OPS-06 |
| Conversaciones (handoff) | `ConversationList` + `ChatPanel` | vivos, **escondidos en un bottom sheet** del header |
| Buscar cliente | `AssistantControlDesk.tsx:1048` | **botón muerto**: `disabled`, *"Disponible en la próxima iteración"* |
| Ficha de cliente | `components/staff/ClientProfileCard.tsx` (249 líneas) | **NINGÚN archivo la monta.** Fantasma no registrado — hallazgo de esta lectura |
| Búsqueda de clientes | `assistant-actions.ts:1067` (`searchCustomers`) | action viva, **sin llamador** |

**Dos hallazgos que este censo produjo y que no estaban anotados en ninguna parte:**
`ClientProfileCard.tsx` y `searchCustomers` existen, están completos, y no los usa
nadie — el botón que los usaría está deshabilitado desde PR-5. Es el mismo patrón
que `S9-RES-03` (`NewAppointmentForm`, escrito para el asistente y montado solo por
el barbero) y que `S9-RES-02` (`getStaffBlocksForDay`). **El módulo de Clientes del
§8 no se construye: se enchufa.**

---

## 2. FASE 1 — Análisis: los cuatro problemas de la vista de hoy

La mesa apila, de arriba abajo: cabos sueltos (acordeón, solo si hay) → caja del día
→ el corte → la tarjeta de la mesa (header + panorama + cola de acción).

**(a) El orden vertical está invertido respecto de la frecuencia de uso.** La agenda
—el objeto que el mostrador toca doscientas veces al día— vive DEBAJO de dos
tarjetas de dinero que se tocan cinco o diez. En una pantalla de mostrador eso es
scroll permanente para llegar a lo único que nunca se deja de mirar.

**(b) El gesto más frecuente del día está dentro de un acordeón cerrado.** "Terminó"
para una cita pasada vive en `<details>` de cabos sueltos. Ya está registrado como
**P8** del plan de la auditoría; esta ola lo absorbe en vez de resolverlo aparte.

**(c) Hay dos módulos funcionales completos escondidos detrás de un botón del
header** (Conversaciones) **y uno detrás de un botón deshabilitado** (Clientes).
Ninguno se ve, y uno de ellos ni siquiera se puede abrir.

**(d) El dinero solo existe en presente.** Todo lo de caja es "del día". No hay forma
de responder *"¿cuánto salió esta semana?"* ni *"¿registré la renta este mes?"*, que
son exactamente las dos preguntas de la persona a la que se le encargó la caja. Y sin
esa mirada, un día que nadie registró es indistinguible de un día sin movimientos.

**El corte a favor.** El corte separa por sí solo lo del día de lo de siempre; los
cabos separan lo pasado sin cerrar; la caja separa el dinero que no es la agenda.
**Los módulos ya están ahí, mezclados en una columna.** Esta ola no inventa una
estructura: la hace visible.

---

## 3. La frontera de privacidad (decisión 3 de Gabriel, resuelta)

Gabriel pidió frontera **que no le estorbe al empleado**. La regla que sale de eso, y
que se aplica en los seis pasos sin excepción:

> **El asistente ve todo lo que necesita para OPERAR y para responder por lo que
> registró. No ve lo que rompería el mecanismo, ni lo que no es suyo.**

Aplicada, en tres renglones que no admiten interpretación:

| Ve | No ve, y por qué |
|---|---|
| Los movimientos que registró, el día y el período. Los cobros del día. Lo que quedó **sin declarar**. Los cabos sin cerrar. El resultado de su corte **después** de firmarlo. | **El esperado ANTES de contar.** El corte es a ciegas por construcción (`lib/corte.ts`, probado mecánicamente en D5): si el esperado aparece antes, contar deja de ser evidencia y pasa a ser copiar. Esto **no se negocia en ningún paso.** |
| | **Las propinas.** `appointment_tips` es tabla aparte con RLS deny-all y un lint + repo-check que rompen el build ante cualquier referencia fuera del módulo del barbero. La ola no la toca. |
| | **Margen, rentabilidad y la raya.** Territorio del dueño (P11). No porque sea secreto, sino porque no es una herramienta de mostrador: nadie del mostrador decide con eso. |

**Por qué esto no le perjudica.** La única cosa que el asistente no ve y podría
querer —el esperado— es justo la que lo protege: con el corte a ciegas, un descuadre
es un hecho del mundo y no una sospecha sobre una persona. Si viera el esperado y su
conteo coincidiera siempre, nadie podría distinguir a quien cuenta bien de quien
copia el número, y esa duda **cae sobre él**. La ceguera del corte es su coartada, no
su límite. Eso se escribe en el copy del módulo, no solo acá.

---

## 4. El modelo de datos

**Lo que NO cambia** (y es la mitad del trabajo que ya está pagado): `caja_movimientos`
sigue siendo append-only por trigger, sin UPDATE ni DELETE, con riel NOT NULL,
contraentrada por `reverses_id` (UNIQUE) y `occurred_on` como día local. `caja_cortes`
sigue con sus `*_diff` GENERATED. RLS deny-all en las dos. **La ola no afloja una sola
de esas propiedades.**

**Lo que se agrega, y nada más:**

1. **Conceptos nuevos de salida** — el CHECK `caja_movimientos_concept_check` crece
   (§5). Migración de una línea, más su espejo en `lib/caja.ts`. **Sin backfill:** las
   filas viejas conservan su concepto viejo, porque reclasificar hacia atrás sería
   inventar en qué se gastó (regla dura de `CLAUDE.md`).
2. **`caja_fijos`** — la plantilla de un gasto que se repite (§6). **No es dinero:** es
   un recordatorio con su cadencia. Que un fijo exista no afirma que se pagó.
3. **`caja_movimientos.fijo_id`** — columna nullable, FK a `caja_fijos`. Es lo que
   permite derivar *"la renta se pagó por última vez el 3, $12,000"* **de los
   movimientos reales** y no de un campo mutable que puede mentir.

**Lo que se prohíbe explícitamente:** una segunda regla del dinero. El período del §8
reusa `lib/cobrado.ts` y `getInsumosDelCorte`, que ya son LA regla. Si el módulo de
Caja calcula su propio total, el asistente y el dueño van a ver dos verdades del mismo
día y ninguna forma de saber cuál es la buena — que es exactamente el defecto que la
capa de dinero existió para cerrar.

---

## 5. Las categorías (decisión 5, resuelta) — y por qué no pueden ser un peaje

**El defecto medido, no supuesto.** El catálogo ya existe y es cerrado, pero es
demasiado grueso: `salida` solo ofrece `insumos`, `retiro` y `otro`, así que **pagar la
renta se registra como "retiro"** — el placeholder de la nota lo dice literalmente:
`lib/caja.ts:69` → `retiro: 'Ej. pago de la renta'`. Un retiro (el dueño saca efectivo)
y la renta (un costo del negocio) son hechos distintos con la misma etiqueta. Ese es el
colapso que hay que deshacer, y es más importante que agregar categorías bonitas.

**El catálogo propuesto** — sigue siendo corto, sigue siendo un tap:

- `entrada`: `walkin` · `producto` · `otro`  *(sin cambios)*
- `salida`: `insumos` · **`renta`** · **`servicios`** *(luz, agua, internet)* · **`nomina`** *(adelanto, raya)* · **`mantenimiento`** · `retiro` · `otro`

**Las cuatro reglas que impiden que el catálogo frene la operación** (la preocupación
explícita de Gabriel):

1. **La categoría es una comodidad del que LEE, nunca un peaje del que ESCRIBE.** Monto
   + un tap = registrado. La nota es opcional y lo seguirá siendo. Ningún modal
   bloqueante, ninguna validación nueva en el camino de captura.
2. **`otro` es una respuesta legítima de primera clase, no un fallo.** No se penaliza, no
   se marca en ámbar, no se pide justificar. Si acaso, después se puede *sugerir* una
   categoría; jamás exigirla.
3. **El orden de los chips lo aprende el negocio, del propio negocio.** Los conceptos se
   ordenan por uso real de los últimos 30 días (cálculo determinista sobre sus propias
   filas, cero ML, cero servicio externo). La barbería que compra insumos a diario ve
   `insumos` primero; la que no, ve `renta`. El catálogo es igual para todos; el orden, no.
4. **Montos frecuentes como atajo.** Por concepto, los 2–3 montos más repetidos de su
   histórico como chips ($50 / $100 / $200). El teclado sigue ahí; el atajo no lo reemplaza.

**La razón de fondo, que es doctrina del repo y no gusto:** un movimiento **mal
categorizado** es un dato imperfecto; un movimiento **no registrado** es un agujero que
después se lee como "no pasó nada". `CLAUDE.md` ya lo dice para otros campos —*preferir el
`NULL` visible al valor plausible*—; acá se aplica igual. Si alguna vez hay que elegir
entre una categoría buena y que el movimiento se registre, gana el registro.

---

## 6. Los fijos: el recordatorio que toca la puerta (objeción de Gabriel, resuelta)

**La objeción, tal cual:** eliminar la tarea repetitiva está bien, pero un gasto
recurrente que se configura una vez y desaparece es peor que anotarlo a mano — cuando
cambie, no se encuentra y nadie se acuerda de que existía.

**La respuesta: el fijo NUNCA se registra solo. Toca la puerta y alguien lo confirma
con un tap.**

Mecánica:

1. Se declara una vez: concepto, etiqueta, monto sugerido, cadencia (mensual día N /
   semanal día D).
2. El día que vence, aparece **en la cola del día** como un pendiente: *"Renta ·
   sugerido $12,000 · confirmar"*. No en una pantalla de configuración: en el camino
   por donde el mostrador ya pasa.
3. Confirmar es un tap. El monto llega **pre-llenado y editable**: si este mes subió, se
   corrige ahí, y **ese cambio actualiza la plantilla** — el ajuste ocurre donde te
   diste cuenta, no en un menú que habría que recordar que existe.
4. Si nadie confirma, **se queda pendiente y envejece a la vista** (*"vence hace 3
   días"*). No se autoregistra y no se desvanece.
5. La lista de "Fijos" vive en el módulo de Caja: cada uno con su próxima fecha y su
   **último monto real, derivado de los movimientos** (`fijo_id`), no de un campo
   guardado que podría estar desactualizado.

**Por qué esta forma y no un cron que escriba la fila.** Dos razones, y la primera es
innegociable:

- **`caja_movimientos` afirma un hecho del mundo.** Escribir "salió la renta" porque es
  día 3 es fabricar evidencia — la regla dura de `CLAUDE.md`, la misma por la que el
  auto-cancel se comía walk-ins y por la que `sent_at` dejó de escribirse a ciegas. Un
  mes la renta se paga el 5, otro no se paga, y el sistema no tiene forma de saberlo.
- **Un fijo que hay que confirmar es imposible de olvidar**, porque vuelve cada período.
  La automatización que oculta es la que escribe sola; la que recuerda, exhibe. Esta
  exhibe por diseño.

Su forma es la misma que dos piezas que este sistema ya tiene y que funcionan: los
**cabos sueltos** (lo pendiente se VE) y `scheduled_notifications` (una cola con su
instante). No hay doctrina nueva que aprender.

---

## 7. Cimientos fiscales: lo que se deja puesto y lo que NO se construye (decisión 4)

Ahora es **flujo de caja operativo**. Punto. Lo que se deja listo para que un día pueda
crecer a fiscal, sin construir un gramo de fiscal:

- **El eje temporal ya existe:** `occurred_on` es día local del negocio, no `created_at`.
  Cualquier reporte por período o ejercicio se apoya ahí sin migrar nada.
- **La inmutabilidad ya existe:** append-only + contraentrada es, de hecho, la propiedad
  que un libro contable exige. Nada se edita, nada se borra, todo tiene autor y hora.
- **Los conceptos son CÓDIGOS estables, distintos de su etiqueta visible.** Se guarda
  `renta`, se muestra "Renta". Cambiarle el nombre a la etiqueta mañana no reescribe la
  historia. Cada código anticipa a qué cubo fiscal caería, **anotado en el comentario de
  la migración y en ningún otro lado** — es una nota para el que venga, no un campo.
- **Lo que NO se agrega y no se debe agregar por accidente:** RFC, CFDI, folios, IVA,
  régimen, deducibilidad, proveedor como entidad. Ninguna columna, ninguna validación,
  ninguna etiqueta que lo sugiera. Si un día entra, entra con su propio plan y su propio
  abogado.

---

## 8. FASE 2 — Las propuestas de valor, y dónde encaja cada una

1. **"Cerrar el día" como un solo flujo.** Hoy el cierre está partido en tres bloques
   dispersos que el asistente tiene que recordar visitar en el orden correcto. En el
   módulo de Caja pasan a ser cuatro pasos en el orden real: **citas sin cerrar → los
   movimientos del día → los cobros sin riel → contar**. El corte sigue a ciegas.
2. **"Sin declarar" deja de ser un dato y pasa a ser una tarea.** Hoy `payment_method
   NULL` termina en un cubo del corte, cuando ya es tarde. Como lista accionable ANTES
   de contar (*"3 cobros sin riel · asignar"*), corrige el descuadre en su origen. Es la
   mejora con mejor relación valor/esfuerzo de toda la ola: la pieza que lo calcula ya
   existe.
3. **El período, acotado.** Semana y mes de lo que el asistente registró: entró / salió /
   neto, **con las salidas SIEMPRE en línea aparte y jamás neteadas contra el titular**
   (regla de D6, no se reabre). Su valor mayor no es el total: es que **un día sin
   registrar se ve como un hueco**, y hoy no se ve.
4. **Presupuesto suave por categoría** — *"insumos va 40% arriba del promedio de 4
   semanas"*. Señala, nunca bloquea, nunca juzga. **Fuera del primer corte:** necesita
   varias semanas de datos categorizados para no mentir. Se anota como paso posterior.

---

## 9. FASE 3 — El corte en pasos

Gates por paso, los estándar de este repo: `tsc` 0 · `eslint` 0 errores (baseline de
warnings) · suite completa verde · **red de seguridad visual** con el seed denso corrido
al inicio del paso y prohibido re-sembrar entre el "antes" y el "después".

| Paso | Qué hace | Aceptación dura |
|---|---|---|
| **M1 · El shell de módulos** | Barra de módulos, **Agenda por defecto**. Se MUEVE lo que existe, cero features. El estado del día queda en un contenedor por ENCIMA de las pestañas: un solo `useState`, un solo polling, pestañas tontas. | **La mesa de control es idéntica en composición** (mismo header, mismos stats, mismo deck, mismo orden). Cambiar de módulo y volver **no re-consulta**, no pierde el día ni la ventana temporal. |

> **Corrección al criterio de M1 (2026-09-06, antes de ejecutarlo).** El plan pedía
> *"0 píxeles dentro de Agenda"* y **ese criterio era imposible de cumplir por
> construcción**: M1 saca las tres tarjetas de dinero de la vista de Agenda y agrega una
> barra de módulos, así que la altura disponible del deck cambia sí o sí. Sostenerlo tal
> cual habría obligado a declararlo cumplido con una excusa, que es peor que corregirlo.
> El criterio verificable es el de arriba: la **composición** de la mesa no cambia — mismo
> header, mismos stats, mismo deck, mismo orden— y lo único que se mueve es lo que M1
> existe para mover.
| **M2 · Caja como módulo** | Movimientos + corte + cabos se mudan al módulo. Aparece "Cerrar el día" en su orden real (§8.1) y la lista de sin-riel accionable (§8.2). Absorbe **P8** de la auditoría. | El corte sigue siendo **imposible de espiar**: se re-corre la prueba mecánica de D5 (el esperado no aparece en el DOM antes de firmar). |
| **M3 · Categorías finas** | Migración del CHECK + espejo en `lib/caja.ts` + chips ordenados por uso + montos frecuentes. | El camino de captura **no gana un solo paso**: se mide en taps, antes y después. Si sube de N a N+1, el paso se revierte. Sin backfill. |
| **M4 · Los fijos** | `caja_fijos` + `fijo_id` + la cola de vencimientos + la lista con último monto derivado. | **Sondeo negativo:** con un fijo vencido y nadie confirmando, `caja_movimientos` **no gana ninguna fila**. Confirmar con monto distinto actualiza la plantilla y deja el movimiento con el monto real. |
| **M5 · El período** | Semana/mes reusando `lib/cobrado.ts` y `getInsumosDelCorte`. Huecos visibles. | **Contraprueba:** el total del período calculado por fuera contra la BD coincide con el de pantalla, y el titular del dueño para el mismo rango **no puede contradecirlo** (misma regla, una implementación). |
| **M6 · Los escondidos** | Conversaciones sale del bottom sheet y es módulo. Clientes revive `searchCustomers` + monta `ClientProfileCard` y mata el botón deshabilitado de `:1048`. | El badge de conversaciones humanas sobrevive a la mudanza. Cero componentes nuevos: es enchufar dos que ya están escritos. |

**Orden y por qué.** M1 primero y solo: un cambio estructural que además mueve
comportamiento es un cambio que no se puede verificar. M2 le sigue porque es donde vive
el valor que Gabriel pidió. M3 y M4 son la captura, y van después de que el módulo
exista. M5 necesita a M3 para que las categorías signifiquen algo. M6 es barato y puede
adelantarse si se quiere una victoria rápida.

---

## 10. Las cuatro decisiones — CERRADAS por Gabriel (2026-09-06)

1. **Los 4 slots se declaran desde M1** (Agenda · Caja · Mensajes · Clientes), y
   Mensajes/Clientes se encienden en M6. Razón: una barra que crece de 2 a 4 mueve el piso
   bajo el pulgar de alguien que ya aprendió dónde tocar.
2. **El corte sigue ciego, sin excepción.** El esperado no puede aparecer antes de contar en
   ningún paso de la ola, y la pantalla dice por qué protege a quien cuenta.
3. **El asistente sí ve el período**, acotado a caja + cobros. Es la diferencia entre
   encargarle la caja y encargarle anotar en la caja.
4. **El barbero NO hereda la barra.** Conserva su shell propio (Hoy · Semana · Cierre, del
   rediseño RB Paso 1): son dos oficios distintos y el barbero no maneja la caja del negocio.

**Consecuencia de (1) que hay que mirar de frente:** M1 va a mostrar **una pestaña sin
módulo detrás** (Clientes), que es exactamente la enfermedad que este mismo plan le
diagnostica al botón muerto de `AssistantControlDesk.tsx:1048`. Se acepta con dos
mitigaciones y no con una promesa: **Mensajes NO nace muerta** —su slot abre la hoja de
conversaciones que ya funciona, así que es la misma función alcanzable desde la barra, no
una función nueva ni una vacía—, y **Clientes muestra un estado vacío que nombra su paso**
(M6, registrado y barato) en vez de un `disabled` con tooltip vago. Un estado vacío que
explica es información; un botón apagado no enseña nada.

---

## 11. Lo que esta ola no hace, dicho en voz alta

- **La raya (P11).** Sigue bloqueada por la decisión del modelo de comisión de Gabriel.
  Sus dos cimientos ya están puestos y sin lector (`staff.compensation_model`,
  `appointments.charged_by_staff_id`).
- **El corte por turno (P12).** Decisión de modelo antes que código.
- **Contabilidad fiscal.** §7.
- **El rediseño del dueño (S7-DV3-01).** Ola aparte, en curso, con su propio orden.
- **`S9-RES-03`** (`NewAppointmentForm` montado solo por el barbero). Roza esta ola pero
  es una decisión de producto propia; se anota, no se resuelve de refilón.
