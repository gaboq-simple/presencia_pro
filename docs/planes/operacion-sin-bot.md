# Zlot sin bot — relevamiento de la operación de un día (S9-OPS-02 · R1)

**Qué es esto.** Un relevamiento, no un plan. Contesta una sola pregunta contra
el código: **¿puede una barbería operar un día completo con Zlot sin bot, con
nadie más que el asistente en el mostrador?** Y donde la respuesta es no, dice
exactamente qué falta y dónde se ve el hueco.

**Solo documentos.** El diff de este paso no toca `apps/`, ni `packages/`, ni
`supabase/migrations/`. No hay propuestas de diseño, ni wireframes, ni nombres de
componentes nuevos: acá se describe lo que HAY y lo que FALTA.

**Por qué ahora.** El bot de WhatsApp está bloqueado por el trámite de Meta y no
hay fecha. Todo lo que el producto sabe hacer por su cuenta —agendar, avisar,
consentir, reactivar— entra por ese canal. La pregunta no es si el bot hace
falta: es si el mostrador se sostiene solo mientras tanto.

**Estado del repo cuando se escribió** (2026-08-25, rama `docs/operacion-sin-bot`
desde `main` en `c9d9aa8`). Verificaciones contra prod (`hdqazbuxtpavtioufrsv`)
del mismo día, marcadas donde aparecen.

> **Estado posterior — S9-OPS-03 (2026-08-25).** Este documento es una FOTO del
> repo al 2026-08-25 y **no se reescribe**: corregir el cuerpo falsearía lo que se
> observó. Lo que cambió después se anota acá y nada más.
>
> **Corregido:** el hallazgo mayor (el auto-cancel comiéndose los walk-ins) y su
> familia. El arreglo NO fue filtrar por `source` en los lectores —eso habrían
> sido tres parches sobre el mismo dato falso— sino en el ORIGEN: el walk-in de
> hoy nace con `arrived_at` puesto, porque el gesto de registrarlo con la persona
> enfrente **es** la evidencia. Con eso, los tres lectores quedan correctos sin
> tocarlos… salvo la cola de atrasados, que **no** miraba `arrived_at` y se
> arregló aparte. También se corrigieron las dos anotaciones del final (el valor
> muerto `status='walkin'` y el comentario "modo B"), y apareció un hallazgo
> nuevo de la misma familia: el contador **"N walk-ins"** del Panorama del dueño
> contaba por `status` y por lo tanto decía **0 siempre**.
>
> **Sigue en pie, sin tocar:** los otros cuatro de la lista corta (el fondo de
> caja sin escritor · el cobro de la cita agendada escondido en el acordeón · el
> retraso sin puerta manual · el aviso de cancelación que se registra como
> enviado) y todo el bloque "después".

---

## La sospecha, contra el repo: mitad cierta, y la mitad falsa es la que importa

> «Zlot está construido alrededor de la cita agendada, y el walk-in obliga a
> inventar una cita para poder cobrar.»

**Falso en la superficie.** Hay walk-in de primera clase en la mesa del
asistente: un botón `+ Walk-in` en el header
(`AssistantControlDesk.tsx:1012`), un tap en cualquier hueco libre del
calendario que abre la hoja ya apuntada a ese barbero y esa hora
(`AssistantControlDesk.tsx:393`), una hoja de captura mínima —nombre, teléfono
opcional, servicio con default— (`AssistantControlDesk.tsx:1087`) y un aviso
explícito antes de registrar en una hora que ya pasó
(`AssistantControlDesk.tsx:1165`). Y hay una **segunda** vía para el dinero de
alguien que nunca tuvo fila en la agenda: un movimiento de caja con concepto
`walkin`, que la UI rinde como **"Sin cita"** justamente para que no se confunda
con la otra (`lib/caja.ts:28`, y el comentario que lo explica en `lib/caja.ts:48`).
Dos caminos, nombrados distinto a propósito. Eso no es un producto ciego al
walk-in.

**Cierto en el fondo, y peor de lo que la frase decía.** El walk-in de la mesa
**es** una cita: `createAssistantAppointment` lo inserta con
`status: 'confirmed'` (`assistant-actions.ts:595`) como cualquier otra. Y ahí
empieza el problema, porque el resto del sistema trata esa fila como lo que dice
ser —una cita confirmada que espera a alguien— y no como lo que es —una persona
que ya está sentada en la silla:

- El cron `dispatch-auto-cancel` selecciona `status='confirmed'` con
  `arrived_at IS NULL` (`dispatch-auto-cancel/index.ts:407-408`) **sin ningún
  filtro por `source`**, y a los `auto_cancel_after_minutes` la marca `no_show`
  vía `mark_appointment_no_show` (`index.ts:295`), que tampoco filtra por
  `source` (verificado leyendo la definición en prod).
- La ficha del calendario **no ofrece "Llegó" para un walk-in**: el estado `walk`
  sale con `['termino', 'mensaje', 'mover', 'cancelar']`
  (`AssistantVerticalCalendar.tsx:255`), y `arrived_at` es lo único que lo
  protegería.
- En el demo `auto_cancel_after_minutes = 20` (verificado en prod). Un corte de
  30 minutos registrado a las 10:00 se vuelve `no_show` a las 10:20, **con el
  cliente todavía en la silla**.
- El cron está **vivo**: `dispatch-auto-cancel` es la única edge function
  desplegada, su job de pg_cron corre `* * * * *` y está `active`, con **6,980
  invocaciones `ok`** registradas en `cron_invocaciones` (verificado en prod,
  2026-08-25).

Y una vez marcada `no_show`, no hay vuelta desde la UI: `stateFor` resuelve
`no_show` **antes** que `walk` (`AssistantVerticalCalendar.tsx:148-150`), así que
la ficha pasa a ofrecer `['reagendar', 'mensaje', 'llamar']`
(`AssistantVerticalCalendar.tsx:254`) — sin "Terminó". El trigger
`trg_update_visit_stats` ya le sumó un no-show al cliente, y a los tres
(`max_noshows_before_flag = 3` en el demo) queda `is_flagged`.

**Corrección de paso:** `status = 'walkin'` existe en el CHECK de la tabla y se
lee en cuatro lugares del cliente, pero **nadie lo escribe**. El único sitio
donde aparece es la fila optimista del desk
(`AssistantControlDesk.tsx:600`), que vive hasta el `router.refresh()`. Contra
prod: **0 filas** con `status='walkin'` — los 192 registros con `source='walkin'`
están todos en `completed` (los del seed). El efecto lateral es que el comentario
de la cola de acción, *"walk-ins quedan fuera (modo B)"*
(`AssistantControlDesk.tsx:687`), **no describe el código**: el filtro real es
`a.status !== 'confirmed'` (`AssistantControlDesk.tsx:692`), y un walk-in ES
`confirmed` — así que a los 15 minutos (`max_late_minutes`) el walk-in que está
siendo atendido aparece en la columna de "atrasados" con la sugerencia de moverlo
o marcar que no llegó.

Reformulada, la sospecha queda así: **el walk-in no obliga a inventar una cita —
obliga a que una persona presente sea representada por una fila que el sistema
lee como una persona ausente.** No es un hueco de captura. Es una colisión de
significado entre una superficie que sí lo modeló y una máquina de fondo que no
se enteró.

---

## Parte A — El recorrido del día

Cada momento con lo que existe, dónde vive, qué falta, y la marca que pide el
relevamiento: **OBLIGA A INVENTAR** (el sistema exige un dato falso para
avanzar), **PIDE LO QUE NO SE TIENE** (un dato que el asistente no tiene a la
mano en ese instante) o **SE SALE DE PANTALLA** (hay que navegar a otra vista
para completar el gesto).

Antes de los ocho: **el asistente vive en una sola pantalla.** La rama
`role === 'assistant'` de `dashboard/page.tsx:125` devuelve
`<AssistantControlDesk>` (`:168`) y **retorna ahí mismo** — nunca llega a
`OwnerTabs`. Todo lo que sigue pasa dentro de esa pantalla, salvo donde se diga
lo contrario. Eso hace que "SE SALE DE PANTALLA" casi no aplique: lo que queda
fuera del alcance del asistente está fuera de su **rol**, no al otro lado de un
link.

### 1 · Abrir la caja en la mañana

**Qué existe.** Nada que se parezca a una apertura. El asistente entra con su PIN
de 4 dígitos (`PinForm.tsx`, `POST /api/auth/pin`), la sesión dura 7 días
(`lib/session.ts:47`) y la mesa arranca parada en hoy, en la tz del negocio. La
caja del día empieza vacía y muestra *"Todavía nada por aquí"*
(`CajaMovimientos.tsx:152`).

**Qué falta, y es un hueco de verdad.** El fondo de cambio existe como columna
(`businesses.caja_fondo`, migración `20260812000000_capa_dinero.sql:44`) y el
corte lo usa para calcular el efectivo esperado (`lib/corteData.ts:69,88`), pero
**ninguna superficie de la app lo escribe**. Contraprueba de presencia: los tres
únicos escritores de la tabla `businesses` en toda la app son
`api/business/config/route.ts:107` (solo `report_*` y `review_*`),
`api/business/hours/route.ts:119` (solo `office_hours`) y
`lib/ownerPresence.ts:34` (solo `owner_last_seen_at`). El fondo del demo (`$500`)
lo puso el seed, no una persona.

Consecuencia medible: en un negocio nuevo `caja_fondo` arranca en `0` por default
de la migración, y como el conteo del corte **sí** incluye el fondo —la card lo
dice con todas sus letras, *"Todo lo que hay, incluido el fondo"*
(`CorteCard.tsx:124`)— el descuadre de efectivo va a salir **positivo por el
monto exacto del fondo, todos los días**. Es justo el error sistemático que la
decisión D1 de `capa-de-dinero.md` nombró para no cometerlo, y hoy no hay forma
de evitarlo desde la app.

**Marca:** PIDE LO QUE NO SE TIENE (el fondo, que ni el asistente ni el dueño
pueden fijar desde ninguna pantalla).

### 2 · Llega alguien SIN cita y se le atiende

**Qué existe.** El camino corto y el largo, los dos completos:

- **Tap en el hueco** del carril del barbero (`AssistantControlDesk.tsx:393`) →
  hoja pre-apuntada, con la línea *"Encaja en {barbero} · {hora}"*
  (`:1090`) → nombre → **Crear walk-in →**. Si cabe limpio y no es pasado, se
  crea directo, sin pasar por el modo de colocación (`:359`).
- **`+ Walk-in`** del header (`:1012`) → hoja sin apuntar → **Elegir hueco →** →
  se iluminan los chips donde el servicio entra → tap en uno.
- Si la hora ya pasó, no se crea en silencio: sale la hoja *"Esta hora ya pasó ·
  ¿Registrar igual?"* (`:1165`) y solo entonces la action recibe `allowPast`
  (`assistant-actions.ts:408`, guard en `:484`).

**Qué falta.** Lo de arriba: la fila nace `confirmed` con `arrived_at` en NULL, y
el cron la va a cobrar como ausencia. El gesto que la protegería ("Llegó") no
existe para el estado `walk`.

**Marca:** OBLIGA A INVENTAR, y de la peor especie: el dato falso no lo teclea
nadie — lo escribe el sistema solo, 20 minutos después, sobre una persona que sí
vino.

### 3 · Se le asigna barbero y servicio

**Qué existe, y está bien resuelto.** El **barbero sale del gesto**: es la
columna donde se tocó, nunca un selector (`handleTapFreeSlot(staffId, startMin)`,
`AssistantControlDesk.tsx:393`). La **hora sale del gesto**: es el minuto del
hueco, convertido a la tz del negocio en el server. El **servicio sale del
catálogo**, con default al primero y su duración dibujando el bloque
(`AssistantControlDesk.tsx:324-328`), y el catálogo se carga en `lazy` al abrir
la hoja (`:305`). Solo se puede colocar donde de verdad cabe: turno menos
descanso menos bloqueo, sin solape (`walkinFitsAt`, `:373`).

**Qué falta.** El **nombre** se teclea siempre. `Buscar cliente` está
**deshabilitado** en el header, con `title="Disponible en la próxima iteración"`
(`AssistantControlDesk.tsx:1002`), así que un cliente que ya vino diez veces se
vuelve a escribir a mano. Sin teléfono, la action lo liga por **nombre exacto**
(`ilike`, `assistant-actions.ts:558-560`): dos "Juan" distintos colapsan en un
cliente, y "Jaun" crea uno nuevo. La server action `searchCustomers` existe y
funciona (`assistant-actions.ts`), pero ninguna superficie del asistente la
llama.

**Marca:** PIDE LO QUE NO SE TIENE (la identidad del cliente repetido, que el
sistema conoce y no ofrece).

### 4 · Se cobra en efectivo

**Qué existe.** El gesto es de tres taps y **cero caracteres tecleados** en el
caso normal: tap en el bloque del walk-in → **Terminó** en la ficha
(`AssistantVerticalCalendar.tsx:255`) → hoja de cobro con monto **vacío** y
placeholder del precio de lista, riel en **Efectivo** por default
(`CobroFields.tsx`, `lib/cobro.ts:23`) → **Terminó**
(`AssistantControlDesk.tsx:830`). Vacío significa "cobré el precio de siempre"
(`CobroFields.tsx:61`), la action no escribe `price_charged`
(`lib/cobro.ts:67`) y el trigger `seal_appointment_price` sella el precio de
lista. `completed_at` lo pone el server en ese instante
(`assistant-actions.ts:283`), y ese instante es la **atribución del dinero**
(`lib/corteData.ts:61-63`).

**Qué falta, y es el hallazgo grande.** Ese camino **solo existe para el
walk-in**. Para una **cita agendada** —`source` `bot` o `manual`— la ficha del
calendario nunca ofrece "Terminó": `actionsFor`
(`AssistantVerticalCalendar.tsx:252`) devuelve
`['llego', 'noLlego', 'mensaje', 'cancelar']` dentro de la ventana
(`:258-259`) y `['mensaje', 'mover', 'cancelar']` fuera de ella. En ninguna rama
aparece `termino` salvo `walk` (`:255`).

El cobro de una cita agendada **sí se puede hacer**, y por eso esto no es un
bloqueo total: la cita aparece en el bloque de cabos sueltos apenas su hora de
inicio queda atrás (`cabosData.ts:38` filtra `status in ('pending','confirmed')`
y `starts_at < now`), y ahí sí hay **Terminó** (`AssistantControlDesk.tsx:878`),
que abre la misma hoja de cobro. Pero ese bloque es un `<details>` **cerrado por
default**, rotulado *"N citas sin cerrar · de los últimos 14 días"*
(`AssistantControlDesk.tsx:862`). O sea: **la forma normal de cobrarle a un
cliente que acaba de terminar su corte está archivada bajo un acordeón que dice
que es deuda vieja.**

**Marca:** SE SALE DE PANTALLA — el único caso donde aplica de verdad, y no
porque haya que navegar, sino porque el gesto vive en una superficie que dice
significar otra cosa.

### 5 · Llega alguien CON cita, puntual

**Qué existe.** El calendario vertical dibuja el día por carriles, con la banda
del "ahora", y las citas se leen por color de estado. Tap en el bloque → ficha
con horario, teléfono y nota → **Llegó** dentro de la ventana anticipada de 10
minutos (`AssistantVerticalCalendar.tsx:258`). "Llegó" escribe `arrived_at` sin
tocar el status (`assistant-actions.ts:363`) y es lo que **protege la cita del
auto-cancel** (`dispatch-auto-cancel/index.ts:408`). Es idempotente
(`assistant-actions.ts:377`).

**Qué falta.** Solo lo del momento 4: después de "Llegó", cerrar la cita hay que
ir a buscarlo al acordeón. Fuera de eso, el momento está completo.

**Marca:** ninguna de las tres, salvo el arrastre del momento 4.

### 6 · Alguien no llegó / llegó tarde

**No llegó — qué existe.** Dos caminos y los dos funcionan: **No llegó** en la
ficha (`AssistantVerticalCalendar.tsx:259` → `noShowAppointment`,
`assistant-actions.ts:296`) y **Marcar no llegó** en la tarjeta de la cola de
acción (`ActionQueue.tsx:50`), que además libera el hueco. La cola calcula el
atraso contra `max_late_minutes` del negocio (`AssistantControlDesk.tsx:693`) y
propone el primer hueco compatible.

**Llegó tarde — qué falta, y no existe en absoluto.** El sistema tiene tres
columnas para el retraso avisado (`adjusted_starts_at`,
`delay_reported_minutes`, `late_arrival_acknowledged`) y **el único escritor de
las tres es el bot** (`states/confirmationResponse.ts:217`). No hay ninguna
pantalla, action ni ruta donde el asistente pueda registrar *"el cliente llamó,
llega 20 minutos tarde"*. Contraprueba de presencia: las tres columnas **sí se
leen** en el mostrador —la cola de atrasados usa
`adjusted_starts_at ?? starts_at` (`AssistantControlDesk.tsx:693,697`), el
corrimiento del día también (`lib/dayDrift.ts:153`) y el cron calcula su deadline
sobre la hora ajustada (`dispatch-auto-cancel/index.ts:438`)— así que la
maquinaria está entera y le falta la puerta de entrada humana.

Sin esa puerta quedan dos salidas, y las dos mienten. **Tocar "Llegó" cuando el
cliente todavía viene en camino** es escribir una llegada que no ocurrió, a
cambio de salvarlo del auto-cancel. **Mover la cita** es un `reschedule` real, que
además intenta avisarle al cliente (ver momento 5 de la Parte B). La única
alternativa honesta es no hacer nada y dejar que a los 20 minutos el cron lo
marque `no_show`, le sume el no-show al cliente y, a los tres, lo deje
`is_flagged`.

**Marca:** OBLIGA A INVENTAR.

### 7 · Venta de producto sin corte

**Qué existe, completo.** El bloque "Caja del día · Lo que no pasó por la agenda"
(`AssistantControlDesk.tsx:895`, componente `CajaMovimientos.tsx`) con el botón
`+ Movimiento` (`CajaMovimientos.tsx:146`). La hoja pide: **Entró/Salió** (default
Entró), **monto**, **concepto** —sin default, a propósito, para que el apurado no
guarde todo como "Sin cita" (`CajaMovimientos.tsx:10-12`)—, **riel** (default
Efectivo) y una **nota corta opcional** con placeholder por concepto
(`lib/caja.ts:65`). Los conceptos son espejo exacto del CHECK de la BD
(`lib/caja.ts:28`). La fila es append-only: anular es una **contraentrada**
firmada (`caja-actions.ts:141`), y el `occurred_on` lo calcula el server en la tz
del negocio, nunca el navegador (`caja-actions.ts:77-107`).

**Qué falta.** No hay catálogo de productos: el monto de una cera se teclea a
mano cada vez, y el "qué se vendió" vive en una nota de texto libre de 120
caracteres. Y el movimiento **no lleva barbero atribuido** más allá de quién lo
firmó (`staff_id` = el de la sesión), así que una venta de producto de Carlos
registrada por el asistente queda a nombre del asistente.

**Marca:** PIDE LO QUE NO SE TIENE (el precio del producto, que ningún catálogo
guarda).

### 8 · Cerrar y cuadrar en la noche

**Qué existe, y es la pieza mejor terminada del recorrido.** La card "El corte"
(`AssistantControlDesk.tsx:900`, componente `CorteCard.tsx`) pide **dos números**
—efectivo del cajón, total de la terminal— **a ciegas**: la propiedad no es de la
UI, es de la capa. No existe ninguna action que devuelva el esperado sin recibir
antes el conteo; `getInsumosDelCorte` solo se llama **dentro** de `createCorte`,
en el mismo request que ya trae los dos números
(`caja-actions.ts:239-243`, `caja-actions.ts:293`). Al guardar, el esperado se
**congela como columna** (no como vista) y el
descuadre es `GENERATED` en la BD, con signo. Se corrige con una fila nueva que
apunta a la anterior (`replaces_id`), nunca con un UPDATE.

**Qué falta.** El aviso al dueño sale por WhatsApp
(`caja-actions.ts:357-395`) y por lo tanto **no sale**. Acá el sistema es
honesto: guarda `notify_error` y la card lo muestra en ámbar, *"Aviso no
entregado · {razón}"* (`CorteCard.tsx:234-235`). En el demo la razón ni siquiera
es Meta: `report_whatsapp` está en NULL (verificado en prod), así que el aviso
falla con *"El negocio no tiene número de reportes configurado"*
(`caja-actions.ts:364`) — y ese campo **sí** es configurable, desde
`api/business/config/route.ts:109`, en una pantalla del **dueño** a la que el
asistente no llega.

**Marca:** ninguna para la captura. El aviso al dueño está roto, pero lo dice en
voz alta, que es la diferencia entre un hueco y una mentira.

---

## Parte B — Los 16 canales de captura, sin WhatsApp

Los canales son los de `docs/planes/agente.md` §2, en el mismo orden. "Peldaño"
remite a la escalera de confianza de ese documento (1 sellado-por-trigger ·
2 confirmado-humano · 3 default-sin-mirar · 4 derivado · 5 pendiente).

| # | Canal | ¿Mudo sin WhatsApp? | Gesto manual que lo sustituye | ¿Existe hoy? | Peldaño del dato por la vía manual |
|---|---|---|---|---|---|
| 1 | **Bot de WhatsApp** | **Sí, entero** | Walk-in / alta manual en la mesa | **Sí** — `AssistantControlDesk.tsx:1012,393` | **2** para la cita (una persona la tecleó). Pierde el `bot_logs` y la conversación |
| 2 | **Aviso de privacidad del bot** | **Sí** | *Ninguno* | **No existe** | **5 · pendiente, permanente.** Ver abajo |
| 3 | **Alta manual / walk-in** | No | — (ya es manual) | **Sí** — `assistant-actions.ts:428` | 2 la cita · **5** el consentimiento (`:547`) |
| 4 | **"Llegó"** | No | — (ya es manual) | **Sí** — `assistant-actions.ts:363` | 2. **Pero no se ofrece para walk-ins** (`AssistantVerticalCalendar.tsx:255`) |
| 5 | **Cierre de la cita (cobro)** | No | — (ya es manual) | **Parcial** — walk-in por la ficha (`:255`); cita agendada **solo** por el acordeón de cabos (`AssistantControlDesk.tsx:878`) | 1 si el monto lo sella el trigger · 2 si lo tecleó una persona · 3 el riel por default |
| 6 | **Propina** | No | — (ya es manual) | **Sí, pero solo del lado del barbero** — `staff/actions.ts:129`, gate `role !== 'barber'` → `Forbidden`. **La mesa del asistente no la tiene, por diseño** | 2 |
| 7 | **Caja** | No | — (ya es manual) | **Sí** — `caja-actions.ts:81,141`, UI `CajaMovimientos.tsx:146` | 2 |
| 8 | **Corte a ciegas** | La captura no; **el aviso al dueño sí** | Decírselo por fuera | **Captura sí** (`caja-actions.ts:293`) · **aviso no**, y lo declara (`CorteCard.tsx:235`) | 1 el descuadre · 2 los conteos |
| 9 | **Baja ("BAJA")** | **Sí** | *Ninguno* | **No existe** — `isOptOutCommand` (`lib/opt-out.ts:62`) solo se llama desde el webhook (`api/bot/route.ts:479,541`) | — . Hoy inocuo: sin envíos no hay de qué darse de baja |
| 10 | **ARCO** | **No** | — (formulario público, sin sesión) | **Sí** — `api/arco/route.ts:51` | 2 |
| 11 | **Cron de auto-cancel** | No — está vivo y corriendo | — | **Sí, y ese es el problema** (Parte A, momentos 2 y 6) | 1 |
| 12 | **Presencia del dueño** | No | — (abrir el dashboard) | **Sí** — `lib/ownerPresence.ts:34` | 1 (best-effort) |
| 13 | **Audit de citas** | No | — (automático) | **Sí** — `045_appointment_audit_capture.sql` | 1 |
| 14 | **Audit de gestión** | No | — (automático) | **Sí** — `lib/managementAudit.ts`. Cero filas hoy porque el asistente no llega a la configuración | 1 |
| 15 | **Handoff humano** | **Sí** | Escribir desde el WhatsApp **personal** del negocio | **Sí, como link** — `wa.me` en la ficha (`AssistantVerticalCalendar.tsx:326`) y `tel:` para llamar (`:327`) | **Nada.** El mensaje sale de un teléfono que el sistema no ve: no hay fila en `conversation_messages` |
| 16 | **Invocaciones de cron** | No | — | **Sí** — `cron_invocaciones` (A1) | 1 |

**Cinco quedan mudos** (1, 2, 9, 15, y la mitad de salida del 8). De esos, tres
tienen sustituto manual que existe y funciona; **dos no tienen ninguno**, y uno
de los dos es estructural:

> **El consentimiento no tiene puerta manual, y sin el bot no la va a tener.**
> El CHECK de `customers.consented_via` admite `manual_registration`, pero
> **ningún archivo del repo lo escribe** (contraprueba: los dos únicos escritores
> son `assistant-actions.ts:547,577` con `pending_notice`, y
> `states/greeting.ts:117,136` con `whatsapp_first_message`). Toda alta de
> mostrador nace en `pending_notice`, y **la única salida de ese estado es que el
> titular le escriba al bot**. El guard de salida lo trata igual que una baja:
> `optOutLookup.ts:60` bloquea con *"el titular todavía no vio el aviso de
> privacidad"*, y `sendWhatsAppMeta` falla cerrado
> (`packages/engine/src/notifications/whatsapp.ts:114`).
>
> Medido contra prod hoy: de 125 clientes, **84 con `consented_via` NULL, 39 en
> `pending_notice` y 2 con consentimiento real**. Es decir que **el 98% de la
> clientela es incontactable de forma proactiva**, y cada día de operación sin
> bot agranda ese número. Hoy no duele porque no hay envíos; el día que llegue la
> WABA, la base entera va a estar del lado equivocado del guard.

**El caso 15 merece su matiz**, porque es el más fácil de leer mal: el link
`wa.me` de la ficha **funciona** sin la WABA —abre el WhatsApp personal de quien
esté en el mostrador— y por eso la comunicación con el cliente no se detiene.
Pero el sistema no se entera: no hay `conversation_messages`, no hay historial,
no hay handoff, y el dueño no puede auditar nada de lo que se dijo. El canal no
queda mudo; queda **invisible**.

---

## Parte C — El costo en toques y en caracteres

Contado sobre la mesa del asistente, en el camino más corto que la UI permite.
"Toques" incluye el tap que abre la hoja y el que la confirma. "Tecleado" es lo
que una persona escribe con el pulgar.

| Gesto | Toques | Tecleado | De dónde sale cada campo |
|---|---|---|---|
| **Walk-in** (tap en hueco) | **2** — hueco · Crear walk-in | nombre (~8–20 car.) | barbero = **la columna tocada** ✓ · hora = **el minuto tocado** ✓ · servicio = **catálogo**, default el primero ✓ · duración = **del servicio** ✓ |
| **Walk-in** (`+ Walk-in`) | **3** — botón · Elegir hueco · hueco | nombre | ídem |
| Walk-in con teléfono | +0 (mismo formulario) | +10 dígitos | — |
| Walk-in cambiando servicio | +2 (abrir select · elegir) | 0 | catálogo ✓ |
| **Llegó** | **2** — bloque · Llegó | **0** | el instante lo pone el server ✓ |
| **Cobrar** (walk-in, precio de lista) | **3** — bloque · Terminó · Terminó | **0** | monto = **precio de lista sellado por el trigger** ✓ · riel = **default efectivo** ✓ · `completed_at` = **el instante del tap** ✓ |
| Cobrar con monto distinto | +0 | monto (~3–4 dígitos) | riel sigue viniendo del default ✓ |
| Cobrar con otro riel | +1 (chip) | 0 | — |
| **Cobrar** (cita agendada) | **4** — abrir el acordeón · Terminó · Terminó | **0** | ídem, pero el primer tap es abrir "N citas sin cerrar" |
| **No llegó** (ficha) | **2** — bloque · No llegó | **0** | — |
| **No llegó** (cola) | **1** — Marcar no llegó | **0** | ✓ el mejor gesto de la mesa |
| **Cancelar** | **3** — bloque · Cancelar · Cancelar cita | motivo opcional (libre) | — |
| **Mover / reagendar** | **3** — bloque · Mover · hueco destino | **0** | barbero y hora = **el destino tocado** ✓ |
| **Movimiento de caja** | **3** — + Movimiento · concepto · Registrar | monto (~3–4 dígitos) + nota opcional | tipo = **default Entró** ✓ · riel = **default Efectivo** ✓ · `occurred_on` = **server, tz del negocio** ✓ · concepto = **tap, sin default a propósito** ✓ |
| Movimiento de salida | +1 (Salió) | ídem | los conceptos cambian con el tipo (`CajaMovimientos.tsx:94`) |
| **Anular un movimiento** | **1** — Anular | **0** | contraentrada armada por el server ✓ |
| **El corte** | **1** — Guardar el corte | **2 números** contados a mano | los dos son verdad externa: **no son recuperables ni deben serlo** |

### El inventario de peldaños

**Ya recuperados** (el gesto o el catálogo dan el dato, y nadie teclea): el
barbero, la hora y la duración del walk-in; el instante de la llegada; el monto
del cobro cuando es el de lista; el riel; el `completed_at`; el `occurred_on` de
la caja; el destino de un reacomodo; la contraentrada de una anulación. Es una
lista larga, y explica por qué la mesa se siente rápida: casi todo lo que la
capa de dinero necesita **ya sale de un tap**.

**Recuperables y todavía no recuperados** — los que hoy se teclean pudiendo salir
de algo que el sistema ya sabe:

1. **El nombre del cliente repetido.** `searchCustomers` existe
   (`assistant-actions.ts`) y el botón que la llamaría está deshabilitado
   (`AssistantControlDesk.tsx:1002`). Recuperarlo no ahorra solo caracteres:
   sube el peldaño de la **liga cita↔cliente**, que hoy se resuelve por `ilike`
   sobre el nombre (`assistant-actions.ts:558`) y por lo tanto es peldaño 4
   (derivado, y por una heurística frágil) disfrazado de peldaño 2.
2. **El teléfono del cliente repetido.** Mismo origen, mismo arreglo. Hoy se
   re-teclea o se omite, y omitirlo es lo que deja al cliente en
   `pending_notice` para siempre.
3. **El precio de un producto.** No hay catálogo de productos, así que el monto
   de la caja se teclea. Es recuperable **en principio** —la forma ya existe para
   `services`— pero requiere una tabla que hoy no está; se anota como recuperable
   con costo, no como recuperable barato.

**No recuperables, y correctamente así:** los dos números del corte (son la
verdad externa que la capa entera existe para contrastar) y el motivo de una
cancelación (texto libre porque el mundo lo es).

### Captura en lote

Hay **una sola pantalla** que invita a capturar en lote, y es la que ya
apareció en la Parte A: el `<details>` de **"N citas sin cerrar · de los últimos
14 días"** (`AssistantControlDesk.tsx:856-890`), con **Terminó** y **No vino**
por fila, hasta 8 a la vista (`:866`).

Por qué importa, con la aritmética a la vista: `completeAppointment` escribe
`completed_at: new Date()` (`assistant-actions.ts:283`) y el corte atribuye el
dinero por `completed_at`, no por `starts_at`
(`lib/corteData.ts:61-63`). Entonces **cerrar a las 9pm cinco citas de
ayer mete el dinero de ayer en el corte de hoy** — y el de hoy se va a comparar
contra un cajón que nunca vio esos billetes. El descuadre resultante es negativo,
grande, y **perfectamente inexplicable** para quien lo mire: no es un error de
conteo ni un robo, es un artefacto del momento en que alguien tocó un botón.

Dos matices que evitan leer esto como una acusación al diseño. Primero, la
atribución por `completed_at` **es** la decisión D6 y es la correcta para el caso
que la motivó (una cita de las 19:00 cobrada a las 23:40 es de ese día). Segundo,
el bloque de cabos existe justamente para que lo pasado sin resolver **se vea y no
se absorba** (`lib/cabos.ts:6-12`), que es lo contrario de esconderlo. El
problema no es que el lote exista: es que **la misma superficie sirve dos
propósitos incompatibles** —cobrar al cliente que acaba de levantarse de la silla,
y saldar deuda de días anteriores— sin distinguirlos, y el segundo contamina el
cuadre del primero.

Contraprueba de presencia: la card del corte **sí** se protege de esto en su
propio terreno —solo se puede hacer el corte de hoy (`CorteCard.tsx:52`), y el
esperado queda congelado como columna, así que un cierre tardío de mañana no
reescribe el corte de hoy. La defensa existe de un lado del muro y no del otro.

---

## Parte D — Veredicto

> **Sí, con cuatro excepciones — y una de ellas se rompe sola, sin que nadie se
> equivoque.**

Un asistente solo en el mostrador puede, hoy, con el bot apagado: abrir la mesa
con su PIN, ver el día completo por carriles, registrar walk-ins de dos toques,
marcar llegadas, cobrar con monto y riel, mover citas con el dedo, marcar
ausencias, registrar ventas de producto y salidas de caja, anular lo que se
equivocó, y cerrar el día con un corte a ciegas que produce un descuadre con
signo. Eso es un día de barbería, y está construido. **El relevamiento no
encontró un producto ciego al mostrador: encontró un mostrador bien resuelto con
cuatro agujeros, uno de ellos activo.**

Las cuatro excepciones, en orden de daño:

1. **El auto-cancel se come los walk-ins** (activo, sin intervención humana).
2. **El fondo de caja no se puede fijar**, así que el cuadre arranca torcido
   todos los días de un negocio nuevo.
3. **El cliente que avisa que llega tarde no tiene dónde ser registrado**, y las
   dos salidas disponibles escriben algo falso.
4. **Los avisos al cliente no salen**, y en el caso de la cancelación el sistema
   **registra que salieron**.

### La lista corta — sin esto no se puede operar un día

1. **Un walk-in que dura más que `auto_cancel_after_minutes` se vuelve `no_show`
   solo.** El cron no filtra por `source`
   (`dispatch-auto-cancel/index.ts:407-408`, `:295`) y la ficha del walk-in no
   ofrece "Llegó" (`AssistantVerticalCalendar.tsx:255`), que es lo único que lo
   protegería. Con `auto_cancel_after_minutes = 20` y cortes de 30 minutos, **el
   caso normal de una barbería de barrio es el caso roto**. Además el cliente
   —una persona real, que pagó— acumula no-shows y termina `is_flagged`.
2. **El fondo de caja no tiene escritor en la app.** `caja_fondo` se lee
   (`lib/corteData.ts:69,88`) y nunca se escribe: los tres únicos UPDATE sobre
   `businesses` son `api/business/config/route.ts:107`,
   `api/business/hours/route.ts:119` y `lib/ownerPresence.ts:34`. Con el default
   `0`, y con el conteo incluyendo el fondo por instrucción explícita de la card
   (`CorteCard.tsx:124`), **cada corte nace con un descuadre sistemático**. La
   capa de dinero deja de significar el primer día.
3. **Cobrar una cita agendada solo existe dentro del acordeón de cabos.**
   `actionsFor` no ofrece `termino` para ningún estado que no sea `walk`
   (`AssistantVerticalCalendar.tsx:252-259`); el único "Terminó" para una cita
   agendada vive en el `<details>` cerrado rotulado "de los últimos 14 días"
   (`AssistantControlDesk.tsx:862,878`). El gesto más frecuente del día está
   archivado como excepción.
4. **No hay dónde registrar "avisó que llega tarde".** Las tres columnas existen
   y se leen en tres lugares del mostrador
   (`AssistantControlDesk.tsx:693`, `lib/dayDrift.ts:153`,
   `dispatch-auto-cancel/index.ts:438`); el único escritor es el bot
   (`states/confirmationResponse.ts:217`). Sin puerta manual, avisar que se
   llega tarde **empeora** la situación del cliente: a los 20 minutos el cron lo
   marca ausente igual.
5. **El aviso de cancelación no sale y queda registrado como enviado.**
   `sendCancellationNotice` devuelve `{ success: false }` sin lanzar
   (`lib/whatsapp-templates.ts:341` → `:183`), y `cancelAppointment` inserta la
   fila de `scheduled_notifications` con `sent_at: now`
   (`assistant-actions.ts:207`) **sin mirar el resultado**. El cliente llega a
   una cita cancelada, el asistente no sabe que tiene que llamarle, y la
   auditoría dice que se le avisó. Contraprueba de que sí se puede hacer bien:
   el corte guarda `notify_error` y lo muestra en ámbar
   (`caja-actions.ts:395`, `CorteCard.tsx:235`).

Cinco, no seis. El sexto candidato —`Buscar cliente` deshabilitado— no entró: sin
él el día se opera igual, aunque la clientela se degrade. Va abajo.

### Después

- **`Buscar cliente` deshabilitado** (`AssistantControlDesk.tsx:1002`) con la
  action ya escrita. Cuesta caracteres en cada walk-in y ensucia la liga
  cita↔cliente (`ilike` sobre el nombre, `assistant-actions.ts:558`), que
  alimenta cadencia, clientela y rescate.
- **El consentimiento sin puerta manual.** `manual_registration` está en el CHECK
  y no lo escribe nadie; el 98% de la base está del lado bloqueado de
  `optOutLookup.ts:60`. **Disparador explícito:** el día que la WABA se apruebe,
  esto pasa a bloquear todo lo proactivo y sube a la lista corta.
- **La copia del despachador en Deno sin guard de baja** (contradicción 5 de
  `agente.md`). Hoy inocuo porque `dispatch-lifestyle-notifications` no está
  desplegada — una sola edge function en el proyecto, verificado. Se cruza con
  **S7-NOTIF-01**.
- **Sin catálogo de productos.** El monto de una venta se teclea y el "qué" vive
  en una nota libre; el movimiento no atribuye barbero más allá de quién firmó.
- **La caja no distingue el walk-in cobrado sin cita del walk-in agendado.** Son
  dos conceptos distintos y nombrados distinto a propósito
  (`lib/caja.ts:48-52`), pero nada impide registrar el mismo corte por los dos
  caminos y contarlo dos veces.
- **`status = 'walkin'` es un valor muerto** del CHECK: se lee en cuatro lugares,
  no lo escribe nadie, 0 filas en prod. Mientras exista, cualquier lector nuevo
  va a asumir que discrimina algo.
- **El comentario de la cola de acción miente** sobre los walk-ins
  (`AssistantControlDesk.tsx:687` contra el filtro real de `:692`).

---

## Lo que este relevamiento NO verificó

Se declara en vez de rellenarse con lo probable.

- **No se corrió el escenario del walk-in devorado por el cron.** La conclusión
  es de lectura de código (dos filtros sin `source`, la definición del RPC leída
  en prod, la ausencia de "Llegó" en el estado `walk`) más la evidencia de que el
  cron está vivo (6,980 invocaciones `ok`). No se creó un walk-in en prod para
  verlo pasar a `no_show`: habría ensuciado el `noshow_count` de un cliente del
  demo y `appointment_audit` es append-only. **Es una predicción bien fundada, no
  una observación.**
- **No se midió la operación real de nadie.** Los conteos de toques salen de leer
  la UI, no de mirar a una persona usarla. Un mostrador real va a encontrar
  fricciones que este documento no ve.
- **No se recorrió la vista del barbero como camino alternativo.** Existe y está
  completa —swipe Terminó/No vino con ventana de deshacer de 5 s
  (`AppointmentThread.tsx:86`), el héroe (`HeroCard.tsx:209`), la ficha
  (`AppointmentSheet.tsx:201`) y la propina (`staff/actions.ts:129`)— pero la
  pregunta era explícitamente "con nadie más que el asistente en el mostrador".
  Varias de las excepciones de arriba se disuelven si el barbero tiene su
  teléfono con sesión; ninguna de las cinco de la lista corta depende de eso,
  salvo la 3 en parte.
- **No se verificó el comportamiento con la WABA viva.** Todo lo que se dice de
  los envíos es sobre el camino de código, no sobre Meta.
- **No se auditó `AssistantVerticalCalendar` completo** (1,406 líneas). Se leyó lo
  que decide acciones, estados y colocación.

---

## Verificación mecánica de las referencias

Las **108** referencias `archivo:línea` distintas de este documento se
verificaron **mecánicamente**, no por muestreo: un manifiesto que parea cada
referencia con un token esperado, y un pasador que abre esa línea exacta y falla
si el token no está. Los rangos (`a-b`) se comprueban por sus dos extremos; las
listas (`a,b`) por cada elemento; las referencias desnudas (`` `:168` ``) heredan
el último archivo nombrado. El conteo cubre el **cuerpo** del documento; las
referencias que esta misma sección cita como ejemplo quedan fuera, porque no
afirman nada sobre el repo.

```
awk -F'\t' '{cmd="sed -n \047"$2"p\047 \""$1"\""; cmd|getline l; close(cmd);
  if (index(l,$3)==0) printf "MAL %s:%s\n",$1,$2}' refs.tsv
```

Además se cruzó en las dos direcciones: **ninguna** referencia del documento
quedó fuera del manifiesto, y **ninguna** entrada del manifiesto apunta a algo
que el documento no cite.

**Resultado: 108/108**, y hubo que llegar ahí. El borrador tenía **29**
referencias mal: **3** las cazó la lectura al armar el manifiesto (entre ellas el
"Terminó" del acordeón de cabos, escrito en `:872` y vivo en `:878`), **25** las
cazó la primera pasada del script, y **1** la cazó el cruce de cobertura —una
referencia que ningún regex encontraba porque el code span quedaba partido por
un salto de línea, o sea el peor caso posible: una referencia que se lee bien y
que ninguna herramienta revisa.

La más lejana erraba por **15 líneas** (`noShowAppointment`, escrita en `:311`,
vive en `:296`). Veintinueve de ciento ocho es **27%**: en un documento cuyo
único valor es que el próximo lector no tenga que adivinar, un cuarto de las
coordenadas apuntaba al lugar equivocado. Esa es la medida de para qué sirve
este paso de verificación, y la razón de dejarlo escrito.
