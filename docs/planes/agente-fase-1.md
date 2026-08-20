# Plan · Agente, fase 1 — la infraestructura (A1–A3)

**Qué es esto.** Los tres pasos de infraestructura que se pueden ejecutar hoy,
con la pausa de código levantada para este alcance y **solo para este alcance**.
Ninguno de los tres depende de las entrevistas ni de la WABA: los tres son
cimiento del "sistema con agente" y los tres son verificables sin un cliente
real enfrente.

**Contexto mínimo** (la discusión de dirección no está acá; esto es lo que hace
falta para ejecutar): el producto evoluciona a un sistema donde el bot y las
capturas son los **ojos** (datos con procedencia), los módulos puros ya emiten
**veredictos** (`cadence`, `fuga`, `senales`, `cobrado`, `corte`, `cabos`…), y
el agente **propone** — el dueño decide, todo queda auditado y el permiso lo
frena por tipo. La memoria es de dos pisos: el **piso duro** es la BD
relacional leída por herramientas tipadas (nada de embeddings para lo que ya es
estructurado); el **piso blando** sería pgvector para lo no-estructurado,
**cuando exista corpus** — hoy no existe y no se construye.

**El orden importa.** A1 arregla el instrumento que hoy miente sobre sí mismo:
sin él, cualquier automatismo nuevo hereda un canal de ejecución que reporta
verde sobre un 401. A2 escribe el contrato (solo documentos) que A3 necesita
para no inventarse estados ni actores. A3 pone el cimiento de datos del ciclo
"Analizar", sin UI.

---

## Decisiones cerradas (no re-discutir)

1. **Esta fase no manda nada.** Ni WhatsApp, ni plantillas, ni correo nuevo. No
   toca el bot ni el producto del dueño. A1 es infraestructura del operador; A2
   son documentos; A3 es esquema sin superficie.
2. **El agente propone; nunca ejecuta dinero.** Escribir en `caja_movimientos`,
   `caja_cortes`, `appointment_tips` o `appointments.price_charged` no es una
   acción del agente, en ninguna versión futura. Queda como regla de la
   constitución (A2) y como frontera del primitivo (A3).
3. **Toda transición de una tarea lleva autor y hora, y se guarda como evento
   nuevo** — nunca un `UPDATE` mudo sobre la fila. Mismo criterio que la capa de
   dinero: el pasado cerrado no se reescribe en silencio.
4. **El piso duro se lee con herramientas tipadas.** Cero embeddings sobre lo
   estructurado en esta fase y en las siguientes; pgvector espera corpus.
5. **Sin UI en esta fase.** La pantalla de "Analizar" la viste el ciclo 2 de
   diseño; adelantarla sería construir contra una maqueta que no existe.
6. **A2 es solo documentación.** No agrega una columna, no cambia un tipo. Si al
   escribirlo aparece código necesario, se registra como tarea nueva y no se
   ejecuta.

---

## Reglas globales heredadas (aplican a los tres pasos)

- **Un paso = una rama = un merge**, con los gates en verde y el cierre completo
  (estado en `SPRINT.md` + bitácora + `merge --ff-only` a `main`).
- **Gates**: `cd apps/lifestyle && npx tsc --noEmit` → 0 · `npx eslint .` → 0
  errores nuevos · `npm test` (raíz) completo en verde.
- **Cálculo nuevo = módulo puro** en `apps/lifestyle/src/lib/` + tests
  `node:test` en `tests/` de la **raíz**, agregados a la lista del script `test`
  del `package.json` raíz (si no está en la lista, no corre).
- **Tabla nueva nace blindada**: `tenantDb` en todo acceso, RLS habilitada **sin
  políticas** (deny-all; la app entra por `service_role`), fuera de la
  publicación Realtime, y append-only por trigger donde el dato sea histórico.
  Patrón `appointment_tips` / `caja_movimientos`.
- **Migración vía MCP + copia versionada en el repo** (convención desde la 046).
- **Español mexicano neutro** en prosa, comentarios y commits. Sin voseo, sin
  emoji en el copy.
- **Red de seguridad visual**: A1 y A3 no tocan `apps/` ni `packages/` en lo que
  se sirve al browser, así que el argumento fuerte no es una captura sino el
  diff — se declara explícitamente en cada paso (mismo razonamiento que P1 de
  `permiso.md`). A2 no toca código en absoluto.

---

## Lo que se verificó en vivo antes de escribir este plan (2026-08-20)

Todo lo de abajo salió de la BD de producción por MCP, no de memoria:

| Hecho | Medida |
|---|---|
| Versiones | `pg_cron 1.6.4`, `pg_net 0.20.0`, `supabase_vault 0.3.1` |
| Jobs activos | 3: `dispatch-auto-cancel` (`* * * * *`, `invoke_edge`), `corte-nudge` (`0 5 * * *`, `invoke_app`), `senales-digest` (`0 14 * * 1`, `invoke_app`) |
| Corridas registradas | **10,295** de auto-cancel, **7** de corte-nudge, **1** de senales-digest — y **cero** con estado distinto de `succeeded`, desde el 13-ago |
| Retención de la evidencia | `pg_net.ttl = 6 hours` (contexto `sighup`). Medido: `net._http_response` tenía 361 filas entre 15:41 y 21:40 UTC — exactamente la ventana de 6 h |
| Salud por riel | Las 360 respuestas de la ventana son **200**: el riel de `invoke_edge` está sano. El enfermo es `invoke_app`, cuyos 401 del 19-ago **ya se evaporaron** |
| Secretos en Vault | 4: `app_base_url`, `cron_secret`, `edge_base_url`, `edge_invoke_secret` |
| Tablas en `public` | 21. **Ninguna de tareas** → A3 es terreno limpio |

### El hallazgo que le cambia la forma a A1

`S8-OPS-01` describe el arreglo como "esperar/consultar `net._http_response` por
el `req_id` y `RAISE` ante no-2xx". **Eso no puede funcionar dentro del mismo
job**, y se midió:

- Un `net.http_post` encolado dentro de un bloque `DO $$` y poleado 25 veces
  cada 200 ms (`req_id` 10297) **nunca apareció** en `net._http_response`.
- El mismo POST fuera de transacción (`req_id` 10298) resolvió con status 405 en
  menos de lo que tardó una sola de esas consultas.

Es decir: **pg_net despacha después del `COMMIT`**. Un job que espere la
respuesta dentro de su propia transacción espera para siempre, y un `RAISE`
aborta la transacción que contiene la petición — el aviso se cancelaría a sí
mismo antes de que la petición saliera. La verificación tiene que ocurrir en
**otra** transacción. De ahí el diseño de dos tiempos de A1.

---

## A1 · [SEGURO] El meta-aviso del cron (S8-OPS-01)

**Objetivo:** que un cron que pegó contra un 401 deje de contarse como
entregado, y que la evidencia sobreviva más de seis horas.

**El problema, con su número:** `invoke_app` devuelve el `req_id` de la petición
encolada, no su resultado; pg_cron marca `succeeded` en cuanto la función
retorna. Siete corridas de `corte-nudge` y una de `senales-digest` figuran como
exitosas contra un 401 de la propia ruta. Un aviso que no puede avisar de su
propia falla no es un aviso.

### Forma: encolar deja rastro, verificar es otro job, la alarma es un tercero

**1. Rastro propio — tabla `cron_invocaciones`.** La escriben `invoke_app` e
`invoke_edge` en la misma transacción en que encolan (una fila por invocación):
`job_name`, `destino` (la ruta o el nombre de la function), `req_id` (UNIQUE),
`encolada_at`, y el resultado que llega después: `verificada_at`, `status_code`,
`error_msg`, `veredicto` (`pendiente | ok | falla | sin_respuesta`).

Resuelve el punto (3) de la tarea: `pg_net.ttl` es de **6 horas** y su contexto
es `sighup` — no se cambia con SQL de usuario en Supabase. La evidencia no se
retiene: se **copia** a una tabla nuestra antes de que el barrido la borre.

Dos reglas de higiene, escritas en la migración:
- **Nunca se guardan encabezados** (ahí viaja el `Authorization`).
- El cuerpo de la respuesta se guarda **solo cuando el status es no-2xx**, y
  recortado. Un 401 rinde `{"error":"No autorizado"}`, que es justo lo que hace
  falta; un 200 rinde el digest completo, que es dato del negocio y no tiene por
  qué vivir en una tabla de telemetría del operador.
- Purga por edad (90 días) dentro del verificador. Es telemetría, no registro
  de negocio: acá la purga es correcta, y por eso **no** lleva el trigger
  append-only de las tablas de dinero.

**2. Verificador — job nuevo cada 5 minutos.** Toma las filas `pendiente` con
más de un minuto de encoladas, las cruza contra `net._http_response` por
`req_id` y escribe el veredicto. Sin respuesta después de 10 minutos →
`sin_respuesta` (worker caído o timeout), que para la alarma cuenta como falla.
**No hace `RAISE`**: si lo hiciera, su propio `RAISE` revertiría lo que acaba de
escribir y la evidencia nunca se guardaría.

**3. Alarma — job separado cada 15 minutos.** Mira, por cada `job_name`, su
**última invocación verificada**; si es no-2xx, `RAISE EXCEPTION` con el nombre,
el status y el `req_id`. Así el fallo aparece en `cron.job_run_details`, que es
donde ya se mira. Tres propiedades que se eligieron a conciencia:
- refleja el **estado actual** del riel, no el historial: cuando la siguiente
  corrida sale bien, la alarma se pone verde sola, sin que nadie "acuse recibo";
- no escribe nada, así que su `RAISE` no tiene qué revertir;
- mientras algo esté roto **falla cada 15 minutos**, y eso es deliberado: una
  alarma que suena una vez y se calla es la falla que este paso vino a matar.

**Sin cambio de firma.** `invoke_app` e `invoke_edge` siguen devolviendo
`bigint`; los tres `cron.job` existentes **no se tocan**. El radio de explosión
es una tabla nueva y dos jobs nuevos.

**Archivos:**
- `supabase/migrations/<fecha>_meta_aviso_cron.sql` **nuevo** — tabla, `CREATE OR
  REPLACE` de las dos funciones de invocación, función verificadora, función de
  alarma, y los dos `cron.schedule`. Aplicada por MCP; el archivo queda como
  registro.
- `CLAUDE.md` → sección *Edge Functions*: la nota de estado de los crons pasa a
  describir el riel verificado.

**Aceptación (con contraprueba, que es la que manda):**
1. **Negativa obligatoria de la tarea** — con el `cron_secret` del Vault
   cambiado a un valor equivocado a propósito, una invocación manual de
   `invoke_app('/api/internal/corte-nudge')` deja fila con `veredicto='falla'` y
   `status_code=401`, y la siguiente corrida de la alarma queda **`failed`** en
   `cron.job_run_details` con el status en el mensaje. Si queda `succeeded`, el
   paso no está hecho.
2. **Restauración probada, no prometida**: el `cron_secret` vuelve a su valor y
   se demuestra por `md5` — el de la bitácora del 19-ago es
   `598598b426e499b7dac163d3654a0f76`, así que se compara sin sacar el secreto
   de la base.
3. **Control positivo** — una invocación de `invoke_edge('dispatch-auto-cancel')`
   (el riel sano, 200 medido hoy) deja `veredicto='ok'` y la alarma queda
   `succeeded`.
4. **Sondeo de las reglas de higiene**: la fila del 401 trae cuerpo recortado; la
   fila del 200 lo trae vacío; ninguna trae encabezados.

**Advertencia que Gabriel tiene que leer antes de aprobar:** el `CRON_SECRET`
de Vercel y el `cron_secret` del Vault **todavía no coinciden** (queda registrado
así en la bitácora del 19-ago, y es acción de entorno de Gabriel, no de código).
Con A1 puesto, el nudge diario va a **empezar a fallar en rojo** hasta que
coincidan. Eso no es un efecto secundario: es exactamente el trabajo del paso —
hoy ese mismo 401 se ve verde. Si el control positivo contra la app da 401, se
registra como hallazgo honesto y la corrección es de entorno.

**Qué NO toca:** las rutas de la app, el bot, las edge functions, el contenido de
los avisos.
**Red visual:** cero por construcción — el diff no toca un solo archivo de
`apps/` ni de `packages/`, así que el bundle servido es idéntico byte a byte.

---

## A2 · [SEGURO] El contrato agent-ready (solo documentos)

**Objetivo:** que exista un documento —`docs/planes/agente.md`— del que un
ejecutor pueda sacar, sin adivinar: qué sabe el sistema y con cuánta confianza,
por dónde entra ese saber, qué veredictos ya emite, qué acciones existen y qué
puede y no puede hacer el agente.

**Regla del paso:** cada afirmación se verifica contra el repo o contra la BD, y
la fuente queda escrita (archivo:línea o la consulta). Cuando el repo contradiga
al borrador, gana el repo y la corrección queda **marcada en el propio
documento** — la práctica que dejó `permiso.md` con sus siete correcciones.

### (a) El evento canónico y su etiqueta de confianza

Un evento con procedencia: qué pasó, sobre qué, cuándo, quién lo afirma, y **qué
tan difícil sería que fuera falso**. La escalera, de más a menos duro:

| Rung | Qué significa | Ejemplo verificado |
|---|---|---|
| **sellado-por-trigger** | Lo escribió la BD y nadie lo puede reescribir después | `price_charged` (trigger `seal_appointment_price`, freeze-once), `cash_diff`/`card_diff` (columnas `GENERATED`), toda fila de `appointment_audit` |
| **confirmado-humano** | Una persona lo tecleó y firmó con su sesión | monto editado al completar, `caja_movimientos` (lleva `staff_id`), los dos números del corte a ciegas |
| **default-sin-mirar** | El sistema puso un valor razonable y nadie lo contradijo | `payment_method = 'efectivo'` (`lib/cobro.ts`, `DEFAULT_RAIL`) |
| **derivado** | Calculado a partir de lo anterior | agenda futura × precio de lista, ocupación, potencial |
| **pendiente** | Se sabe que falta | cabos sueltos, `consent_at NULL`, `pending_notice` |

**Dos cosas que este paso tiene que decir en voz alta, porque son ciertas hoy:**

1. **La escalera ordena por integridad, no por autoridad.** "Sellado-por-trigger"
   está arriba porque es lo que ninguna mano puede cambiar después, no porque
   valga más que el juicio de una persona. Hay que **conciliarlo explícitamente**
   con los tres estados epistémicos de `capa-de-dinero.md` (confirmado /
   derivado / estimado), donde el héroe es lo confirmado por una persona. Los dos
   documentos tienen que quedar de acuerdo; si no, cada ejecutor va a elegir el
   que le convenga.
2. **Dos peldaños son hoy indistinguibles en reposo.** Un `price_charged` sellado
   por el trigger y uno tecleado por una persona se ven idénticos en la fila; lo
   mismo un `payment_method` elegido y uno por default. Y `appointment_audit`
   **no** los separa: su trigger es `AFTER`, así que ve la fila ya sellada y
   `changed_fields` incluye `price_charged` en los dos casos. A2 documenta el
   hueco y **propone** dónde iría la marca; **no la construye** — eso sería
   esquema, y este paso es de documentos.

### (b) Canales de captura y su momento ritual

Cada canal con: quién captura, **en qué momento del día lo hace** (el ritual es
lo que decide si el dato existe), qué escribe, qué confianza produce y qué **no**
captura. Los que existen hoy, verificados: el bot de WhatsApp; el alta manual y
el walk-in del asistente; el swipe del barbero (Terminó / No vino, monto y riel,
propina, "ya está acá"); la caja (`caja_movimientos`); el corte a ciegas y su
nudge de las 23:00; el formulario ARCO; la baja por "BAJA"; el cron de
auto-cancel; `owner_last_seen_at`; y los dos audits, que capturan solos.

### (c) Catálogo de veredictos que YA existen

Uno por módulo puro, con entradas, salidas y —el campo que importa— **cómo
explica lo que dice**: `cadence` (que ya trae `confidence` y `explanation`, y por
eso es el molde del contrato y no una invención), `retentionFeed`, `fuga`,
`senales` (las cuatro señales del operador, cada una con su `texto`), `cobrado`,
`corte`, `cabos`, `dayDrift`, `occupancy`, `staffRecompra`, `pulso`,
`clientelaStats`. Se anota cuál explica y cuál todavía no.

### (d) Catálogo de acciones tipadas, con dry-run

Las acciones reales de hoy —las 20 de `assistant-actions.ts`, las 5 del barbero,
las 5 de caja, las rutas de gestión— descritas como el agente las necesitaría:
precondición, efecto, **reversibilidad**, quién puede ejecutarla, y qué
devolvería su forma **dry-run** (el "esto haría" sin escribir). Nada se
implementa acá: es el mapa que la fase siguiente ejecuta.

### (e) La constitución del agente

Las reglas que ningún paso posterior puede aflojar sin tumbar el documento:
**solo propone**; **el dinero jamás lo escribe él**; **toda escritura lleva actor
en el audit**; **el opt-out lo frena el tipo** (`SendPurpose`: `proactive` exige
el lookup de bajas y falla cerrado — la regla ya es un tipo que no compila si se
ignora, y esa es la forma que hay que sostener); **topes de frecuencia** — y acá
se registra que hoy existen tres límites de **entrada** (PIN, ARCO, bot) y
**ninguno de salida**: nada impide mandarle a la misma persona dos reactivaciones
el mismo día. Ese tope no se construye en esta fase; se nombra como precondición
del primer envío.

**Aceptación:** el documento existe y **cada** entrada de los cuatro catálogos
trae su fuente verificada; la lista de contradicciones del borrador está escrita
donde se va a leer; y la conciliación con `capa-de-dinero.md` queda resuelta en
una dirección, no en las dos. Contraprueba barata y honesta: tomar tres
afirmaciones al azar del documento terminado y volver a verificarlas contra el
repo — si una falla, el paso no está hecho.

**Qué NO hace:** ni una columna, ni un tipo, ni una línea de producto.

---

## A3 · [SEGURO] El primitivo de tareas

**Objetivo:** que una propuesta del agente sea un objeto de primera clase con
ciclo de vida auditado, listo para que el ciclo 2 de diseño lo vista. Sin UI.

**Nombre de las tablas:** `agente_tareas` y `agente_tarea_eventos`, **en español
— decidido por Gabriel al aprobar el plan (2026-08-20)**, siguiendo a la capa
más reciente (`caja_movimientos`, `caja_cortes`). Decisión cerrada: no se
re-discute al ejecutar.

**`agente_tareas` — la tarea:**
- `business_id` (FK, `ON DELETE CASCADE`) — atada al negocio como todo lo demás.
- `estado` — `propuesta | aprobada | ejecutada | medida | descartada`.
  Desnormalizado para consultar barato; la verdad son los eventos.
- `origen` — qué veredicto la produjo (`cadence`, `fuga`, `senales`, `corte`,
  `cabos`, `manual`).
- `tipo` — qué propone. **Sin CHECK cerrado a propósito**: el catálogo de tipos
  lo define el diseño del ciclo 2, y cerrarlo hoy garantizaría una migración
  para agregar el primero que a alguien se le ocurra.
- `propuesta` (jsonb) — qué haría.
- `evidencia` (jsonb) — sobre qué datos se para, con las etiquetas de confianza
  de A2. Separada de `propuesta` porque son cosas distintas: una es el plan, la
  otra es el sustento.
- `explicacion` (text, **NOT NULL**) — el porqué en palabras del dueño. Es
  `NOT NULL` por diseño: una propuesta que no se puede explicar no se puede
  aprobar, y dejarla opcional garantiza que un día llegue vacía.
- `resultado` (jsonb) — **el campo que el corte llena**. Solo se puede escribir
  en la transición a `medida`.
- `clave` (text) + UNIQUE `(business_id, clave)` — idempotencia. Es lo que hace
  que **una descartada no reaparezca sola**: el generador que vuelva a proponer
  lo mismo choca con la clave en vez de crear un duplicado.
- `created_at`.

**`agente_tarea_eventos` — cada transición, append-only:** `tarea_id`,
`business_id` (desnormalizado, para `tenantDb`), `estado_desde` (NULL en el
alta), `estado_hacia`, `actor_type` (`agent | staff | system`), `actor_staff_id`
(FK a `staff`), `nota`, `datos` (jsonb), `created_at`. Trigger que bloquea
`UPDATE` y `DELETE` — el patrón de `caja_movimientos`, que frena incluso a
`service_role`, porque RLS no lo alcanza.

**La máquina de estados vive en la BD, no en la app.** Una función
`agente_tarea_transicion(...)` que en una sola transacción: toma la fila con
`FOR UPDATE`, valida la transición contra el mapa permitido, exige lo que cada
destino exige, inserta el evento y actualiza el `estado` desnormalizado.
Transiciones legales: `propuesta → aprobada | descartada`;
`aprobada → ejecutada | descartada`; `ejecutada → medida`; `medida` y
`descartada` son terminales. Exigencias por destino: `aprobada` y `descartada`
**requieren `actor_staff_id`** (una persona decide, no el agente); `medida`
**requiere `resultado`**.

**Nadie cambia el estado por la puerta de atrás.** Un `BEFORE UPDATE` sobre
`agente_tareas` falla si el `estado` cambia sin el GUC transaction-local que
solo pone la función de transición — el patrón `set_config(..., is_local => true)`
ya probado en las migraciones 047/048 (y que ahí resolvió justamente el problema
del pooler). Así, un `UPDATE` directo desde la app o desde SQL suelto **no puede**
saltarse el evento.

**Módulo puro espejo + guard de repo.** `apps/lifestyle/src/lib/agenteTareas.ts`
con el mismo mapa de transiciones, para que la UI del ciclo 2 pueda validar
antes de llamar; más un test de repo (el patrón de `tests/timeWindows.repo.test.ts`)
que **lee la migración** y falla si los dos mapas se separan. La autoridad es el
SQL —es el único que no se puede evitar—; el TypeScript es su reflejo, y el test
existe para que el reflejo no mienta.

**Archivos:**
- `supabase/migrations/<fecha>_agente_tareas.sql` **nuevo**.
- `apps/lifestyle/src/lib/agenteTareas.ts` **nuevo** (puro).
- `tests/agenteTareas.test.ts` y `tests/agenteTareas.repo.test.ts` **nuevos**,
  agregados a la lista del script `test` del `package.json` raíz.
- `CLAUDE.md` → *Database Schema*: las dos tablas entran a la tabla de "tablas
  que este documento no detalla", con su razón.

**Aceptación — sondeos y, sobre todo, negativas:**
1. Camino feliz: `propuesta → aprobada → ejecutada → medida` deja **cuatro**
   eventos en orden, cada uno con su autor y su hora.
2. `propuesta → ejecutada` directo: **RAISE**. No se puede saltar estados.
3. `descartada → aprobada`: **RAISE**. Lo descartado no revive.
4. `UPDATE` directo del `estado` sin pasar por la función: **RAISE**.
5. `UPDATE` o `DELETE` sobre un evento: **RAISE**.
6. `medida` sin `resultado`: **RAISE**.
7. `aprobada` sin `actor_staff_id`: **RAISE**.
8. Dos propuestas con la misma `clave` en el mismo negocio: choque de UNIQUE.
9. RLS: con la llave pública, `select` sobre las dos tablas devuelve **cero
   filas** (deny-all), y ninguna está en la publicación de Realtime.

Cada negativa se prueba con un bloque que **falla ruidoso si la operación pasa**,
no con un intento silencioso — la lección de P1 de `permiso.md`.

**Qué NO hace:** ninguna UI, ningún generador de propuestas, ninguna ejecución
automática, ningún tipo de tarea concreto. La tabla nace vacía y así se queda
hasta que el ciclo 2 diga qué se propone y cómo se ve.
**Red visual:** cero por construcción — el módulo nuevo no lo importa ninguna
superficie, así que el bundle servido no cambia.

---

## Lo que esta fase NO hace (y no se propone)

- **Envíos, plantillas de Meta, dinámicas, reactivación real** — gateados por la
  WABA (trámite de Gabriel) y por las entrevistas.
- **La UI del ciclo 2** — espera la exploración de diseño.
- **pgvector / embeddings** — sin corpus, no hay qué indexar.
- **La colisión raya × propina** — decisión de producto de Gabriel, pendiente.
- **`S7-NOTIF-01`** (desplegar el despachador) — sigue con su disparador propio:
  antes del primer cliente real que agende por el bot.

---

## Dependencias manuales

| Paso | Qué depende de Gabriel |
|---|---|
| A1 | Alinear `CRON_SECRET` (Vercel) con `cron_secret` (Vault). Sin eso, la alarma nueva va a estar en rojo desde el día uno — correctamente |
| A1 | Autorizar el cambio temporal del secreto del Vault para la contraprueba, con su restauración verificada por `md5` en la misma sesión |
| A2 | Ninguna |
| A3 | Confirmar el idioma de los nombres de tabla antes de escribir la migración |

---

## Registro en SPRINT.md (decidido al aprobar, 2026-08-20)

- **A1 = `S8-OPS-01`**, que ya existe con su disparador cumplido ("primera al
  levantar la pausa") y **conserva su ID**. Se marca 🔵 al arrancar. En sus notas
  de ejecución entra el hallazgo de pg_net, porque cambia la forma del arreglo
  respecto de como quedó escrita la tarea.
- **A2 = `S9-AG-01`** y **A3 = `S9-AG-02`**: **ola nueva `S9`**, decidida por
  Gabriel. Bloque propio y estado ⚪ en `SPRINT.md`, bajo el encabezado de la
  fase. **No llevan prompt en `SPRINT-PROMPTS.md`**: desde la capa de dinero, el
  plan de `docs/planes/` ES el prompt de ejecución (ese archivo quedó en las
  tareas hasta S4), y este documento cumple esa función para los tres pasos.

## Criterio de éxito, pre-registrado

La fase está bien hecha si, al cerrarla, se cumplen las tres a la vez:

1. **Un cron que falla se ve rojo.** Demostrado con el secreto equivocado, y con
   el riel sano en verde al lado para que el rojo signifique algo.
2. **Un ejecutor nuevo puede leer `docs/planes/agente.md` y saber qué sabe el
   sistema, con cuánta confianza y qué le está prohibido al agente** — sin
   preguntar y sin abrir el código, salvo para confirmar.
3. **Una tarea del agente no puede saltarse un estado, ni revivir, ni cambiar sin
   dejar autor y hora** — probado por las negativas, no por el camino feliz.

Al cerrar A3 se reporta y se frena. Lo que sigue depende del campo (entrevistas,
Meta) y del diseño (ciclo 2).
