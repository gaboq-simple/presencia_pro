# Contrato agent-ready (S9-AG-01 · A2 de la fase del agente)

**Qué es esto.** El contrato que tiene que existir ANTES de que ninguna pieza de
agente se escriba: qué dato se puede creer y por qué, por dónde entra, qué
veredictos ya existen, qué acciones se pueden tocar y bajo qué reglas. **Solo
documentos.** Este paso no agrega una columna, ni un tipo, ni un endpoint: lo que
describe o ya está en el repo (y va con su archivo:línea) o está marcado como
hueco con el lugar donde iría la pieza que falta.

**Por qué primero.** El agente propone sobre lo que el sistema cree saber. Si
"cobró $200" y "el precio de lista es $200, nadie lo miró" se ven iguales, el
agente va a afirmar el primero cuando solo tiene el segundo — y una propuesta
apoyada en un dato que nadie confirmó es exactamente la clase de error que
destruye la confianza del dueño en un producto que se vende como "números
creíbles".

**Estado del repo cuando se escribió** (2026-08-20, `main` en `101eb62`): 21
tablas, 5 módulos de server actions, 31 rutas de API, 11 módulos puros que emiten
veredictos, 5 crons vivos, 867 tests. Nada de esto manda mensajes proactivos hoy
salvo una ruta (`reactivation`), y la WABA sigue sin verificar.

---

## Lo que el borrador afirmaba y el repo corrigió

Práctica de `permiso.md`: las contradicciones se escriben, no se limpian. Siete,
todas verificadas.

1. **"Datos verificados con procedencia"** — la procedencia **no es un dato**. No
   existe ninguna columna que diga cómo se supo algo. Hoy se DERIVA de dónde vive
   la fila y de qué la escribió (trigger, GUC de actor, columna de sesión). Este
   contrato define esa derivación; no la materializa.
2. **"Los módulos puros ya emiten veredictos con explicación"** — cierto para
   **2 de 11**. `cadence` trae `confidence` + `explanation`
   (`cadence.ts:69,209`) y `senales` trae un `texto` por señal (`senales.ts:143`).
   Los otros nueve exponen **umbrales exportados y campos crudos**, y la frase la
   arma la vista. No es un defecto: es dónde está hoy la línea.
3. **La escalera de confianza ordena AL REVÉS que `capa-de-dinero.md`** — ahí el
   héroe es lo confirmado por una persona y lo sellado por trigger es *derivado*
   (`capa-de-dinero.md`, "Los tres estados epistémicos"). Se concilia abajo, en
   una sola dirección.
4. **Dos peldaños son indistinguibles en reposo** — un `price_charged` sellado por
   el trigger y uno tecleado por una persona se ven idénticos en la fila, y
   `payment_method='efectivo'` no dice si alguien eligió efectivo o si nadie tocó
   el default. Documentado abajo con el lugar donde iría la marca; **no se
   construye acá**.
5. **"El opt-out lo frena el tipo"** — cierto en la app (`SendPurpose`,
   14 llamadas en 11 archivos), **pero** el despachador de notificaciones tiene su
   PROPIA copia de `sendWhatsAppMeta` (Deno no comparte el paquete) y esa copia no
   tiene el guard. Hoy es inocuo porque esa function nunca se desplegó
   (SPRINT.md → S7-NOTIF-01); el día que se despliegue, el guard hay que
   portarlo o el tipo deja de ser garantía.
6. **"Topes de frecuencia"** — **no existen**. Los tres límites del sistema son de
   ENTRADA: PIN 5/60 s por IP (`api/auth/pin/route.ts:71`), ARCO 3/hora por
   teléfono (`api/arco/route.ts:51`) y bot 15/60 s por cliente
   (`api/bot/route.ts:322`). Nada limita cuántas veces se le puede ESCRIBIR a la
   misma persona. Es un hueco, no una pieza.
7. **"Todo auditado"** — con matices medidos hoy contra prod: `management_audit`
   tiene **0 filas**; `appointment_audit` tiene **669**, de las cuales **9** son
   `actor_type='unknown'` (5 de ellas `deleted`) y **todas** provienen de SQL
   directo (seed / ops), no de la app — el último residuo de código se cerró en la
   migración `056`. **La caja no necesita tabla de auditoría: la tabla ES su
   rastro** — append-only por trigger, sin UPDATE ni DELETE, y anular es una
   contraentrada firmada con `reverses_id` (`20260812000000_capa_dinero.sql:184-185`).
   Lo auditable que sí falta es otra cosa: `management_audit` **vacía** y
   **nada audita lecturas**.

---

## 1. El evento canónico

Todo lo que el agente puede usar como evidencia se reduce a una misma forma. No
es un tipo de TypeScript todavía — es la forma que cualquier lector tiene que
poder reconstruir de cualquier fila:

| Campo | Qué es | De dónde sale hoy |
|---|---|---|
| `negocio` | Tenant. Sin esto no hay evento | `business_id` en todas las tablas; el acceso pasa por `tenantDb` (`packages/engine/src/tenantDb.ts`) |
| `sujeto` | Sobre quién/qué es (cita, cliente, barbero, día, caja) | la PK de la fila |
| `hecho` | Qué pasó, en pasado y sin juicio ("se completó", "no llegó", "se contó la caja") | `status`, `type`, `action` según la tabla |
| `cuándo — ocurrió` | El instante REAL del hecho | `completed_at`, `arrived_at`, `occurred_on`, `created` |
| `cuándo — se supo` | Cuándo entró al sistema | `created_at`, `modified_at` |
| `actor` | Quién lo provocó: persona (con `staff_id`), bot, sistema, o nadie | columnas 023 · GUC `app.actor_type` (045/047/048/056) |
| `confianza` | **La escalera de abajo** | derivada; hoy no es columna |
| `procedencia` | Por qué canal entró | derivada del canal (§2) |

**Las dos fechas no son redundancia.** Una cita de ayer cobrada hoy pertenece al
dinero de hoy (`completed_at`, decisión D6 de `capa-de-dinero.md`) y a la agenda
de ayer. Un agente que las confunda va a proponer sobre un día que no existió.

### La escalera de confianza

Ordena por **integridad del registro**: qué tan difícil es que ese dato sea otra
cosa que lo que dice.

| # | Peldaño | Qué significa | Ejemplos verificados |
|---|---|---|---|
| 1 | **sellado-por-trigger** | Lo escribió la base, no la app. Nadie lo puede haber tecleado mal ni omitido | `price_charged` al completar (`049_appointment_price_snapshot.sql:44,65` — rellena SOLO si es NULL) · `cash_diff`/`card_diff` GENERATED (`20260812000000_capa_dinero.sql:148-149`) · `visit_count`/`noshow_count` (`trg_update_visit_stats`) |
| 2 | **confirmado-humano** | Una persona identificada tecleó o eligió el valor, y su `staff_id` quedó en la fila | monto editado al cobrar (`lib/cobro.ts:59-67`) · el corte a ciegas (`caja-actions.ts:293`) · movimiento de caja (`caja-actions.ts:81`) · propina (`staff/actions.ts:129`) |
| 3 | **default-sin-mirar** | El sistema puso un valor razonable y la persona no lo contradijo. Es confirmación de bajísimo esfuerzo, no invención | `payment_method='efectivo'` (`lib/cobro.ts:23,59`) · completar sin editar el monto |
| 4 | **derivado** | Aritmética sobre otros datos. Correcto por construcción, pero no es un hecho del mundo | ingreso de agenda `price_charged ?? services.price` (`dashboard.types.ts:567,627`) · potencial y ocupación (`lib/pulso.ts`, `lib/occupancy.ts`) |
| 5 | **pendiente** | El sistema sabe que NO sabe. Tiene nombre propio porque es accionable | cabos sueltos (`lib/cabos.ts:50`) · `consent_at IS NULL` (84 filas hoy) y `pending_notice` (39) · invocaciones sin verificar (`cron_invocaciones.veredicto='pendiente'`) |

### La conciliación: integridad ≠ autoridad

`capa-de-dinero.md` clasifica el MISMO `price_charged` sellado por trigger como
*derivado*, y este documento lo pone en el peldaño 1. **No es una contradicción
si se nombra qué mide cada uno**, y esa es la regla que queda:

> **La escalera mide integridad: de dónde salió el número y qué tan difícil es
> que esté alterado. Los tres estados epistémicos miden autoridad: qué se le
> puede PRESENTAR al dueño como suyo.** Son ejes distintos y se aplican los dos.

Resuelto en una dirección, sin empates:

- **Para MOSTRAR** (cualquier superficie del dueño o del staff) manda
  `capa-de-dinero.md`: héroe solo lo confirmado; lo demás va etiquetado
  "Agendado" o "Potencial". Este documento no reabre eso.
- **Para RAZONAR** (lo que el agente puede usar como evidencia interna) manda la
  escalera: los peldaños 1–3 son evidencia utilizable; el 4 solo como contexto
  y siempre nombrado como estimación; el 5 nunca es evidencia — **es materia
  prima de propuestas** ("hay 3 citas sin cerrar" es una buena propuesta; "el
  local facturó X" apoyado en citas sin cerrar es una mentira).
- **Para DECIR** (el texto de la propuesta) manda la autoridad, no la integridad:
  un `price_charged` de peldaño 1 se dice **"quedó registrado el precio de lista,
  $200"**, nunca **"cobró $200"**. Alta integridad, baja autoridad: el número es
  incorruptible y aun así nadie lo miró.

### El hueco: dos peldaños indistinguibles en reposo

| Par | Por qué no se distinguen | Dónde iría la marca (NO se construye acá) |
|---|---|---|
| `price_charged` sellado (1) vs tecleado (2) | El trigger es `BEFORE` y rellena `NEW`; el audit de 045 es `AFTER` y ve la fila **ya sellada**, así que `changed_fields` incluye `price_charged` en los dos casos | Un booleano en la fila (`price_confirmado`) escrito por la action solo cuando `resolveCobro` devolvió `amount !== undefined`, o el GUC de actor extendido con la intención. La action YA sabe la diferencia (`lib/cobro.ts:67`): lo que falta es persistirla |
| `payment_method` elegido (2) vs default (3) | La app siempre manda un riel; el default se aplica en el módulo puro y llega a la BD idéntico a una elección | Mismo lugar y misma forma: el dato existe en `resolveCobro`, muere en el camino |

Mientras el hueco exista, la regla operativa es **degradar**: cualquier
`price_charged` o `payment_method` que el agente no pueda probar como peldaño 2 se
trata como peldaño 3. Es la dirección segura — subestimar la confianza produce
propuestas tímidas; sobreestimarla produce afirmaciones falsas.

---

## 2. Canales de captura y su momento ritual

El "momento ritual" importa tanto como el dato: un canal que exige un gesto que
nadie va a hacer no captura nada. Todos verificados.

| Canal | Momento ritual | Qué deja | Confianza | Fuente |
|---|---|---|---|---|
| **Bot de WhatsApp** | El cliente escribe. Sin gesto del negocio | cita, cliente, conversación, `bot_logs` | 2 (lo dijo el titular) | `api/bot/route.ts` · `packages/engine/src/bot/lifestyle/handler.ts` |
| **Aviso de privacidad del bot** | Primer mensaje del cliente, o el primero después de un alta manual | `consent_at` + `consented_via='whatsapp_first_message'` | 1 (lo escribe el flujo, con el `message_id` de evidencia) | `states/greeting.ts:107,116-117,135-136` |
| **Alta manual / walk-in** | La recepción teclea mientras el cliente está enfrente | cita + cliente con `consented_via='pending_notice'` | 2 para la cita, **5 para el consentimiento** | `assistant-actions.ts:428,546-547` |
| **"Llegó"** | Un tap cuando el cliente cruza la puerta | `arrived_at` (atributo, no status) | 2 | `assistant-actions.ts:363` |
| **Cierre de la cita (swipe)** | Al terminar el corte, 2 segundos | `status='completed'`, `completed_at`, `price_charged`, `payment_method` | 1–3 según qué se tocó | `assistant-actions.ts:253,283` · `staff/actions.ts:59` · `lib/cobro.ts` |
| **Propina** | Después de cobrar, solo el barbero | `appointment_tips` (RLS deny-all, invisible al dueño) | 2 | `staff/actions.ts:129` (gate `role !== 'barber'` → `Forbidden`) |
| **Caja** | Cuando entra o sale dinero fuera de la agenda | `caja_movimientos`, append-only; anular = contraentrada | 2 | `caja-actions.ts:81,141` |
| **Corte a ciegas** | Al cerrar el local, contando el cajón | `caja_cortes` con esperado congelado y descuadre GENERATED | 1 (el descuadre) sobre 2 (los conteos) | `caja-actions.ts:293` |
| **Baja ("BAJA")** | El cliente lo escribe; se intercepta ANTES del clasificador | `opted_out_at` + `opted_out_via='whatsapp_keyword'` | 1 (determinista, sin modelo) | `lib/opt-out.ts` · `api/bot/route.ts:481,543,801,996` |
| **ARCO** | Formulario público, sin sesión | `arco_requests` (3/hora por teléfono) | 2 | `api/arco/route.ts:51,80` |
| **Cron de auto-cancel** | Cada minuto, sin humano | `status='no_show'` con `actor_type='system'` | 1 | `047_actor_attribution_cron.sql` |
| **Presencia del dueño** | Abrir el dashboard | `owner_last_seen_at` | 1 (best-effort) | `lib/ownerPresence.ts:34` |
| **Audit de citas** | Automático, cada mutación | `appointment_audit` (fila entera, append-only) | 1 | `045_appointment_audit_capture.sql` |
| **Audit de gestión** | Cada cambio de catálogo/horario/precio | `management_audit` (0 filas hoy) | 1 | `lib/managementAudit.ts` |
| **Handoff humano** | El staff toma la conversación | `conversation_messages` con `sent_by='human'` | 2 | `assistant-actions.ts:1016,1144` |
| **Invocaciones de cron** | Cada disparo desde la base | `cron_invocaciones` con su status real | 1 | `20260820000000_meta_aviso_cron.sql` (A1) |

**Lo que NINGÚN canal captura hoy**, y que un agente va a querer: por qué se
canceló de verdad (el `reason` es texto libre y opcional), si el cliente quedó
contento, cuánto duró de verdad el servicio (solo hay programado vs `completed_at`),
y **si un mensaje llegó** — no hay webhook de estado de entrega de Meta.

---

## 3. Veredictos que ya existen

Once módulos puros, sin DB ni red, con tests en `tests/` de la raíz. Son el
cerebro que el agente hereda: **no hay que inventar criterio, hay que exponerlo.**

| Módulo | Entradas | Salida (veredicto) | ¿Explica? | Umbrales |
|---|---|---|---|---|
| `cadence.ts:125` | visitas completadas por cliente + `nowMs` | segmento RFM, `isOverdue`, `urgency`, `inRescueFeed`, `valueScore` | **Sí**: `confidence` + `explanation` ("Venía cada 2 semanas, lleva 6") | `MIN_VISITS_FOR_CADENCE=3`, `OVERDUE_FACTOR=1.5`, `LOST_FACTOR=3` (`:20-29`) |
| `cadence.ts:241` (`computeRetentionFeed`) | resultados de cadencia | feed de rescate ordenado | hereda `explanation` | `feedGroupRank` (`:235`) |
| `cadence.ts:302` (`computeClientelaStats`) | todos los clientes | conteos por segmento, crecimiento, retención, movimiento | no | — |
| `senales.ts:171` | cortes + días de caja + `owner_last_seen_at` | 4 señales del fracaso: ritual, convergencia, teatro, dueño | **Sí**: un `texto` por señal | `UMBRAL_RITUAL=5`, `UMBRAL_CONVERGENCIA_PCT=10`, `UMBRAL_DUENO_DIAS=7`, ventana 14 d (`:52-59`) |
| `fuga.ts:71` | celdas día×franja con slots libres | capacidad sin usar: horas libres (titular), peso de referencia, concentración | frase de concentración (`:46`) | `FRANJA_CUTOFF_MIN=14:00` |
| `cobrado.ts:56` | citas cobradas del día + movimientos | el titular del día: total, de agenda, entradas, **salidas aparte** | no | — (regla: jamás netear) |
| `corte.ts:85,110` | citas cobradas + movimientos + fondo | esperado por riel, `sinRiel` sin repartir, descuadre **con signo** | no (`fmtSigned:115`) | — |
| `cabos.ts:50` | citas pasadas sin resolver + `ahoraMs` | total, lista de la más vieja a la más nueva, `conLlegada` | no | `VENTANA_CABOS_DIAS=14` |
| `dayDrift.ts:95` | citas del día + `nowMs` | corrimiento del día en minutos + proyección por cita | no | `DRIFT_THRESHOLD_MIN=10` |
| `staffRecompra.ts:104` | visitas completadas + roster | tasa de recompra por barbero con banda de comparación | `tone` + `status:'insufficient'` | `RECOMPRA_MATURE_DAYS=30`, `MIN_COHORT=5`, `NEAR_BAND=0.05` |
| `occupancy.ts:49` / `pulso.ts` | disponibilidad + citas | ocupación, banda, oportunidades | `OccBand` como etiqueta | `FILL_FACTOR=0.35`, `OPPORTUNITY_MAX_OCC=0.7`, `FLOJO_MAX=0.4`, `LLENO_MIN=0.85` |

**El molde es `cadence`**, y no por antigüedad: es el único que dice **cuánto se
cree a sí mismo** (`confidence: none | tentative | confident`) y **por qué**
(`explanation`, una frase con los dos números que la sostienen). Un veredicto sin
esos dos campos no se puede convertir en propuesta sin que alguien invente la
razón — y el que la inventaría es el modelo.

**Regla para veredictos nuevos:** salida con `confidence` explícito, `explanation`
armada con los números que la sostienen (nunca prosa generada), umbrales
exportados como constantes con nombre, y `nowMs` inyectado — nunca leer el reloj
adentro (`cabos.ts:47`, `cadence.ts`, `pulso.ts`).

---

## 4. Acciones tipadas y su dry-run

**Hoy no existe ningún dry-run en el repo.** Toda mutación se ejecuta al
llamarse. Esta sección define la forma que tendría que tener; construirla no es
de este paso.

```ts
type Propuesta<E> = {
  accion:          string;          // del catálogo de abajo, jamás texto libre
  entrada:         E;               // tipada por acción
  precondiciones:  { regla: string; cumple: boolean; dato: string }[];
  efecto:          string[];        // filas que cambian y mensajes que saldrían
  reversibilidad:  'reversible' | 'con-rastro' | 'irreversible';
  requiere:        'staff' | 'admin' | 'barbero-dueño' | 'nadie-todavía';
  evidencia:       { veredicto: string; explanation: string }[];
};
```

`dryRun(propuesta)` devuelve la misma `Propuesta` con `precondiciones` YA
evaluadas contra la base y `efecto` resuelto con datos reales (nombres, horas,
montos), **sin escribir nada**. Es lo que el dueño ve antes de decir que sí.

| Acción | Precondiciones que YA existen | Efecto | Reversible | Quién |
|---|---|---|---|---|
| `crear_cita` | tope por barbero/día (`assistant-actions.ts:498`) · teléfono si `require_customer_phone` (`:476`) · aviso si `is_flagged` (`:532`) · anti-solape (constraint) | INSERT + encola recordatorios | con-rastro (cancelar) | staff |
| `reagendar` | conflicto de horario · tenant | UPDATE + **WhatsApp al cliente** + nuevos recordatorios | con-rastro | staff |
| `cancelar` | idempotente si ya está cancelada (`:126`) · barbero solo las suyas | UPDATE + **WhatsApp al cliente** + oferta a lista de espera (`notifyWaitlistOnCancel.ts`) | **irreversible** (el mensaje ya salió) | staff |
| `completar` / `no_show` | idempotente | UPDATE + sella precio + dispara `trg_update_visit_stats` | con-rastro | staff |
| `marcar_llegada` | idempotente si ya hay `arrived_at` (`:377`) | UPDATE `arrived_at`; protege del auto-cancel | reversible | staff |
| `ofrecer_a_lista_de_espera` | hay alguien esperando esa fecha | **WhatsApp** + `notified_at` + ventana de 30 min | irreversible | staff |
| `escribir_al_cliente` (panel) | `session_mode='human'` (`:1167`) | mensaje + `conversation_messages` | irreversible | staff |
| `reactivar` (proactivo) | **guard de baja obligatorio por tipo** (`whatsapp.ts:114`) | **WhatsApp** + fila en `scheduled_notifications` | irreversible | admin |
| `cambiar_horario` / `día_libre` / `precios` | audit obligatorio (`lib/managementAudit.ts`) | UPDATE + `management_audit` | con-rastro | admin |
| **`cobrar`, `caja`, `corte`, `propina`** | — | — | — | **PROHIBIDAS para el agente** (§5) |

**Tres cosas que el catálogo hace evidentes.** (1) La mitad de las acciones útiles
**terminan en un mensaje a un cliente**, y un mensaje no se deshace: por eso la
constitución exige aprobación humana para todo lo que sale del local. (2) Las
precondiciones ya están escritas en las actions — un dry-run honesto se construye
**extrayéndolas**, no reimplementándolas, o el día que difieran el preview va a
mentir. (3) `requiere: 'nadie-todavía'` existe para nombrar el hueco: no hay
ningún rol "agente" en `session.ts`, y no se inventa acá.

---

## 5. La constitución del agente

Cinco reglas. Cada una con su ancla en el repo o con su hueco declarado.

1. **El agente propone; el dueño dispone.** Ninguna acción sale sin aprobación
   humana explícita, y la aprobación es **por propuesta**, no por categoría ni
   por sesión. Se apoya en `agente_tareas` (A3): sin fila `aprobada` con actor,
   no hay ejecución.
2. **El dinero jamás lo escribe el agente.** Cobro, caja, corte y propina son
   captura humana firmada con `staff_id` de sesión, y sus tablas son append-only
   por trigger — bloquean incluso a `service_role`
   (`20260812000000_capa_dinero.sql:184-185,221-222`). El agente **lee** dinero y
   propone sobre él; no lo toca. Corolario: nunca propone modificar un corte
   (corregir = fila nueva con `replaces_id`).
3. **Toda escritura con actor.** El patrón vigente es el GUC transaction-local
   (`set_config(..., is_local => true)` + mutación en la misma función invocada
   por `.rpc()`) — 047 cron, 048 bot, 056 alta del bot. Un actor `agente` entra
   por ahí y por ningún otro lado. **Hoy `unknown` solo lo produce SQL directo**
   (9 filas de 669, medido); que el agente no agregue una fuente nueva es
   requisito, no aspiración.
4. **El permiso lo frena el TIPO, no la memoria.** Todo envío declara su
   `SendPurpose` y `proactive` **exige** el lookup de bajas
   (`packages/engine/src/notifications/types.ts:152-167`); el guard falla
   **cerrado** (`whatsapp.ts:114-131`) y distingue `suppressed` de `success:false`
   — un fallo se reintenta, una supresión se respeta. Cualquier envío del agente
   nace `proactive`. **Deuda ligada:** la copia del despachador en Deno no tiene
   el guard (contradicción 5).
5. **Topes de frecuencia: no existen, y son requisito de la primera pieza que
   mande.** No hay ningún límite de salida por cliente (contradicción 6). Antes de
   que el agente proponga un solo envío hace falta: tope por cliente y ventana,
   tope por negocio y día, y una razón registrada por cada supresión. El lugar
   natural es el mismo cuello de botella donde vive el guard de baja.

**Y una regla de voz**, que no es cosmética: el agente **cita, no concluye**. Su
texto lleva el número y el umbral que lo dispararon ("3 clientes de 6+ visitas
llevan más de 1.5× su ritmo"), no el juicio ("estás perdiendo clientes"). Es la
misma regla que ya rige el digest del operador (`senales-digest/route.ts`: dato +
umbral por señal, ninguna conclusión) y el copy del dueño en `capa-de-dinero.md`.

---

## Lo que este documento NO hace

- No agrega columnas, tipos ni endpoints. **Cero código.**
- No construye la marca que separaría los peldaños 2 y 3 — dice dónde iría.
- No define la UI de nada: el ciclo 2 de diseño la va a vestir.
- No decide sobre pgvector: sin corpus no hay qué indexar. El piso duro
  (la BD relacional por herramientas tipadas) alcanza para todo lo de acá.
- No toca la colisión raya × propina — es decisión de producto de Gabriel.
- No habilita ningún envío: eso está gateado por la WABA y por las entrevistas.

**Lo que sigue:** A3 (`S9-AG-02`) construye el primitivo de tareas con el que la
regla 1 deja de ser una intención — `agente_tareas` + `agente_tarea_eventos`,
estados `propuesta → aprobada → ejecutada → medida`, sin UI.
