# Plan de Remediación Estructural — Bot Lifestyle (Zlot / PresenciaPro)

> Documento de salida de la auditoría de arquitectura (Fases 1–2 completas).
> Esta es la **Fase 3**: el plan secuenciado. Acompaña a `SPRINT.md`, no lo
> reemplaza. Cada sprint se ejecuta con el método habitual: rama por problema,
> diff review, smoke test por WhatsApp con `/reset-bot`, sin merge hasta aprobación.
>
> **Estado:** Sprint 1 detallado a máximo nivel. Sprints 2+ se detallan al
> cerrar el anterior (decisión explícita: el detalle de cada sprint incorpora
> lo aprendido en el anterior).

---

## 1. Diagnóstico (resumen ejecutable)

El bot es frágil fuera del happy path por **una causa raíz con dos caras**, no
por muchos bugs independientes. La causa es: **la comprensión del mensaje y las
invariantes de estado viven distribuidas en los handlers, que cooperan para
mantener propiedades que nadie impone desde un punto central.**

Se manifiesta en tres capas:

- **Capa 1 — Comprensión dispersa.** 14 detectores de intención, 3 parsers de
  hora (2 ya divergidos), 6 listas de sí/no (con `'va'` tratado distinto entre
  estados), 2 taxonomías de intent. Cada estado reinterpreta el mensaje crudo.
  Arreglar un detector en un estado desincroniza otro → **el motor del bucle.**
- **Capa 2 — Estado efímero sin contención.** Un god-object de ~25 campos
  (`LifestyleBotContext`) mezcla datos durables de la reserva con banderas y
  contadores del turno. `clarification_attempts` tiene 3 significados según el
  estado. Las invariantes de exclusión (banderas que no deben coexistir) se
  mantienen a mano en 50+ sitios de mutación → olvidar un reset = bucle/dead-end.
- **Capa 3 — Ensamblado por fragmentos.** Mensajes finales pegados con `.join()`
  en 6 sitios (el "saludo-en-medio" es el síntoma famoso). La regla "una sola
  pregunta por mensaje" no se puede garantizar en el punto de unión.

**La cura ya existe en el repo, aplicada una vez:** `no_progress_streak`
(S5-BOT-12) se calcula en el choke-point `dispatch()`, por delta, **sin depender
de la cooperación de los handlers**. Esa es la tesis. El plan eleva ese patrón a
principio de diseño para las tres capas.

### Validación del diagnóstico (tres vías independientes)

1. **Lectura de código** (5 auditorías): focos en CONFIRMING_APPOINTMENT y la
   detección dispersa.
2. **Producción** (`bot_logs`, 30 días): self-loops concentrados en
   `CONFIRMING_APPOINTMENT→CONFIRMING_APPOINTMENT` (43) y
   `QUALIFYING_SERVICE→QUALIFYING_SERVICE` (33). *Caveat: volumen bajo, dominado
   por tráfico de prueba; señal cualitativa, no medición de impacto.*
3. **Caso real diseccionado** (Q4b): `"A las 10:15"` en QUALIFYING_DATETIME →
   `UNCLEAR, conf 0.6`. Una hora inequívoca, marcada como no entendida, porque
   se la interpretó bajo la pregunta equivocada ("¿qué día?") en vez de
   extraerla como dato neutral. Capa 1 en estado puro.

### Las dos decisiones que matan clases enteras de bugs

- **Decisión 1 — Intérprete de turno único.** Una capa que corre **una vez por
  mensaje, antes del switch de estado**, y produce un objeto inmutable
  `Interpretation` (hora, fecha, barbero, side-question, afirmación/negación,
  intents). **Determinista primero** (consolida los detectores/parsers que ya
  existen); el LLM queda detrás del fast-path, como hoy — NO se agrega una
  llamada LLM por turno (guardarraíl de costo/latencia). Los estados dejan de
  parsear el mensaje crudo: **consumen la interpretación**. La *política*
  sensible al estado (¿"va" cuenta como sí aquí?) sigue en el estado; la
  *interpretación* neutral se comparte. Mata la Capa 1.
- **Decisión 2 — Separar contexto durable de efímero, con reset en el
  choke-point.** Partir el god-object en `booking` (durable) y `turn`/`ephemeral`
  (banderas + contadores). Lo efímero se limpia **estructuralmente en
  `dispatch()`**, igual que `no_progress_streak`. Mata las Capas 2 y 3.

---

## 2. Hallazgos NO estructurales (ajustes puntuales)

Se atacan como tareas separadas, marcadas explícitamente como "ajuste puntual,
no refactor". Bajo riesgo de regresión. Se intercalan donde convenga, NO bloquean
el arco estructural.

| ID | Hallazgo | Origen | Riesgo |
|----|----------|--------|--------|
| AP-1 | `Math.random()` en round-robin → barbero baila entre turnos | Audit 5.1 | Bajo |
| AP-2 | "Domingo cerrado" hardcodeado (`getDay()===0`), ignora `officeHours` | Audit 5.2 / SPRINT.md BAJO-4 | Bajo |
| AP-3 | 23 `error_recovered` de Supabase en GREETING (salud de persistencia) | Q1 producción | Medio (operativo) |
| AP-4 | `modelRouter` apunta a `claude-sonnet-4-20250514` (Sonnet viejo) | Audit 4.3 | Bajo |
| AP-5 | "más cercano" ignora día real (requestedTime no se reenvía) | SPRINT.md backlog 🟠 | Medio |

---

## 3. Secuencia de sprints (el arco completo)

El orden lo dicta el **riesgo + dependencias**, no la elegancia. Razón del orden:
el intérprete único (Decisión 1, el sprint de mayor riesgo de regresión) NO debe
tocarse sin una malla de tests que detecte si rompe algo. Por eso la malla va
primero. Esto coincide con la deuda 🔴 que ya encabeza el backlog de `SPRINT.md`
("Classifier inyectable + e2e del happy-path").

| Sprint | Nombre | Decisión | Riesgo del sprint | Estado del detalle |
|--------|--------|----------|-------------------|--------------------|
| **R1** | Malla de invariantes + classifier inyectable | Andamio | **Bajo** (no cambia comportamiento) | ✅ Detallado abajo |
| **R2** | Intérprete de turno único | Decisión 1 | **Alto** | ⏳ Al cerrar R1 |
| **R3** | Separación contexto durable/efímero | Decisión 2 | **Alto** | ⏳ Al cerrar R2 |
| **R4** | Migrar CONFIRMING_APPOINTMENT al intérprete | Decisión 1 (aplicación) | Medio | ⏳ Al cerrar R3 |
| **R5** | Migrar QUALIFYING_* + resto de estados | Decisión 1 (aplicación) | Medio | ⏳ Al cerrar R4 |
| **R6** | Unificar ensamblado de mensajes (anti-fragmento) | Decisión 2 (aplicación) | Medio | ⏳ Al cerrar R5 |
| **R7** | Ajustes puntuales (AP-1..AP-5) + cierre | — | Bajo | ⏳ Al cerrar R6 |

**Punto de corte go-live-ready:** al cerrar **R4**. En ese punto el foco caliente
(CONFIRMING) está sobre la base nueva y con malla; el resto puede migrarse con
tráfico real entrando. R5–R7 son endurecimiento, no bloqueantes de go-live.

---

# SPRINT R1 — Malla de invariantes + classifier inyectable

> **Objetivo:** construir el andamio de seguridad que TODO el refactor posterior
> necesita, **sin cambiar ningún comportamiento observable del bot.** Al cerrar
> R1, cualquier cambio futuro que rompa el flujo de agendamiento o reintroduzca
> un bucle queda detectado por un test en CI, no por un cliente en WhatsApp.

## R1 — Por qué este sprint primero

Hoy `classifyIntent`/`classifyMultiIntent` se **importan duro** en 6+ handlers
(`import { classifyIntent } from '../classifier'`), nunca pasan por
`StateHandlerDeps`. Consecuencia: es **imposible** testear un handler sin red real
al LLM. Por eso no existe el e2e del happy-path, y por eso el bucle de S4-BOT-09
"vivía en la costura handler↔classifier que ningún test podía ejercitar"
(palabras del propio backlog de SPRINT.md).

R2 (intérprete único) toca cómo se entiende cada mensaje. Hacerlo sin malla sería
refactorizar el cimiento sin andamios. R1 construye el andamio.

**Riesgo de R1: bajo.** No cambia lógica de producto; solo (a) hace inyectable el
classifier y (b) agrega tests. Si los tests nuevos pasan con el comportamiento
actual, R1 está bien hecho por definición.

## R1 — Alcance (3 piezas)

### Pieza A — Classifier inyectable vía `StateHandlerDeps`

**Qué:** agregar el classifier como dependencia inyectable, en vez de import duro.

- Definir un tipo `ClassifierFns` (o similar):
  ```ts
  export type ClassifierFns = {
    classifyIntent:      typeof import('./classifier').classifyIntent;
    classifyMultiIntent: typeof import('./classifier').classifyMultiIntent;
  };
  ```
- Agregarlo a `StateHandlerDeps` (en `types.ts`): `readonly classifier: ClassifierFns;`
- En `handler.ts`, al construir las deps para `dispatch()`, inyectar la
  implementación real (`{ classifyIntent, classifyMultiIntent }`).
- En los handlers, reemplazar `await classifyIntent({...})` por
  `await deps.classifier.classifyIntent({...})`. **Mecánico, sin cambio de
  lógica.** Archivos afectados: `greeting.ts`, `qualifyingService.ts`,
  `qualifyingStaff.ts`, `qualifyingDatetime.ts`, `awaitingConfirmation.ts`,
  `confirmationResponse.ts`.

**Frontera dura:** NO tocar la firma ni el comportamiento de `classifyIntent`/
`classifyMultiIntent`. Solo cambiar QUIÉN los provee. El default en producción es
la implementación real; el mock es solo para tests.

**Riesgo:** bajo. Es un pasaje de import a parámetro. Si compila y los tests
existentes (18 suites) siguen verdes, está bien.

### Pieza B — Test e2e del happy-path con classifier mockeado

**Qué:** el primer test que ejercita el flujo COMPLETO punta a punta, con
classifier y Supabase fake (sin red).

- Nuevo archivo: `tests/e2e-happyPath.test.ts`.
- Reusa `tests/fixtures/lifestyle.ts` (ya tiene `business`, servicios) y el
  patrón `makeSupabase(tablesData)` de los tests existentes (ej.
  `affirmNegationHandling.test.ts`, `slotSelection.test.ts`).
- Mock del classifier: una función que devuelve `IntentClassification` /
  `MultiIntentClassification` predefinidos según el `userMessage` (tabla de
  lookup determinista).
- Recorre: `GREETING → QUALIFYING_SERVICE → QUALIFYING_STAFF →
  QUALIFYING_DATETIME → SHOWING_SLOTS → CONFIRMING_APPOINTMENT →
  AWAITING_BOOKING_NAME → CONFIRMED`, llamando a `dispatch()` turno por turno,
  pasando el `newContext` de un turno como `context` del siguiente (simulando lo
  que hace `handler.ts`).
- Asserts por turno: `newState` correcto + `responseText` no vacío donde
  corresponde + el `booking` final (serviceId/staffId/selectedSlot/bookingName)
  poblado.

**Por qué importa:** es la red que protege el camino que más importa (agendar) y
el único hoy sin cobertura. Es prerrequisito de R2.

**Riesgo:** nulo (solo agrega un test).

### Pieza C — Malla de invariantes estructurales

**Qué:** tests que blindan PROPIEDADES (no instancias de bug). Esta es la
diferencia con los 18 tests actuales, que son regresión por-bug. Estos fallan si
el refactor de R2/R3 rompe una propiedad global.

- Nuevo archivo: `tests/invariants.test.ts`.
- **Invariante 1 — No-bucle / progreso-o-escape.** Para cada estado del flujo de
  agendamiento, una secuencia de N inputs no reconocidos (basura) SIEMPRE termina
  en un estado terminal o de escape (FALLBACK/ESCALATED) dentro de
  `STRUCTURAL_CAP` turnos. Nunca se queda iterando indefinidamente en el mismo
  estado. (Property test: alimentar `dispatch()` con basura en loop, afirmar que
  `no_progress_streak` o un cap per-estado corta.)
- **Invariante 2 — Toda salida no vacía es coherente con el estado.** Para una
  batería de inputs, `responseText` nunca contiene dos signos de pregunta de
  cierre `?` (proxy de "dos preguntas en un mensaje"), nunca contiene un saludo
  ("hola", "buenas") si la conversación ya está en curso (history no vacío).
  *(Estos son los síntomas de la Capa 3; el test los blinda ANTES de unificar el
  ensamblado en R6 — así R6 se valida solo.)*
- **Invariante 3 — Caso "A las 10:15" (de Q4b, producción real).** En
  QUALIFYING_DATETIME, una hora pura sin día NO debe producir UNCLEAR/bucle: debe
  capturar la hora (o como mínimo no perderla y no escalar). **Este test arranca
  en ROJO** (documenta el bug actual) y pasa a VERDE en R2 cuando el intérprete
  extrae la hora. Es el primer caso de smoke del intérprete.
- **Invariante 4 — Exclusión de banderas efímeras.** `nearestOfferSlot` y
  `pendingDigitDisambig` nunca quedan ambas no-nulas tras un `dispatch()`.
  (Blinda a mano lo que R3 hará estructural.)

**Nota sobre Invariante 3:** es legítimo tener un test en rojo en R1 si está
marcado como `test.skip` o con un comentario `// RED hasta R2`. Documenta el
objetivo. Alternativamente, dejarlo afirmando el comportamiento actual (UNCLEAR)
y en R2 invertir la aserción. Decisión de implementación al ejecutar.

**Riesgo:** nulo (solo tests). Pero ojo: si la Invariante 1 o 4 fallan **con el
código actual**, eso es un hallazgo —significa que ya hay un bucle/colisión real—
y se documenta como bug a atacar, no se "ajusta el test para que pase".

## R1 — Orden de ejecución y dependencias internas

1. Pieza A (inyectable) — habilita todo lo demás. **Primero.**
2. Pieza B (e2e happy-path) — valida que la inyección no rompió el flujo feliz.
3. Pieza C (invariantes) — se apoya en A y B.

Todo en **una sola rama** (`feat/r1-test-mesh`) porque las tres piezas son un
solo andamio cohesivo y ninguna cambia comportamiento de producto. Excepción a
"una rama un problema": aquí el "problema" es "no hay malla", y las tres piezas
son partes de la misma malla. Si preferís disciplina estricta, partir en
`feat/r1a-classifier-injectable` (merge primero, es el cambio de código real) y
`feat/r1b-test-mesh` (solo tests, merge después).

## R1 — Prompt para Claude Code

> Copiá esto a Claude Code como punto de partida. Ajustá rutas si difieren.

```
Contexto: bot de agendamiento WhatsApp, FSM en
packages/engine/src/bot/lifestyle/. Estoy ejecutando el Sprint R1 del
REMEDIATION-PLAN.md: construir la malla de tests de seguridad SIN cambiar
comportamiento del bot. Leé REMEDIATION-PLAN.md sección "SPRINT R1" completa
antes de empezar.

TAREA 1 (Pieza A — classifier inyectable):
- En packages/engine/src/bot/lifestyle/types.ts, agregá un tipo ClassifierFns
  con classifyIntent y classifyMultiIntent, y agregalo a StateHandlerDeps como
  campo `classifier`.
- En packages/engine/src/bot/lifestyle/handler.ts, al construir las deps que
  pasás a dispatch(), inyectá la implementación real importada de ./classifier.
- En cada handler que hoy hace `import { classifyIntent } from '../classifier'`
  y lo llama directo (greeting, qualifyingService, qualifyingStaff,
  qualifyingDatetime, awaitingConfirmation, confirmationResponse), reemplazá la
  llamada directa por deps.classifier.classifyIntent / .classifyMultiIntent.
- NO cambies la firma ni la lógica interna de classifier.ts. Es un refactor
  mecánico import→parámetro. Al terminar, `npm test` debe seguir 100% verde.

TAREA 2 (Pieza B — e2e happy-path):
- Creá tests/e2e-happyPath.test.ts. Reusá tests/fixtures/lifestyle.ts y el
  patrón makeSupabase(...) de tests/affirmNegationHandling.test.ts.
- Mockeá el classifier con una tabla de lookup userMessage→clasificación.
- Recorré el flujo completo greeting→...→CONFIRMED llamando a dispatch() por
  turno, encadenando newContext. Afirmá newState y el booking final.

TAREA 3 (Pieza C — invariantes):
- Creá tests/invariants.test.ts con las 4 invariantes descritas en el plan
  (no-bucle, salida coherente, caso "A las 10:15", exclusión de banderas).
- Si alguna invariante falla con el código ACTUAL, NO ajustes el test para que
  pase: reportámelo como hallazgo (es un bug real preexistente).

REGLAS:
- TypeScript strict. Sin red en tests (Supabase y classifier fakes).
- Agregá los archivos de test nuevos al script "test" de package.json.
- No toques scheduling.ts, ni la lógica de ningún handler más allá del swap
  import→deps.classifier.
- Al final corré `npm test` y mostrame el resultado completo.
```

## R1 — Criterio de cierre (Definition of Done)

R1 está cerrado cuando TODO esto es cierto:

- [ ] `classifier` es inyectable vía `StateHandlerDeps`; producción usa la real.
- [ ] Los 18 tests preexistentes siguen 100% verdes (cero regresión).
- [ ] `tests/e2e-happyPath.test.ts` existe y pasa: recorre greeting→CONFIRMED.
- [ ] `tests/invariants.test.ts` existe con las 4 invariantes.
- [ ] Invariantes 1, 2, 4 pasan con el código actual (o, si fallan, el bug está
      documentado en SPRINT.md como hallazgo a atacar — no silenciado).
- [ ] Invariante 3 (caso "A las 10:15") está presente, marcada como objetivo de
      R2 (rojo documentado o aserción-del-actual).
- [ ] `npm test` corre toda la malla; los nuevos archivos están en el script.
- [ ] **Smoke test por WhatsApp:** el happy-path completo sigue funcionando igual
      que antes de R1 (la inyección no cambió nada para el usuario). Probar:
      agendar una cita de punta a punta con `/reset-bot`. Comportamiento idéntico
      al de antes del sprint.
- [ ] Diff review aprobado por Gabriel. Sin merge hasta aprobación.

## R1 — Riesgo de regresión por pieza

- **Pieza A:** bajo. El único riesgo es olvidar inyectar el classifier en algún
  call-site → fallaría en runtime. Mitigación: el e2e (Pieza B) lo detecta, y
  TypeScript marca el campo faltante en deps.
- **Pieza B:** nulo (solo test). Riesgo inverso útil: si el e2e NO logra
  recorrer el happy-path, revela un acoplamiento oculto que ya existía.
- **Pieza C:** nulo para producción. Riesgo de "test mal escrito que pasa
  falsamente" — mitigación: la Invariante 3 debe fallar con el código actual
  (prueba de que el test tiene poder de detección).

---

## 4. Qué NO se toca en R1 (para evitar scope creep)

- `scheduling.ts` (es sólido; los ajustes AP-1/AP-2/AP-5 van en R7 o intercalados).
- La lógica de cualquier handler (solo el swap import→deps.classifier).
- El intérprete único (eso es R2; R1 solo construye su red de seguridad).
- El god-object de contexto (eso es R3).
- El ensamblado de mensajes (eso es R6, pero R1 deja la Invariante 2 que lo blinda).

---

## 5. Bitácora del plan

- **2026-06-21** — Auditoría de arquitectura (Fases 1–2) completa. 5 auditorías
  de código + validación de producción (bot_logs) + caso Q4b. Diagnóstico:
  comprensión dispersa + estado efímero sin contención. Plan de 7 sprints
  definido. R1 detallado. Pendiente: ejecutar R1, luego detallar R2.

---

# SPRINT R2 — Intérprete de turno único (Decisión 1)

> **Objetivo:** introducir UNA capa que interprete el mensaje del usuario una sola
> vez por turno, antes del switch de estado, produciendo un objeto inmutable
> `Interpretation`. Los estados dejan de re-parsear el mensaje crudo: leen de la
> interpretación. Consolida 3 parsers de hora, las listas de sí/no y los
> detectores dispersos en una fuente de verdad. **Determinista primero**, LLM
> detrás del fast-path (sin agregar llamadas LLM por turno).
>
> **Riesgo del sprint: ALTO.** Toca cómo se entiende cada mensaje en cada estado.
> Por eso R1 construyó la malla primero. Estrategia: estrangulamiento gradual —
> el intérprete se introduce y se cablea SIN borrar los parsers viejos en R2;
> los estados se migran uno por uno (R2 migra solo datetime; R4/R5 el resto).

## R2 — Evidencia que lo justifica (del smoke en producción)

Tres capturas de WhatsApp (2026-06-22) muestran la enfermedad en vivo:

- **Imagen 3 — "1 pm" funciona.** En CONFIRMING, `extractRawTime`
  (confirmingAppointment.ts:872, el parser 3, sofisticado) captura "1 pm" → 13:00
  y desambigua contra slots reales. Bien.
- **Imagen 1 — "7 pm" se pierde Y se salta el paso de fecha.** Dos síntomas, UNA
  raíz. El usuario dijo "con el que sea" sin dar fecha; `qualifyingStaff.ts:108`
  (y :150, duplicado) hace `requestedDate = ... ?? getTodayStr(...)` →
  **defaultea a hoy en silencio** y salta a CONFIRMING sin pasar por
  QUALIFYING_DATETIME. Luego "7 pm" cae en un camino sin parser 3 y se ignora;
  el estado reitera el mismo mensaje (el self-loop CONFIRMING→CONFIRMING que
  bot_logs mostró 43×).

**Diagnóstico confirmado:** el mismo input (hora suelta) se maneja bien en un
estado y se pierde en otro, porque cada estado tiene (o no tiene) su propio
parser. Es exactamente la Capa 1.

## R2 — Hallazgos de código que el intérprete consolida

| Pieza | Ubicación | Calidad | Destino en R2 |
|-------|-----------|---------|---------------|
| `parseTime` | greeting.ts:438 | Primitivo (regex "a las", heurística fija 1-6→PM) | Reemplazar por el intérprete |
| `parseTimeFromText` | qualifyingDatetime.ts:272 | Primitivo, **divergido** de parseTime (no reconoce "mañana" suelto) | Reemplazar |
| `extractRawTime` + `resolveTargetMinutes` | confirmingAppointment.ts:872 | **Superior** (HH:MM, "5pm", desambigua contra slots, sin heurística fija) | **Promover a base del intérprete** |
| `parseDate` | qualifyingDatetime.ts:298 | Único, sólido, TZ correcto | Mantener; el intérprete lo invoca |
| Default silencioso de fecha | qualifyingStaff.ts:108 y :150 | **Bug** (inventa fecha no dada) | Eliminar (ver Pieza C) |
| 16 call-sites de parsers de hora | states/ | Dispersos | Migrar datetime en R2; resto R4/R5 |

**Decisión de diseño clave:** `extractRawTime`/`resolveTargetMinutes` de
confirmingAppointment es el parser más maduro (ya pasó por el dolor de la
desambiguación AM/PM contra slots reales). El intérprete NO se escribe de cero:
**se extrae ese parser a la capa compartida y se promueve como la implementación
única.** parseTime y parseTimeFromText se eliminan al migrar sus estados.

## R2 — Alcance (4 piezas)

### Pieza A — Definir `Interpretation` y el módulo intérprete

**Qué:** crear `interpreter.ts` en `bot/lifestyle/` con el tipo y la función pura.

```ts
// Interpretación CRUDA y NEUTRAL del turno. No decide política de estado.
export type Interpretation = {
  readonly raw: string;              // mensaje original normalizado
  readonly time:   { hour: number; minute: number; period: 'am'|'pm'|null } | null;
  readonly date:   string | null;    // YYYY-MM-DD (vía parseDate), o null
  readonly affirmation: boolean | null;  // sí / no / null (no aplica)
  readonly staffMention: string | null; // nombre de barbero crudo, o null
  readonly hasSideQuestion: boolean;     // contiene "?" / keywords de side-q
  readonly ordinal: number | null;       // "la primera"→0, etc.
  readonly bareDigit: number | null;     // dígito desnudo (índice potencial)
};

export function interpret(input: {
  message: string;
  now: Date;
  timezone: string;
}): Interpretation { /* determinista, reusa extractRawTime + parseDate + ... */ }
```

**Frontera dura (guardarraíl B2):** `Interpretation` es CRUDA. NO decide si "va"
cuenta como sí en este estado, ni si una hora sin día es válida. Eso es
**política de estado** y se queda en los handlers. El intérprete solo dice
"detecté una hora=19:00", "detecté afirmación", "detecté mención de barbero".
La *resolución* sensible al estado la hace el estado leyendo de aquí.

**Guardarraíl B1 (costo/latencia):** `interpret()` es 100% determinista, CERO
llamadas LLM. El classifier LLM sigue donde está hoy (detrás del fast-path en
cada estado). El intérprete NO lo reemplaza ni lo antepone — consolida los
DETECTORES DETERMINISTAS, no la clasificación LLM. Un turno que hoy resuelve sin
LLM debe seguir resolviendo sin LLM.

### Pieza B — Cablear el intérprete en `dispatch()` y exponerlo a los handlers

**Qué:** correr `interpret()` una vez en el wrapper `dispatch()` (router.ts:94),
antes del switch de estado, y pasar el `Interpretation` a los handlers vía un
campo nuevo en los args (o en deps).

- El `Interpretation` se computa UNA vez por turno y se pasa inmutable.
- Convive con todo lo existente: en R2 los handlers NO migrados lo ignoran; solo
  datetime (Pieza C) lo consume. Estrangulamiento, no big-bang.

**Riesgo:** medio. Computar el intérprete no cambia comportamiento si nadie lo
consume todavía. La malla de R1 (308 tests) debe seguir verde tras B.

### Pieza C — Migrar QUALIFYING_DATETIME al intérprete + matar el default silencioso

**Qué:** el estado de fecha deja de llamar `parseTimeFromText`/`parseDate`
directo; lee `interpretation.date` y `interpretation.time`. Y se elimina el bug
de Imagen 1.

1. **Captura de hora sin día.** Si `interpretation.time` existe pero
   `interpretation.date` no, el estado guarda la hora (`requestedTime`) y pregunta
   SOLO el día — sin perder la hora, sin UNCLEAR. (Esto invierte la Invariante 3
   a verde: el caso "A las 10:15".)
2. **Matar el default silencioso.** En `qualifyingStaff.ts:108` y `:150`,
   reemplazar `?? getTodayStr(...)` por: si no hay fecha, NO inventar — transicionar
   a QUALIFYING_DATETIME y preguntar. (Esto arregla el salto de paso de Imagen 1.)
   *Marcado como ajuste estructural, no puntual: la raíz es la misma ausencia de
   "el usuario no especificó fecha" como estado representable.*

**Riesgo:** alto — es el corazón del cambio de comportamiento. Mitigación: la
malla R1 + los 3 casos de smoke objetivo (abajo) + migrar SOLO datetime en R2.

### Pieza D — Invertir Invariante 3 + tests del intérprete

**Qué:**
- `interpreter.test.ts` nuevo: tabla de casos del intérprete puro (las 3 formas
  de hora, divergencias de "mañana", ordinoriginales, afirmaciones, bare digit).
- Invertir Invariante 3 de `test.skip` a verde: "A las 10:15" en datetime captura
  la hora.
- Caso nuevo de Imagen 1: "con el que sea" sin fecha NO debe saltar a CONFIRMING
  con fecha inventada → debe preguntar el día.

## R2 — Orden de ejecución

1. Pieza A (intérprete puro + tests del intérprete) — aislado, sin tocar flujo.
2. Pieza B (cablear en dispatch, nadie consume aún) — malla R1 sigue verde.
3. Pieza C (migrar datetime + matar default) — aquí cambia el comportamiento.
4. Pieza D (invertir Inv.3 + casos de Imagen 1).

Ramas: `feat/r2a-interpreter` (A+B, infra sin cambio de comportamiento) y
`feat/r2b-datetime-migration` (C+D, el cambio de comportamiento), apilada.
Permite mergear A+B y validar malla verde antes del cambio riesgoso.

## R2 — Smoke-tests objetivo (de las 3 imágenes)

Al cerrar R2, estos 3 casos por WhatsApp deben comportarse así:

1. **"con el que sea" sin fecha** (Imagen 1) → el bot pregunta el día, NO inventa
   "hoy a las 10". 
2. **"7 pm" / "a las 7 pm"** en confirmación o tras ofrecer slots (Imagen 1) →
   captura 19:00, ofrece/reagenda; NO reitera el mismo mensaje (no self-loop).
3. **"1 pm"** (Imagen 3) → sigue funcionando igual (no regresión del parser bueno).

## R2 — Definition of Done

- [ ] `interpreter.ts` con `interpret()` puro y determinista (cero LLM).
- [ ] `extractRawTime`/`resolveTargetMinutes` promovidos a la capa compartida.
- [ ] `interpret()` cableado en `dispatch()`, computado 1×/turno.
- [ ] QUALIFYING_DATETIME consume `Interpretation` (no re-parsea crudo).
- [ ] Default silencioso de fecha eliminado en qualifyingStaff.ts:108 y :150.
- [ ] Invariante 3 invertida a VERDE.
- [ ] Caso "con el que sea sin fecha" cubierto por test (no inventa fecha).
- [ ] `interpreter.test.ts` cubre las 3 formas de hora + divergencias.
- [ ] Malla R1 (e2e + invariantes 1/2/4) sigue 100% verde.
- [ ] parseTimeFromText eliminado de datetime (parseTime/greeting se migra en R4/R5).
- [ ] Smoke WhatsApp: los 3 casos objetivo se comportan como se especificó.
- [ ] Diff review aprobado. Merge vía PR. Smoke en staging (ver nota infra).

## R2 — Nota de infraestructura (bloqueante blando)

R2 SÍ cambia comportamiento observable. El smoke directo en prod que sirvió para
R1 (cero cambio + cero tráfico) ya NO es la opción correcta. **Antes del smoke de
R2, montar canal de WhatsApp de staging** (segundo phone_number_id en Meta +
webhook al preview de Vercel + env vars de Preview ya configuradas). Es el gap de
infra que el plan marca como pendiente. No bloquea escribir código de R2; bloquea
el smoke final.

## R2 — Lo que NO se toca

- El classifier LLM (sigue detrás del fast-path; el intérprete es determinista).
- parseTime de greeting y el parser 3 de confirmingAppointment NO se borran en
  R2 (se migran en R4/R5; por ahora el intérprete extrae su lógica pero los
  estados viejos siguen). Estrangulamiento.
- El god-object de contexto (eso es R3).
- scheduling.ts (sólido).

## Bitácora — actualización R1 → R2

- **2026-06-22** — R1 cerrado. Piezas A/B/C mergeadas (PRs #28, #29). Malla:
  308 tests, Inv.1/2/4 verde con código actual, Inv.3 RED documentado.
  **Nota R3:** Inv.4 (exclusión de banderas) pasa por disciplina manual en
  confirmingAppointment.ts:178, no por estructura — R3 lo vuelve estructural.
  Smoke WhatsApp (3 capturas): happy path idéntico a pre-R1 (Imagen 2, cierre
  OK). Bugs en vivo confirmando diagnóstico: default silencioso de fecha
  (qualifyingStaff.ts:108/:150 → Imagen 1) y parsers de hora dispersos ("7 pm"
  perdido vs "1 pm" ok). R2 detallado con estos 3 casos como smoke objetivo.
