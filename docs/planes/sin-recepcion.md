# La barbería sin recepción (R2 · S9-OPS-05)

**Qué es esto.** Un relevamiento, no un plan. La pregunta que contesta es una
sola: **si no hay recepcionista y cada barbero opera Zlot desde su teléfono entre
corte y corte, ¿qué del sistema actual sirve, qué estorba y qué falta?**

**Foto del repo:** `main` en `6f56333`, 2026-08-26. Todo lo que dice este
documento o va con su `archivo:línea` o va con la consulta que lo midió. Lo que no
se pudo verificar se declara sin verificar; no se rellena con lo probable.

**Hermano mayor:** `docs/planes/operacion-sin-bot.md` (R1), que preguntó lo
contrario — si el mostrador puede operar sin bot. Éste pregunta si la silla puede
operar sin mostrador. Donde R1 sigue vigente se cita en vez de repetirse.

---

## La respuesta, antes del detalle

**Sí, con tres excepciones — y una de ellas es de dinero, no de comodidad.**

La sospecha razonable era que Zlot está construido alrededor del mostrador y que
el barbero sería un ciudadano de segunda. **El repo la desmiente, y con margen.**
La vista del barbero es un producto propio, **mobile-first por construcción**
(`StaffLayout.tsx:274` monta el cuerpo en `max-w-xl` con tab bar), tiene su hilo
del día, su barra de tiempo, su semana, su cierre, su caja y sus propinas
privadas. Un barbero con un teléfono tiene más superficie útil que la que R1
encontró para el asistente en algunos momentos del día.

Lo que falta no es superficie: es que **tres gestos que hoy asume la recepción no
tienen dueño**, y el peor de los tres no se nota porque el sistema lo tapa con un
default.

1. **El corte no existe en la vista del barbero.** `CorteCard` se monta en un solo
   lugar y es la mesa del asistente (`AssistantControlDesk.tsx:920`); en
   `StaffLayout.tsx` no aparece. Sin recepción, el día se cierra sin contarse.
2. **El riel del cobro se escribe siempre `efectivo`**, porque el camino principal
   del barbero no pregunta cómo pagaron. No es un dato faltante: es un dato
   **inventado con apariencia de dato**, y el cuadre se apoya en él.
3. **La atribución no se escribe nunca.** `created_by_staff_id` y
   `modified_by_staff_id` están en **0 de 1,261 citas** en prod. Con comisión al
   45% eso no es auditoría, es la nómina.

Todo lo demás —agendar, cobrar el monto, mover, cancelar, registrar caja, pedir
día libre, ver la semana— el barbero ya lo puede hacer solo desde su teléfono.

---

## A · El rol: qué ve hoy un `staff` que no es dueño

### Cómo entra

Por **PIN de 4 dígitos**, en la ruta scopeada por negocio `/[slug]/staff`. La ruta
de login sólo acepta dos roles: `barber` y `assistant`
(`api/auth/pin/route.ts:146`), con rate limit de 5 intentos por minuto por IP
(`api/auth/pin/route.ts:71`). La sesión que se mintea lleva el `staff_id` real
(`api/auth/pin/route.ts:151-156`), y eso es lo que hace que el audit firme con
una identidad y no con `unknown`.

### Qué ruta le toca

Hay **dos vistas y son excluyentes por rol**, resueltas con `redirect()` en el
servidor:

| Rol | `/staff` | `/dashboard` |
|---|---|---|
| `barber` | **su vista** (`StaffLayout`) | → redirige a `/staff` (`dashboard/page.tsx:77`) |
| `assistant` | → redirige a `/dashboard` (`staff/page.tsx:64`) | **la mesa** (`AssistantControlDesk`, `dashboard/page.tsx:125`) |
| `owner` / `admin` | → redirige a `/dashboard` | las 4 pestañas del dueño |

**Sí existe una vista de barbero, y no es la del asistente recortada.** Es un
shell propio con tab bar `Hoy / Semana / Cierre` (`StaffLayout.tsx:10-13`), y la
ruta vieja `/staff/gestion` quedó como puro `redirect` hacia él
(`staff/gestion/page.tsx:22`).

**Contraprueba de que la mesa NO es alcanzable para él:** el guard de
`/dashboard` corta por rol antes de cualquier fetch (`dashboard/page.tsx:77`), así
que un barbero no puede ver el panorama del negocio ni escribiendo la URL. Lo que
sí existe y es suyo se lista abajo.

### Qué monta su vista, con línea

| Pieza | Dónde | Para qué sirve sin recepción |
|---|---|---|
| `HeroCard` | `StaffLayout.tsx:260` | el cliente que tiene enfrente, fijo en el header |
| `DayBar` | `StaffLayout.tsx:280` | el día como barra de tiempo |
| **`+ Nueva cita`** → `NewAppointmentForm` | `StaffLayout.tsx:41` | **agenda él mismo**, con `source` walk-in / llamada / manual (`NewAppointmentForm.tsx:50-54`) |
| **`CajaMovimientos`** | `StaffLayout.tsx:301` | **registra dinero fuera de la agenda** (producto, sin cita, salidas) |
| `DayDriftNotice` | `StaffLayout.tsx:306` | si el día se corrió |
| `AppointmentThread` | `StaffLayout.tsx:319` | el hilo, con swipe Terminó / No vino |
| `BarberWeekView` + `BlockRequestForm` + `RecurringAvailability` | `StaffLayout.tsx:337-351` | su semana y su día libre |
| `TipsSummary` / `TipSheet` | `StaffLayout.tsx:360,405` | sus propinas, invisibles al dueño |
| `EndOfDaySummary` | `StaffLayout.tsx:367` | su matriz de fin de jornada |

### Qué NO monta, y hay que decirlo con nombre

Un `grep` de `CorteCard|ConversationList|ActionQueue|listarCabos` sobre
`StaffLayout.tsx` da **0**. O sea que el barbero **no tiene**: el corte, la ventana
de conversaciones de WhatsApp, la cola de atrasados, ni el panel de cabos sueltos
(las citas pasadas sin cerrar). Los cuatro viven sólo en la mesa
(`AssistantControlDesk.tsx:920`, `:1236`, `:1086`, `:834`).

### El matiz que importa: la UI está cerrada, la capa de acciones no

`requireAssistantSession()` (`assistant-actions.ts:51`) **no comprueba el rol** —
sólo exige que haya sesión. Quien acota al barbero es un gate distinto,
`assertBarberOwnsAppointment` (`assistant-actions.ts:71`), que lo limita a *sus*
citas. Y `requireBusinessSession()`, el guard de la caja y el corte, tiene a
`barber` en su allowlist afirmativa (`lib/auth.ts:180`).

**Consecuencia, verificada y no obvia:** las server actions del corte y de la caja
**ya aceptan a un barbero hoy** (`caja-actions.ts:293-296` exige `staffId`, que
una sesión por PIN siempre trae). Lo que falta para que el barbero cierre el día
**no es permiso: es superficie.** Es una distinción que cambia el tamaño de lo que
falta, y por eso se escribe.

### ¿Es usable en un teléfono?

**La vista del barbero, sí, y a propósito.** El shell se declara mobile-first
(`StaffLayout.tsx:5`) y el cuerpo vive en `max-w-xl` (`StaffLayout.tsx:274`): una
columna, tab bar abajo, gestos de swipe.

**La mesa del asistente, a medias, y es discutible.** No es "sólo escritorio": el
deck usa `lg:flex-row` (`AssistantControlDesk.tsx:1038`), o sea que en un teléfono
apila panorama y cola en vertical en vez de romperse. Pero el contenedor está
pensado en `max-w-[1400px]` (`AssistantControlDesk.tsx:875`), la cola de acción
reserva 348 px en `lg`, y el calendario da **200 px mínimos por barbero**
(`AssistantVerticalCalendar.tsx:94`) con scroll horizontal a partir de ahí — con
los 5 barberos activos del demo, en un teléfono son casi dos pantallas de ancho.

**Pero es una pregunta muerta para este relevamiento:** el barbero no puede llegar
a esa vista (redirect por rol), así que su usabilidad en teléfono no bloquea nada
del escenario "sin recepción". Se deja medido para que nadie lo re-investigue.

---

## B · El cierre del corte en la silla

### Hay TRES "Terminó" y no escriben lo mismo

Éste es el hallazgo central de la sección, y no se ve leyendo una sola pantalla.

| Camino | Línea | Qué manda | Qué queda escrito |
|---|---|---|---|
| **Hero** — el cliente enfrente | `HeroCard.tsx:209` | `completeAppointment(id)` **sin cobro** | riel `efectivo` **siempre**, monto sellado por el trigger |
| **Swipe** en el hilo | `AppointmentThread.tsx:152` | `completeAppointment(id, {amount, method})` | lo que diga el chip… si alguien lo toca |
| **Ficha** del hilo | `AppointmentSheet.tsx:201` | `completeAppointment(id)` **sin cobro** | riel `efectivo` **siempre** |

Los tres terminan en la misma action, que escribe el riel **incondicionalmente**
(`assistant-actions.ts:286`). Y `resolveCobro(undefined)` devuelve
`{ amount: undefined, method: DEFAULT_RAIL }` (`lib/cobro.ts:59,67`), con
`DEFAULT_RAIL = 'efectivo'` (`lib/cobro.ts:23`).

El monto está bien resuelto: `amount: undefined` significa "no escribas
`price_charged`" y lo sella el trigger con el precio de lista
(`049_appointment_price_snapshot.sql:44`, que sólo rellena si está `NULL`). Eso es
honesto: nadie tecleó otro número.

**El riel no.** El riel sale siempre con valor, y en dos de los tres caminos ese
valor es un default que nadie miró. El swipe es el único que ofrece la pregunta, y
la ofrece **dentro de la ventana de 5 segundos del Deshacer**
(`AppointmentThread.tsx:86`), arrancando también en `efectivo`
(`AppointmentThread.tsx:177`).

### Por qué esto es dinero y no cosmética

El corte compara **contra artefactos físicos, riel por riel**: `expectedByRail`
suma las citas cobradas agrupándolas por `payment_method` (`lib/corte.ts:90-101`).
Si todos los cierres dicen `efectivo`:

- `expected_card` = 0 → `card_diff` = **+ todo lo que marque la terminal**
- `expected_cash` = infla con ese mismo dinero → `cash_diff` = **− la misma cifra**

Un descuadre espejo, del tamaño exacto de lo que se cobró con tarjeta, **todos los
días**. Y con signo: negativo en efectivo se lee como "falta dinero".

**Medido contra prod:** de 979 citas completadas, 735 dicen `efectivo`, 219
`tarjeta` ($52,650) y 25 `transferencia`. Pero **ninguna de esas filas la escribió
la app** — las 1,261 citas tienen `modified_by_staff_id` en NULL, o sea que
ninguna pasó nunca por `completeAppointment`. Esa mezcla realista es del seed. **El
riel de la app todavía no se ha estrenado, y su camino principal produce 100%
`efectivo`.**

### Cuántos toques cuesta hoy, y cuáles desaparecen sin recepción

Contando un toque como una acción de dedo discreta, desde "terminé" hasta el
dinero registrado:

| Camino | Toques | Qué se decide del dinero |
|---|---|---|
| Barbero · Hero | **1** | nada. Monto de lista, riel `efectivo` |
| Barbero · swipe, sin tocar el chip | **1** (gesto) | nada — mismo resultado que el hero |
| Barbero · swipe + decir "pagó con tarjeta" | **4** (swipe, chip, riel, cerrar) | riel real |
| Barbero · ficha | **2** (tap card, tap Terminó) | nada |
| Asistente · walk-in desde el calendario | **3** (tap bloque, Terminó, Terminó en la hoja) | monto y riel, preguntados |
| Asistente · cita agendada | **3** pero por el acordeón de cabos (R1) | monto y riel, preguntados |

**Los toques que desaparecen cuando el que cobra es el mismo que cortó** son
reales y valen la pena nombrarlos: no hay que **buscar** la cita en una agenda de
cinco columnas (el hilo del barbero sólo trae las suyas), no hay que **decir quién
cortó** (la sesión ya lo sabe), y no hay que **entregar el efectivo** ni conciliar
después. El camino pasa de "encontrar + cerrar + cobrar, en la superficie de otra
persona" a **un gesto en la pantalla que ya tenía abierta**.

**El problema es que también desaparece la pregunta del riel.** El único camino
del barbero que la hace es el swipe, y sólo si se toca un chip que se auto-acepta
en 5 segundos. La recepción no era sólo un par de manos: era el momento en que
alguien miraba el dinero.

Después del `Terminó` exitoso, los tres caminos encadenan la hoja de propina
(`StaffLayout.tsx:266,325`) — eso sí es del barbero y ya funciona.

---

## C · La atribución: quién cortó y quién cobró

### El censo, primero

Contra prod, hoy:

| | |
|---|---|
| Citas totales | **1,261** |
| Con `created_by_staff_id` | **0** |
| Con `modified_by_staff_id` | **0** |
| Completadas | **979** — de ellas, con `modified_by_staff_id`: **0** |
| `staff` con `compensation_model` | **0 de 7** |

**Ninguna cita de la base nació ni se cerró desde la app.** La base entera es
seed, y el seed no escribe ninguna de las dos columnas.

### Quién escribe cada campo

**`created_by_staff_id` — un solo escritor en todo el repo.**
`createAssistantAppointment` (`assistant-actions.ts:627`). No lo escriben: el bot
(su RPC `bot_create_appointment` recibe ocho parámetros y ninguno es el creador,
`confirmed.ts:132-139`) ni la ruta `POST /api/appointments`
(`api/appointments/route.ts:188-195`, que inserta ocho columnas y no incluye la
autoría). **Contraprueba de presencia:** el `grep` de `created_by_staff_id` sobre
`apps/`, `packages/` y `supabase/` devuelve exactamente una escritura y el resto
son la migración que la creó (`023_appointment_traceability.sql:22`), el trigger
de audit que la lee (`045_appointment_audit_capture.sql:73`) y el `select` del
dashboard (`dashboard.types.ts:160`).

**`modified_by_staff_id` — muchos escritores, y ése es el problema.** Lo escriben
cancelar (`:133`), **editar notas** (`:243`), completar (`:284`), no-show
(`:316`), confirmar (`:349`) y marcar llegada (`:386`), todas en
`assistant-actions.ts`; más la vista del barbero (`staff/actions.ts:94`) y la ruta
`PATCH` (`api/appointments/route.ts:273`).

### Los tres campos, y no son el mismo

| Pregunta | Campo | ¿Sirve? |
|---|---|---|
| **¿Quién cortó?** | `appointments.staff_id` | **Sí, y es sólido.** Un barbero sólo puede agendarse a sí mismo: la action ignora el `staffId` del cliente y fuerza el suyo (`assistant-actions.ts:442`, usado en el insert en `:618`) |
| **¿Quién cobró?** | `modified_by_staff_id` | **No.** Es "el último que tocó la fila", no "el que cerró". Alguien edita la nota del cliente el martes (`assistant-actions.ts:243`) y **pisa** al que cobró el lunes |
| **¿Quién dio de alta?** | `created_by_staff_id` | Sólo si vino del panel. Bot y API lo dejan NULL |

**Dónde sí queda quién cobró, aunque no en la cita:** `appointment_audit` guarda
la fila entera en cada mutación con su actor, así que el `UPDATE` que puso
`status='completed'` está ahí con el `staff_id` de quien lo hizo. Es recuperable —
pero por reconstrucción histórica, no por lectura de un campo. Nada en el producto
lo consulta hoy.

### Con comisión al 45%, qué es dinero y qué es auditoría

Conviene separarlos porque no fallan igual:

- **La comisión está bien definida y no depende de esto.** La base es
  `price_charged` agrupado por `appointments.staff_id`, y ese campo es sólido por
  construcción (arriba). Un barbero no puede acreditarse el corte de otro.
- **Lo que sí falta para pagarla:** `staff.compensation_model` existe en la BD
  (`comision / renta / sueldo`) y está **NULL en los 7 registros**, sin ninguna UI
  que lo escriba. El 45% no vive en el sistema — vive en la cabeza del dueño.
- **Lo que rompe sin recepción es la CUSTODIA, no el reparto.** Con mostrador, el
  efectivo tiene un dueño único hasta el corte. Con cinco barberos cobrando en su
  silla, "quién tiene los $174,990 de efectivo del mes" es exactamente la pregunta
  que ningún campo contesta hoy — y el corte a ciegas mide **un solo cajón**, no
  cinco bolsillos.

---

## D · Lo que se rompe: cinco cosas que asume una recepción

| Qué | ¿Quién lo haría sin recepción? | ¿El sistema lo permite hoy? |
|---|---|---|
| **Abrir la caja / el fondo** | el primero que llega | **No, y no lo permite para nadie.** `businesses.caja_fondo` tiene **cero escritores**: dos lecturas (`lib/corteData.ts:69,88`) y la migración que lo creó (`20260812000000_capa_dinero.sql:44`). No hay UI, ni action, ni endpoint. Vale 500 en el demo porque lo puso el seed |
| **Cuadrar al cierre (el corte)** | el último que cierra | **La action sí, la pantalla no.** `createCorte` acepta cualquier miembro del negocio (`caja-actions.ts:294` → `lib/auth.ts:180` incluye `barber`) y sólo exige `staffId`, que el PIN siempre trae (`caja-actions.ts:296`). Pero `CorteCard` se monta únicamente en la mesa (`AssistantControlDesk.tsx:920`) |
| **Registrar dinero fuera de la agenda** | el que lo cobró | **Sí, ya.** `CajaMovimientos` está montado en las dos superficies — la mesa (`AssistantControlDesk.tsx:915`) **y la pestaña Hoy del barbero** (`StaffLayout.tsx:301`) |
| **Contestar el teléfono y agendar** | el que tenga las manos libres | **Sí, con matiz.** El barbero tiene `+ Nueva cita` y el formulario ofrece `Llamada telefónica` como origen (`NewAppointmentForm.tsx:50-54`). Sólo puede agendarse **a sí mismo** (`assistant-actions.ts:442`): una llamada pidiendo a otro barbero no tiene camino |
| **Alta del cliente nuevo con su consentimiento** | el que lo atiende | **Sí el alta, no el consentimiento.** La cita y el cliente se crean; el consentimiento queda `consented_via: 'pending_notice'` (`assistant-actions.ts:547,577`) y sólo se consolida cuando el titular escribe al bot. Con la WABA parada (R1) eso **no ocurre nunca** |

Dos cosas más que la mesa hace y nadie heredaría, ya nombradas en A: **los cabos
sueltos** (las citas pasadas sin cerrar, `AssistantControlDesk.tsx:834`) y **la
ventana de WhatsApp** (`AssistantControlDesk.tsx:1236`). La primera importa: es el único lugar donde una
cita que nadie cerró vuelve a la superficie, y sin ella se evapora del cuadre.

---

## Correcciones al repo que este relevamiento encontró

Se anotan; **no se ejecutan** (este paso es sólo documento).

1. **`CLAUDE.md` describe mal el CHECK de `appointments.source`.** Dice
   `CHECK: bot / manual / walkin`. El CHECK real en prod es
   `bot / manual / walkin / llamada` (consultado en `pg_constraint`). El
   formulario del barbero ofrece `llamada` y **funciona**; el documento sugería
   que iba a rebotar.
2. **El tipo de `POST /api/appointments` es más estrecho que la BD:** su Zod es
   `z.enum(['bot','manual','walkin'])` (`api/appointments/route.ts:47`), así que
   esa ruta no puede crear una cita por llamada aunque la BD la acepte. No está
   roto — está desalineado, y el próximo que lea el enum va a creer que `llamada`
   no existe.

---

## Veredicto y lista corta

**¿Puede un barbero operar solo desde su teléfono? Sí, con tres excepciones.** Y
el orden importa: la primera es de dinero, la segunda de dinero, y la tercera de
nómina.

Criterio duro de la lista: **sin esto un barbero no puede operar solo.** No "sería
mejor", no "se nota la falta": no puede.

1. **El corte, en la vista del barbero.** Sin él el día se cierra sin contarse y
   toda la capa de dinero (D5) queda sin su verdad externa. **Es lo más barato de
   los tres:** la action ya lo acepta, falta la superficie.
2. **La pregunta del riel en el camino principal.** Mientras el `Terminó` del hero
   escriba `efectivo` sin preguntar, el cuadre produce un descuadre espejo del
   tamaño de la tarjeta, todos los días, y con signo de "falta dinero".
3. **Quién cobró, como campo propio.** `modified_by_staff_id` lo pisa la siguiente
   edición. Con cinco barberos cobrando en su silla y comisión al 45%, la custodia
   del efectivo no tiene dónde vivir.

### Después

- **El fondo de caja sin escritor** — hoy nadie lo puede poner desde el producto,
  con o sin recepción. Es de la lista corta de R1, no de ésta.
- **`compensation_model` sin UI** — el 45% no está en el sistema. Bloquea *pagar*
  la comisión, no *operar el día*.
- **Los cabos sueltos, fuera de la vista del barbero** — una cita sin cerrar se
  evapora del cuadre y él no tiene dónde verla.
- **Agendar a otro barbero desde una llamada** — hoy sólo puede agendarse a sí
  mismo.
- **El consentimiento en `pending_notice` para siempre** mientras no haya WABA.
  Heredado de R1, no empeora sin recepción.
- **La mesa en un teléfono** — medido y sin consecuencia: el barbero no llega a
  esa ruta.
