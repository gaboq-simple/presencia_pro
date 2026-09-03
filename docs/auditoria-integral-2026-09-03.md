# Auditoría integral — presenciapro / apps/lifestyle (2026-09-03)

> **Protocolo:** trabajo **ad-hoc**, fuera de `SPRINT.md`. No se ejecutó ningún cambio de
> código: la pausa de código sigue vigente fuera de la fase del agente. Este documento es
> el informe y el plan; nada de lo que propone se ejecuta sin que Gabriel lo apruebe.
>
> **Método:** lectura del código en `main` limpio (`014b9b0`), consultas de solo lectura
> contra la BD de producción (`hdqazbuxtpavtioufrsv`), advisors de Supabase, y verificación
> mecánica: `npm test` → **906/906 en verde**, `npx tsc --noEmit` → **limpio**.
>
> **Lo que este informe NO repite:** `docs/planes/operacion-sin-bot.md` (R1) y
> `docs/planes/sin-recepcion.md` (R2) ya relevaron la operación del mostrador y de la silla
> con más detalle del que cabe acá. Se verificó cuáles de sus hallazgos siguen abiertos y se
> citan como tales; lo demás es nuevo.

---

## 1. Resumen ejecutivo

El sistema **no está desordenado ni improvisado**. Tiene invariantes explícitas y sostenidas
(la regla "presente no es ausente", el aislamiento por `tenantDb`, la separación
puro/datos en `lib/*.ts` + `lib/*Data.ts`, el append-only de la caja), una suite de 906
tests puros y un tipado limpio. La deuda que tiene no es de estilo: es de **bordes** — las
puertas que quedaron abiertas cuando una misma capacidad terminó teniendo dos caminos.

Cuatro hallazgos son críticos. Tres son nuevos.

| # | Hallazgo | Impacto | Esfuerzo |
|---|---|---|---|
| **C1** | Escalada de privilegios: un barbero con PIN puede reescribir el horario de cualquier compañero por server action | Alto | Bajo |
| **C2** | La sesión por PIN no se revoca: desactivar a un barbero no lo saca (7 días de cookie válida) | Alto | Bajo |
| **C3** | Deriva de esquema: hay una migración en producción **sin archivo en el repo**; reconstruir desde el repo rompe el alta de clientes **en silencio** | Alto | Bajo |
| **C4** | `caja_fondo` sin escritor en la app → todo corte nace con descuadre sistemático (abierto desde R1) | Alto | Bajo |

Y una lectura de producto, que es la más importante de todas: **la capa de dinero está
construida y no se puede usar completa**. El fondo no se puede fijar, la comisión no tiene
dónde vivir, el corte es uno por día y no por turno, y "quién cobró" no tiene campo propio.
Son cuatro huecos chicos que, juntos, dejan al dueño sin la única pregunta que le importa a
las 22:00: *¿cuánto entró, quién lo cobró y cuánto le toca a cada quien?*

---

## 2. Orden y flujo del código

### 2.1 La arquitectura, como está hoy

```
Monorepo (npm workspaces)
├── packages/engine/          ← motor conversacional + notificaciones (sin React, sin Next)
│   └── src/bot/lifestyle/    ← FSM: handler.ts → router.ts → states/*.ts
├── apps/lifestyle/           ← el producto (Next.js 16, App Router)
│   └── src/
│       ├── app/api/*         ← 30 rutas HTTP; puerta del DUEÑO (gates owner|admin)
│       ├── app/staff/*.ts    ← 5 módulos de server actions; puerta del MOSTRADOR y la SILLA
│       ├── lib/*.ts          ← lógica pura (testeable, sin BD)
│       ├── lib/*Data.ts      ← la query scopeada que alimenta al puro
│       └── components/{staff,admin,site}/
├── apps/sellers-portal/      ← otro producto, fuera de alcance
└── clients/dra-quevedo/      ← experimento apagado, fuera de alcance
```

**Los tres patrones que el repo ya sostiene bien, y que hay que declarar como invariantes
formales** (hoy viven en comentarios, no en un contrato):

1. **`lib/X.ts` puro + `lib/XData.ts` con la query.** La matemática no toca la BD y la BD no
   hace matemática. Es la razón por la que 906 tests corren sin red. Aplicado en `corte`,
   `caja`, `pulso`, `fuga`, `cabos`, `diaRail`, `equipoSemana`.
2. **`tenantDb(supabase, businessId)` para toda tabla con `business_id`,** con lint global que
   rompe el build ante un `.from()` crudo. El aislamiento multi-tenant está cerrado por
   construcción, no por disciplina.
3. **"Presente no es ausente":** ningún campo que afirme un hecho del mundo se escribe sin
   evidencia. Ya cerró `arrived_at` (S9-OPS-03), el riel (S9-OPS-06) y `sent_at` (S9-OPS-08).

### 2.2 Lo que está desordenado, con nombre

**a) Dos puertas para la misma capacidad, con gates distintos.** Es el defecto estructural
del repo y el origen de C1.

| Capacidad | Puerta A (ruta) | Gate A | Puerta B (server action) | Gate B |
|---|---|---|---|---|
| Horario semanal | `api/staff/[id]/schedule` | `owner\|admin` + audit | `updateStaffSchedule` | **sesión cualquiera, sin audit** |
| Día libre / excepción | `api/staff/[id]/day-off` | `owner\|admin` + audit | `createScheduleException` | **sesión cualquiera, sin audit** |
| Crear cita | `api/appointments` POST | sesión + predicado barbero | `createAssistantAppointment` | sesión + predicado barbero |

La regla que falta es simple y hay que escribirla: **una capacidad, una puerta.** Las rutas
`/api/*` son la superficie del dueño; las server actions son la del mostrador. Cuando las dos
existen, la de menor gate es el gate real.

**b) `getServiceClient()` está copiado 45 veces.** Idéntico en los 45 casos. No es un
problema de gusto: es el sitio donde algún día habrá que meter un pool, un timeout o un
header de tracing, y hoy hay que tocarlo en 45 archivos.

**c) Cuatro archivos pasan las 1000 líneas** (`assistant-actions.ts` 1619,
`AssistantVerticalCalendar.tsx` 1428, `AssistantControlDesk.tsx` 1308,
`dashboard.types.ts` 1155). `dashboard.types.ts` es el más problemático: se llama "types" y
contiene queries — es el archivo que un lector nuevo abre esperando declaraciones y encuentra
acceso a datos.

**d) Deuda ya registrada y todavía abierta:** `status='walkin'` es valor muerto del CHECK;
`organizations` + `businesses.organization_id` son residuo de PR #152; `DashboardAppointment.service`
se declara no-nullable sobre una columna nullable (S9-RES-01).

### 2.3 Estructura e invariantes recomendadas

No propongo reorganizar directorios: el mapa actual es legible y el costo de moverlo supera
el beneficio. Propongo **fijar cuatro invariantes** y hacerlas verificables con el mismo
mecanismo que ya funcionó para `tenantDb` (lint + repo-check en la suite):

1. **Una capacidad, una puerta.** Si una mutación existe como ruta y como action, una de las
   dos delega en la otra. Verificable: censo de nombres de capacidad duplicados.
2. **Todo gate es explícito y nombrado.** Prohibido "requiere sesión" para una mutación de
   configuración. Helpers: `requireOwnerOrAdmin` (existe), `requireBusinessSession` (existe),
   y falta `requireDeskSession` para lo que es del mostrador.
3. **Un solo `getServiceClient`,** en `lib/supabase/service.ts`, con lint que prohíba
   `createClient(url, serviceRoleKey)` fuera de ahí.
4. **Toda migración aplicada tiene archivo en el repo.** Verificable en CI contra el ledger.

---

## 3. Operación real en la barbería

### 3.1 Velocidad con las manos ocupadas

Medido sobre el código, no sobre una impresión:

- **La silla (barbero, `StaffLayout`):** mobile-first real, `max-w-xl`, swipe con
  delay-commit para "Terminó / No vino". Un cierre de cita son **dos gestos** y el
  optimista pinta antes que el servidor. Está bien resuelto.
- **La mesa (asistente, `AssistantControlDesk`):** walk-in de dos toques, arrastre para
  reacomodar con deshacer. Pero está pensada en `max-w-[1400px]` con 200 px mínimos por
  barbero: **con 5 barberos, en un teléfono son casi dos pantallas de ancho.** Hoy no
  bloquea nada porque el barbero no llega a esa ruta, pero si la recepción usa teléfono
  (el caso normal de una barbería chica), la mesa no es la superficie correcta.
- **El gesto más frecuente del día está archivado como excepción:** cobrar una cita
  agendada, desde la mesa, solo existe dentro del `<details>` cerrado de "cabos sueltos"
  (R1, punto 3). Sigue abierto.

### 3.2 Los casos de borde diarios, uno por uno

| Caso | Estado | Detalle |
|---|---|---|
| **Walk-in** | ✅ resuelto | Nace con `arrived_at` real; el auto-cancel ya no se lo come (S9-OPS-03) |
| **No-show** | ✅ resuelto | Cron + `noshow_count` + `is_flagged` + tolerancia configurable |
| **Cobro mixto efectivo/tarjeta** | ✅ resuelto | Riel por cita; sin declarar = `NULL` con cubo propio en el corte (S9-OPS-06) |
| **Propina** | ⚠️ parcial | Existe y es privada del dueño (diseño correcto). **Pero no hay regla de qué pasa con la propina en efectivo que queda en el cajón** entre el cobro y el momento en que el barbero la toma: el conteo la incluye y el esperado no → descuadre positivo sin explicación |
| **Caja chica / fondo** | 🔴 **roto** | `caja_fondo` se lee en `lib/corteData.ts:69,88` y **no lo escribe nadie**. Con default 0 y una card que instruye contar el fondo, cada corte nace torcido |
| **Corte al turno** | 🔴 **no existe** | El modelo es **un corte por día**: `createCorte` frena si ya hay uno y solo admite corrección con `replacesId`. Una barbería con turno matutino y vespertino, o con dos cajeros, no tiene cómo cerrar por turno |
| **Comisión de barberos** | 🔴 **no existe** | `staff.compensation_model` está en la BD, sin UI y `NULL` en todos los registros. Además **"quién cobró" no tiene campo:** se infiere de `modified_by_staff_id`, que la siguiente edición pisa. Con comisión al 45% eso no es auditoría, es adivinanza |
| **"Voy 10 minutos tarde"** | 🔴 abierto | Las tres columnas (`adjusted_starts_at`, `delay_reported_minutes`, `late_arrival_acknowledged`) se leen en tres lugares y **solo el bot las escribe**. Sin bot, avisar que llegas tarde **empeora** tu situación |
| **Recordatorios automáticos** | 🔴 abierto | `dispatch-lifestyle-notifications` **nunca se desplegó**. Todo lo que se encola (recordatorios, reactivación, waitlist) se encola y nadie lo despacha (S7-NOTIF-01) |

### 3.3 Offline y latencia

**No hay soporte offline de ningún tipo.** Sin service worker, sin manifest, sin cola de
reintentos, sin `navigator.onLine`. Toda mutación es un round-trip a una función de Vercel.

Lo que sí hay: optimista con revert y toast en `mutateAppt`
(`AssistantControlDesk.tsx:796-823`). O sea que con señal mala **la acción no se pierde en
silencio** — se revierte y avisa. Es el comportamiento honesto, y es coherente con la regla
del repo. Lo que falta es el siguiente escalón: **reintentar**.

Riesgo real: con wifi intermitente, el barbero marca "Terminó", ve el revert, y vuelve a
intentar. Dos veces. Las actions de estado son idempotentes (`completeAppointment` lo es),
así que no duplica — pero `createCajaMovimiento` **no lo es**: dos taps con timeout de por
medio dejan dos entradas de caja iguales, y anular una requiere darse cuenta.

---

## 4. Puntos frágiles y seguridad

### 4.1 Condiciones de carrera

**Doble reserva: cubierta, y bien.** Hay un `EXCLUDE USING gist` sobre
`(staff_id, tstzrange(starts_at, ends_at))` con exención solo para el solape que un humano
fuerza a conciencia (`allow_overlap`). Los tres escritores manejan el `23P01` con mensaje de
cara al usuario. **Es la pieza mejor construida del sistema.**

Matiz menor: `createAssistantAppointment` toma `input.force` del cliente
(`assistant-actions.ts:664`). Un barbero podría forzar solape en su propia agenda por HTTP
directo. Daño acotado (su agenda, y queda marcado), pero el flag debería derivarse de una
confirmación del servidor, no de un booleano del cliente.

**Corte doble: abierto (TOCTOU).** El guard "ya hay corte de hoy" es una lectura seguida de
una escritura (`caja-actions.ts:328-331`) y **no hay índice único que lo respalde**: en
`caja_cortes` solo existe `idx_caja_cortes_biz_dia`, que no es único. Dos taps simultáneos
dejan dos cortes del día sin relación entre sí, y "el último manda" elige por hora, no por
intención — exactamente lo que el comentario del código dice que hay que evitar.

**Anulación doble de un movimiento: cubierta** por el `UNIQUE(reverses_id)`, aunque el
choque sale como error crudo (`23505`) en vez de mensaje.

### 4.2 Permisos

**C1 — Escalada de privilegios por server action.** `requireAssistantSession()`
(`assistant-actions.ts:52`) **no comprueba el rol**: solo exige sesión. Tres actions de
configuración cuelgan de ese gate:

- `updateStaffSchedule(staffId, [])` (`:1314`) — **borra el horario semanal de cualquier
  compañero**. Como el horario alimenta `getDayAvailability`, ese barbero desaparece de la
  disponibilidad del bot.
- `createScheduleException(...)` (`:1386`) — le pone un día libre a cualquiera.
- `deleteScheduleException(...)` (`:1427`) — se lo quita.

Las rutas equivalentes exigen `owner|admin` (`api/staff/[id]/schedule/route.ts:98`) **y
escriben `management_audit`**. Las actions no exigen rol **y no auditan**: el cambio es
invisible en la pestaña Actividad. La UI del barbero no monta esos controles, pero una
server action es un endpoint HTTP público con un id estable — y el propio repo documenta cómo
invocarlas por HTTP.

**M1 — Fuga de agenda entre barberos.** `refreshAssistantAppointments(date)` (`:102`) no tiene
gate de rol y devuelve `getDayAppointments(business_id, date)`: **todas** las citas del
negocio, con nombre y **teléfono** del cliente (`CustomerRef.phone`) y `price_charged`. El
barbero tiene su propia versión acotada (`refreshStaffDayAppointments`, correcta); esta le
queda accesible igual.

**Ingresos globales: bien cerrados.** `/api/reports/*`, `/api/activity`, `/api/waitlist` y
`/api/customers/inactive` exigen `owner|admin`. Las propinas tienen aislamiento estructural
(tabla aparte, RLS deny-all, lint y repo-check). Nada de eso está flojo.

**C2 — La sesión por PIN no se puede revocar.** `getCurrentSession()` (`lib/auth.ts:66-80`)
confía en la cookie firmada y **nunca vuelve a mirar la fila de `staff`**: ni `active`, ni el
PIN vigente, ni si sigue en ese negocio. La cookie dura **7 días**
(`lib/session.ts:47`). Consecuencia operativa directa: **despedir a un barbero, desactivarlo
en el panel o cambiarle el PIN no lo saca del sistema.** Sigue viendo la agenda, cobrando
citas y registrando movimientos de caja durante una semana. La rama de Supabase Auth
(el dueño) **sí** valida `active = true` (`:92`) — la asimetría es el defecto.

**M5 — PIN de 4 dígitos.** Rate limit de 5/60s **por IP** y con política fail-open: si Upstash
no responde, no hay límite. Diez mil combinaciones, sin bloqueo por negocio ni por cuenta.
Además la IP sale del primer segmento de `x-forwarded-for` (`api/auth/pin/route.ts:35`),
que conviene confirmar contra lo que Vercel garantiza.

**M6 — Advisors de Supabase:** 7 funciones `SECURITY DEFINER` ejecutables por `anon` vía
`/rest/v1/rpc/` (la única con superficie real es `check_late_arrival_feasibility`, que pide
un UUID no adivinable); 13 funciones con `search_path` mutable; `btree_gist` en `public`;
protección de contraseñas filtradas apagada en Auth.

### 4.3 Fallas silenciosas, consultas y errores

**C3 — Deriva de esquema entre producción y el repo.** El ledger de migraciones de producción
tiene 28 entradas; el repo tiene ~56 archivos entre sus dos carpetas. Y una de esas 28
—`20260819030909 consent_pending_notice`— **no tiene archivo en ningún lado del repo ni en el
historial de git** (verificado con `find` + `git log -S`). Lo que hizo esa migración fue
ampliar el CHECK de `customers.consented_via` para admitir `'pending_notice'`.

Por qué importa, y por qué es crítico y no cosmético:

`createAssistantAppointment` inserta clientes nuevos con `consented_via: 'pending_notice'`
(`assistant-actions.ts:578`, `:612`) y **ignora el error del INSERT**
(`const { data: created } = await db…`, sin `error`). En producción funciona porque el CHECK
está ampliado. **En cualquier base reconstruida desde el repo** —el restore drill S4-OPS-02,
un staging, la BD del segundo cliente— el INSERT viola el CHECK, el error se descarta,
`customerId` queda `null` y **la cita se crea sin cliente, sin un solo mensaje de error**.
Es decir: el restore drill que falta en el sprint validaría un backup que produce una base
rota, y la rotura sería invisible hasta que alguien note que la clientela no crece.

**A6 — Lecturas que se degradan a vacío.** Hay **84 destructuraciones** `const { data } = await`
que no capturan `error` (en `lib/`, `app/` y `components/`). En la mayoría son lecturas que
caen a `?? []`: ante un fallo transitorio de la BD, la pantalla dice **"no hay citas"** en vez
de "no pude leer". Es la misma clase de mentira que la regla dura del repo prohíbe en la
escritura, del lado de la lectura. De ese total, **7 rodean una escritura** y **2 son los del
alta de cliente** descritos arriba.

**Rendimiento.** Los índices están bien puestos (`(business_id, starts_at)`,
`(staff_id, starts_at)`, parcial de notificaciones pendientes). No hay N+1 grave. Sí hay dos
desperdicios concretos:

- **M2:** la mesa llama `listarCabos()` en un `useEffect` con dependencia `[appointments]`
  (`AssistantControlDesk.tsx:832-836`). Como el poll de 20 s reemplaza el arreglo, **se dispara
  una consulta de 14 días cada 20 segundos**, por sesión abierta, más una por cada mutación
  optimista.
- **M3:** el dashboard del dueño agrupa bien dos tandas en `Promise.all` y después encadena
  **7 etapas seriales independientes** (`app/dashboard/page.tsx:216-246`: cabos, atención,
  cortes, hero, equipo, riel, análisis). Es TTFB regalado.

**Fugas de memoria:** no se encontraron. 14 `setInterval` y 15 `clearInterval`; todos los
efectos con temporizador limpian.

---

## 5. Áreas de oportunidad

### 5.1 Lo que falta para este nicho (ordenado por lo que un dueño pide primero)

1. **La raya.** Liquidación por barbero: comisión/renta/sueldo × lo cobrado por él en el
   período. La columna existe (`compensation_model`), el dato existe (`price_charged`,
   `completed_at`), y falta el campo **"quién cobró"** y la vista. Es lo que convierte al
   producto de "agenda con caja" en "el sistema con el que pago la nómina" — y es el
   argumento de retención más fuerte que tiene.
2. **Recordatorios que salgan.** Desplegar el despachador (S7-NOTIF-01). Hoy la funcionalidad
   más vendible del producto está construida y apagada.
3. **Fidelización / retención por barbero.** Ya existe la mitad: `staffRecompra.ts`,
   `retentionFeed.ts`, `cadence.ts`, `fuga.ts`. Falta el gesto de cierre: la campaña de
   rescate que se dispara desde el feed. Sin el despachador, no se puede.
4. **Corte por turno**, con cajero identificado.
5. **Catálogo de productos** para la venta de mostrador (hoy el "qué" vive en una nota libre).

### 5.2 Simplificación

- 45 copias de `getServiceClient` → una.
- `status='walkin'` (valor muerto del CHECK) y `organizations` + `businesses.organization_id`
  (0 filas, sin lectores) → borrar en una migración.
- `dashboard.types.ts` (1155 líneas) → separar tipos de queries.
- **Deriva documental:** `CLAUDE.md` sigue citando el defecto de `sent_at` del aviso de
  cancelación como "caso testigo" vivo; ya fue corregido en S9-OPS-08 y el código de hoy
  mira el resultado del envío (`assistant-actions.ts:190-230`).

---

## 6. Plan de acción

Ordenado por impacto/esfuerzo. **Cada paso es una sesión, una tarea, un commit lógico**, con
la convención del sprint. Nada de esto se ejecuta sin aprobación.

### Tanda 1 — Cierre de bordes (1 sesión corta cada uno, todos de bajo riesgo)

**P1 · Gate de rol en las tres actions de configuración** *(C1)*
- Agregar `requireOwnerOrAdmin()` a `updateStaffSchedule`, `createScheduleException`,
  `deleteScheduleException`, o hacer que deleguen en la ruta que ya tiene el gate.
- Escribir `management_audit` en las tres, con la misma firma que usan las rutas.
- **Aceptación:** una sesión de barbero recibe `Forbidden`; el cambio del dueño aparece en
  Actividad; test de repo que censa mutaciones de configuración sin gate de rol.

**P2 · Revalidar la sesión por PIN contra `staff`** *(C2)*
- En la rama `ls_session` de `getCurrentSession`, cuando hay `staff_id`: verificar
  `active = true` y `business_id` coincidente. Una consulta indexada, memoizada por request
  con `cache()` de React.
- **Aceptación:** desactivar a un barbero lo saca en la siguiente navegación; cambiar el PIN
  invalida la sesión anterior; medir que no agrega más de una consulta por request.

**P3 · Cerrar la deriva de esquema** *(C3)* — **bloquea S4-OPS-02**
- Escribir el archivo faltante de `consent_pending_notice` en `supabase/migrations/`.
- Capturar el error en los dos INSERT de cliente de `createAssistantAppointment` y devolver
  mensaje en vez de seguir con `customerId = null`.
- Check en CI: todo `version` del ledger tiene archivo en el repo.
- **Aceptación:** base reconstruida desde el repo + alta manual de cliente nuevo → cliente
  creado y cita ligada. Recién con esto el restore drill significa algo.

**P4 · Editor del fondo de caja** *(C4)*
- Campo `caja_fondo` en la configuración del dueño (`api/business/config` ya audita).
- **Aceptación:** el fondo se fija, el corte del día lo usa, y el descuadre sistemático
  desaparece.

**P5 · Único parcial del corte** *(A1)*
- `CREATE UNIQUE INDEX … ON caja_cortes (business_id, corte_date) WHERE replaces_id IS NULL`;
  mapear el `23505` al mensaje que ya existe.
- **Aceptación:** dos `createCorte` concurrentes → uno gana, el otro recibe "Ya hay un corte
  de hoy".

### Tanda 2 — Operación (una sesión cada uno)

**P6 · Puerta manual del retraso** *(A4)* — action `reportarRetraso(id, minutos)` que escribe
las tres columnas que hoy solo escribe el bot, más el gesto en la ficha de la cita.

**P7 · Desplegar el despachador de notificaciones** *(A5, ya es S7-NOTIF-01)* — desplegar la
edge function y descomentar su `cron.schedule`. **Antes**, revisar el guard de baja de la
copia en Deno (contradicción registrada en `docs/planes/agente.md`).

**P8 · "Terminó" fuera del acordeón de cabos** *(R1 punto 3)* — el gesto más frecuente del día
en el camino principal de la mesa.

**P9 · Acotar `refreshAssistantAppointments`** *(M1)* — si el rol es `barber`, devolver solo
sus citas (la función acotada ya existe).

### Tanda 3 — Producto (varias sesiones, requiere decisión de Gabriel)

**P10 · "Quién cobró" como campo propio** — `charged_by_staff_id`, escrito al completar y
nunca pisado. Es el prerrequisito de la raya y de la custodia del efectivo con 5 barberos.

**P11 · La raya** — UI de `compensation_model` + liquidación por barbero y período.

**P12 · Corte por turno** — decisión de modelo primero: ¿el corte se ancla a un turno, a un
cajero, o sigue siendo del día con múltiples cortes parciales?

### Tanda 4 — Higiene (se puede intercalar)

- **P13:** un solo `getServiceClient` + lint (45 → 1).
- **P14:** aplanar las 7 etapas seriales del dashboard en un `Promise.all` (M3) y sacar
  `listarCabos` del `useEffect([appointments])` (M2).
- **P15:** censo de las 84 lecturas sin `error`; empezar por las que alimentan pantallas de
  dinero y de agenda, donde "vacío" se lee como un hecho.
- **P16:** advisors de Supabase (M6) — revocar `EXECUTE` a `anon`, fijar `search_path`,
  mover `btree_gist`, encender la protección de contraseñas filtradas.
- **P17:** borrar `status='walkin'`, `organizations` y `businesses.organization_id`.
- **P18:** corregir la nota vencida de `CLAUDE.md` sobre `sent_at`.

### Orden sugerido

**P3 → P2 → P1 → P4 → P5** primero: los cinco son de una sesión, cierran los cuatro críticos y
dejan el restore drill con sentido. Después **P7 → P6 → P8**, que es lo que el cliente
fundador va a notar el primer día. **P10/P11** cuando Gabriel decida el modelo de comisión.

---

## 7. Lo que esta auditoría no verificó

- El **sellers-portal** y **dra-quevedo** (fuera de alcance por decisión del sprint).
- La calidad conversacional del bot: ya la cerró la auditoría AUD-01…07f de punta a punta.
- El comportamiento bajo carga real: no hay tráfico de producción todavía; los ~1,290
  registros de citas son el seed determinista de demo.
- El despliegue: qué está efectivamente en Vercel y con qué variables de entorno. Varias
  tareas del sprint dependen de eso y siguen bloqueadas en Gabriel.
