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
| **R2** | Intérprete de turno único | Decisión 1 | **Alto** | ✅ Detallado abajo |
| **R3** | Propuesta negociable de slot único | — (fix del smoke R2) | Bajo | 🔵 Código listo, smoke pendiente |
| **R4** | Migrar estados al intérprete (CONFIRMING + QUALIFYING_*) | Decisión 1 (aplicación) | Medio | ⏳ Al cerrar R3 |
| **R5** | Separación contexto durable/efímero | Decisión 2 | **Alto** | ⏳ Al cerrar R4 |
| **R6** | Unificar ensamblado de mensajes (anti-fragmento) | Decisión 2 (aplicación) | Medio | ⏳ Al cerrar R5 |
| **R7** | Ajustes puntuales (AP-1..AP-5) + cierre | — | Bajo | ⏳ Al cerrar R6 |

> **Reordenamiento (2026-06-22):** el smoke de R2 reveló que el bot auto-confirmaba
> el slot único y cerraba la puerta al cambio de hora. Se intercaló **R3 = propuesta
> negociable** (fix acotado, bajo riesgo) antes de la migración de estados. La
> **separación de contexto durable/efímero (Decisión 2)** se corrió a **R5**, y la
> migración de estados al intérprete se consolidó en **R4**.

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
el refactor de R2/R5 rompe una propiedad global.

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
  (Blinda a mano lo que R5 hará estructural.)

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
- El god-object de contexto (eso es R5).
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
- El god-object de contexto (eso es R5).
- scheduling.ts (sólido).

## Bitácora — actualización R1 → R2

- **2026-06-22** — R1 cerrado. Piezas A/B/C mergeadas (PRs #28, #29). Malla:
  308 tests, Inv.1/2/4 verde con código actual, Inv.3 RED documentado.
  **Nota R5:** Inv.4 (exclusión de banderas) pasa por disciplina manual en
  confirmingAppointment.ts:178, no por estructura — R5 lo vuelve estructural.
  Smoke WhatsApp (3 capturas): happy path idéntico a pre-R1 (Imagen 2, cierre
  OK). Bugs en vivo confirmando diagnóstico: default silencioso de fecha
  (qualifyingStaff.ts:108/:150 → Imagen 1) y parsers de hora dispersos ("7 pm"
  perdido vs "1 pm" ok). R2 detallado con estos 3 casos como smoke objetivo.
- **2026-06-22** — R2 C2 (cura de raíz de la hora). **C2.1:** QUALIFYING_DATETIME
  lee `deps.interpretation.time`; captura hora-sin-día (pregunta solo el día,
  conserva la hora en `requestedTime`); aparca período ambiguo (1–6 en punto sin
  período → pregunta "¿mañana o tarde?" vía `pendingPeriodTime`, sin adivinar
  PM). `parseTimeFromText` borrado de datetime. **C2.2 (auditoría read-only):**
  mapeo de TODOS los caminos fecha/hora dispersos (TABLA 1 fecha, TABLA 2 hora).
  Decisión **P3 = (b)** — cura de raíz: greeting deja su `parseTime` propio y
  consume el MISMO intérprete + la MISMA política (`resolveInterpretedTime`,
  exportada desde qualifyingDatetime). **UN solo parser de hora en todo el FSM.**
  `parseTime` de greeting BORRADO. *Esto adelanta lo que "R2 — Lo que NO se toca"
  (línea 514) difería a R4/R5; se adelantó por decisión explícita del sprint
  (la dispersión de hora era la enfermedad real, no un getTodayStr suelto).* La
  lógica de `greetCase` queda EQUIVALENTE: solo cambia la FUENTE de
  `parsedTimeStr` (timeMatch→interpretation), sigue ramificando por su presencia.
  **C2.3:** Inv.3 ("A las 10:15") invertida a VERDE. **C2.4:**
  `tests/timePolicyR2.test.ts` — 5 casos vía `dispatch()` (sin fecha → pregunta
  día; "7 pm" → 19:00; "5pm" pegado → PM explícito 17:00 directo; "a las 5" →
  ambiguo + resolución por período; greeting "a las 7 pm" → 19:00 = misma
  política). **Fix 5pm (decisión de producto):** en `extractRawTime` el marcador
  pm/am usaba `\b` (word-boundary) que NO matchea el dígito pegado ("5pm"); se
  cambió a lookbehind negativo de letra `(?<![a-z])` → "5pm"/"5am"/"5p.m." dan
  período explícito igual que "5 pm", sin romper "a las 5"/"10:15"/"de la tarde".
  Malla: **343 tests verde, tsc 0.** **Deuda P2 (NO resolver ahora):** la intent de
  disponibilidad de FASE B está DUPLICADA en 2 archivos — qualifyingStaff.ts
  (bloques AVAILABILITY + wantsStaffAxis, ambos `?? getTodayStr`) y
  qualifyingDatetime.ts (bloque availability). Mostrar "hoy" en FASE B es
  intencional y consistente; consolidar los 3 sitios en una sola fuente es
  trabajo futuro, fuera de C2. **Pendiente:** smoke WhatsApp (5 casos en el
  número Meta de TEST) — bloqueado blando por el canal de staging.

## Bitácora — cierre R3 (propuesta negociable de slot único)

- **2026-06-22** — R3 ejecutado en `feat/r3-negociable`. **Pieza A:** en
  `presentingSlots.ts:284` (autoAssign + 1 slot único) el bot ya NO auto-confirma
  saltando a `AWAITING_BOOKING_NAME`; mantiene el slot en `pendingSlots`, va a
  `CONFIRMING_APPOINTMENT` y frasea negociable ("Tengo disponible … a las HH con
  X. ¿Te sirve o preferís otra hora?"; variante exactMatchMissed conserva el
  preámbulo "a las X no tengo, lo más cercano…"). NO setea
  `selectedSlot`/`pendingBookingName`/`nearestOfferSlot`, así un "sí" cae en el
  handler P1 (`confirmingAppointment.ts:175`, `pendingSlots.length===1 &&
  isAffirmation`) → `buildConfirmationResult` → nombre en UN solo paso: la
  fluidez para quien acepta queda intacta. **Pieza B:** ya cableada — con 1 slot
  en `pendingSlots`, una hora fuera de rango ("7pm") rutea a `offer_nearest` →
  `handleOfferNearest` re-consulta disponibilidad REAL del día con la hora pedida
  ("no tengo 7pm, lo más cercano 6:45"); no hizo falta cableado nuevo, solo
  cobertura de test. **Test actualizado:** `staffAxisIntent.test.ts` "default
  (presentBy ausente)" — blindaba el viejo salto a `AWAITING_BOOKING_NAME`; ahora
  afirma `CONFIRMING_APPOINTMENT` + frase negociable (decisión explícita del
  sprint: el test documentaba el bug que se mató). **Tests nuevos:**
  `tests/r3Negotiable.test.ts` — (1) 1 slot → propuesta negociable (no
  te-asigno/nombre); (2) tras propuesta "7pm" → ofrece cercana (19:00, no repite);
  (3) tras propuesta "sí" → `AWAITING_BOOKING_NAME` en un paso; (4) varios slots →
  lista (sin regresión). **Frontera respetada:** NO se migró CONFIRMING entero
  (R4) ni se tocó el ensamblado del router (R6). Malla: **347 tests verde, tsc 0**
  (343 R2 + 4 nuevos; R1/R2 intactos). **Pendiente:** smoke WhatsApp (4 casos
  objetivo) en el número Meta de TEST. Sin commit ni merge hasta el OK del smoke.

---

# BUG CRÍTICO (smoke R3) — La confirmación pasiva secuestra el "sí" del flujo activo

> Hallazgo del smoke de R3. **Bug de confianza:** el cliente negocia y acepta una
> hora, y el bot agenda OTRA. Severidad alta (rompe la promesa central del
> producto: lo que el cliente dice ≠ lo que el bot hace). Fix acotado y aislado en
> `rama fix/passive-confirm-guard`: una guarda de prioridad en el choke-point del
> router. NO toca el envío de recordatorios (eso es trabajo estratégico aparte).

## Síntoma

En CONFIRMING_APPOINTMENT, tras negociar un slot único (p. ej. el bot propone las
17:00 y el cliente responde **"sí"**), el bot **no agenda las 17:00**: confirma una
cita preexistente del cliente que cae en las próximas 3h (p. ej. las 10:00) y
responde *"Perfecto! Te esperamos a las 10:00"*. **Dice 5pm, agenda 10.**

## Causa raíz (mecanismo en código)

El handler pasivo de recordatorios corre **antes del switch de estado**, en TODO
mensaje, y hace short-circuit:

- [`router.ts`](packages/engine/src/bot/lifestyle/router.ts) — `routeToHandler`
  llamaba `handleConfirmationResponse(msg, context, deps)` **antes** del `switch`;
  si devuelve no-null, `return` inmediato → el handler del estado nunca ve el
  mensaje.
- [`confirmationResponse.ts`](packages/engine/src/bot/lifestyle/states/confirmationResponse.ts)
  busca la cita confirmed/pending **más próxima dentro de 3h**
  (`.in('status',['confirmed','pending']).gte(now).lte(now+3h)`) y, ante un "sí",
  la confirma con el `timeStr` de **esa** cita — no del slot negociado.
- El "sí" suelto no matchea las frases-keyword del pasivo → cae a su clasificador,
  que en producción (LLM) devuelve `CONFIRM_YES` alto → confirma. (Por eso el bug
  es invisible a un test con key vacía: hay que mockear el clasificador.)

Es la misma enfermedad estructural del diagnóstico (§1): una invariante de
prioridad ("el flujo activo manda sobre el pasivo") que **nadie imponía desde un
punto central** — el pasivo asumía prioridad absoluta sin preguntar si había un
flujo vivo.

## Validación — tres vías independientes

1. **Smoke en vivo (WhatsApp).** Captura del smoke R3: cliente acepta el slot
   negociado, el bot confirma una hora distinta. El síntoma reportado.
2. **Lectura de código.** Trazado de `routeToHandler`: la llamada pasiva precede
   al `switch` y hace `return` si no-null; `handleConfirmationResponse` confirma la
   cita de la ventana de 3h vía su clasificador. Causa raíz confirmada por
   inspección.
3. **Test de repro determinista.** `tests/passiveConfirmGuard.test.ts` por
   `dispatch()` (el bug vive en el router, no en un handler): state=CONFIRMING,
   `pendingSlots=[17:00]`, cita próxima de 10:00 sembrada, classifier mock
   `CONFIRM_YES`. **Antes del fix FALLA** (`newState='CONFIRMED'`,
   `selectedSlot=undefined`); **después PASA** (`AWAITING_BOOKING_NAME`,
   `selectedSlot=17:00`). El rojo→verde es la prueba de que el test tiene poder.

## El fix — guarda de prioridad en el choke-point

En [`router.ts`](packages/engine/src/bot/lifestyle/router.ts), un set dedicado
`ACTIVE_FLOW_STATES` (los 8 estados mid-flow) y la llamada pasiva envuelta:

```ts
if (!ACTIVE_FLOW_STATES.has(state)) {
  const confirmResult = await handleConfirmationResponse(msg, context, deps);
  if (confirmResult !== null) return confirmResult;
}
```

- **Señal correcta = el `state`, no campos del contexto.** Se descartó chequear
  `pendingSlots`/`nearestOfferSlot`: son frágiles (dependen de que cada handler los
  limpie) y son subconjuntos del state (solo se pueblan dentro de SHOWING_SLOTS/
  CONFIRMING). El state llega limpio al router (1er parámetro de `routeToHandler`).
  Es el principio del plan: imponer la invariante en el choke-point, sin depender
  de la cooperación de los handlers.
- **Set SEPARADO de `BOOKING_STATES`** (alcance del contador de escape): mismo
  contenido hoy, distinto propósito — desacoplados a propósito.
- **El pasivo sigue interviniendo en reposo** (GREETING/CONFIRMED/terminales): el
  recordatorio legítimo (sí/no/voy tarde de un cliente que no está agendando) no se
  rompe. Blindado por el test de no-regresión.
- **Frontera:** NO se migró CONFIRMING entero (R4) ni se tocó el ensamblado del
  router (R6) ni el envío de recordatorios. Cambio mínimo: +1 set, +1 guarda.

## Hallazgo secundario — citas de prueba acumuladas (data hygiene del smoke)

El bug se reproducía tan confiablemente en el smoke porque cada agendamiento de
prueba deja una cita confirmed/pending con `starts_at` en el futuro cercano, y
`/reset-bot` resetea la **conversación** pero NO la tabla `appointments`. Así la
ventana de 3h del pasivo casi siempre encuentra una cita de prueba rancia.

Implicaciones: (a) explica la alta tasa de repro en el smoke; (b) **incluso con la
guarda**, un "sí" en reposo (GREETING/CONFIRMED) puede confirmar una cita de
prueba acumulada — la guarda arregla el secuestro del flujo activo, no la higiene
de datos de prueba. **No se ataca en este sprint.** Propuesta de backlog: limpieza
del entorno de smoke (cancelar/borrar citas de prueba futuras) o extender
`/reset-bot` para barrer citas de prueba próximas del número en allowlist.

## Deuda de infra — el gate de tipos en CI

Este sprint destapó (al correr `tsc -p tsconfig.test.json --noEmit`) **14 errores
de tipo pre-existentes** en `tests/sideQuestion.test.ts` (`SideQuestionRoute.text`
sin estrechar la unión por `mode`). **Ajenos a este fix — no se tocan aquí.**

El hallazgo de fondo NO son los 14 errores: es que `npm test` corre con
`TS_NODE_TRANSPILE_ONLY=1` y **NO chequea tipos**. Una malla verde garantiza
comportamiento runtime, no tipos sanos — estos 14 errores convivían tranquilos con
349 tests en verde. **Deuda:** que el CI agregue `tsc -p tsconfig.test.json
--noEmit` como gate (además del transpile-only de `npm test`), para que un error de
tipos en los tests rompa el build. Eso habría detectado esto solo. El fix de los 14
+ el gate de CI = **sprint de higiene aparte**, después.

## Bitácora — fix guarda de confirmación pasiva

- **2026-06-23** — `fix/passive-confirm-guard` (ramificada de main `f8c0577`).
  **PASO 1:** guarda `ACTIVE_FLOW_STATES` en `router.ts` — el pasivo no se consulta
  si el state es mid-flow; el flujo conversacional siempre gana. **PASO 2:**
  `tests/passiveConfirmGuard.test.ts` (2 casos, por `dispatch()`): repro
  rojo→verde + no-regresión del recordatorio en GREETING. Confirmado que el repro
  FALLA antes del fix. **PASO 3:** esta sección (el plan en main quedó atrás
  respecto a lo diagnosticado; este commit lo reconcilia). Malla: **349 tests
  verde** (347 R3 + 2 nuevos; R1/R2/R3 intactos), **app tsc 0**. (Deuda de infra
  destapada por este sprint: ver "Deuda de infra — el gate de tipos en CI" arriba.)
  **Smoke en vivo (2026-06-23): PASÓ** — negocia 5pm → agenda 5pm (ya no 10).
  **PR #33 mergeado a main** (`55d7a32`). El smoke reveló 2 hallazgos nuevos
  (Hallazgo A: side-question ignorada en CONFIRMING; Hallazgo B: modificación
  post-CONFIRMED reinicia la conversación) → materia prima de R4 (sección abajo).
  **NO incluye** el PASO 3 estratégico (revisar el envío/scope de recordatorios) —
  sprint aparte.

---

# SPRINT R4 — Migración incremental de estados al intérprete (Decisión 1, aplicación)

> **Reconciliación 2026-06-23.** R3 cerrado y el fix de confianza confirmado en
> smoke → R4 se detalla (convención del plan: cada sprint se detalla al cerrar el
> anterior). **Cambio respecto al plan original:** R4 deja de ser un solo paso
> grande ("Migrar estados al intérprete (CONFIRMING + QUALIFYING_*)"); se ejecuta
> **INCREMENTAL, un estado/concern por sub-sprint** (R4.1–R4.6), cada uno con su
> rama, diff review y smoke. **Punto de corte go-live-ready (§3): al cerrar R4.**

## R4 — Por qué incremental

CONFIRMING_APPOINTMENT es el foco caliente (43 self-loops
`CONFIRMING→CONFIRMING` en bot_logs; el bug de confianza vivió ahí). Migrarlo de
un golpe junto al resto repetiría el riesgo que R2 evitó con el estrangulamiento.
Cada sub-sprint migra UN estado a **consumir `deps.interpretation`** (en vez de
re-parsear el mensaje crudo con su propio parser), con la malla (349 tests) como
red. La *política* sensible al estado (¿"va" cuenta como sí aquí?, desambiguación
AM/PM contra slots reales) se queda en el estado; la *interpretación* neutral se
comparte. El orden lo dicta el riesgo: primero el estado más caliente y más
cubierto por tests.

## R4 — Regla de oro y disciplina por sub-sprint

- **Cada sub-sprint:** rama propia → malla verde → smoke del flujo afectado →
  merge → y recién el siguiente. Nunca dos en vuelo.
- **Migración = "leer del intérprete en vez de parsear crudo", preservando el
  comportamiento** — salvo donde el smoke marcó bug (Hallazgos A/B, que sí cambian
  comportamiento, y van en R4.5/R4.6).
- **Si el intérprete difiere del parser viejo: PARAR y decidir, no absorber en
  silencio.** Una divergencia es un hallazgo (¿cuál es correcto?), no un detalle a
  tragar. Mismo principio que R2 con el caso "5pm".

## R4 — Materia prima: 2 hallazgos del smoke (2026-06-23)

Ambos descubiertos en el smoke del fix de confianza. No son regresiones del fix
(la guarda no los introdujo) — son gaps preexistentes que el smoke iluminó.

### Hallazgo A — side-question ignorada en CONFIRMING_APPOINTMENT

**Síntoma (smoke):** en CONFIRMING, si el cliente pregunta algo fuera del flujo
(precio, dirección, duración) en lugar de elegir/confirmar el slot, el bot **no
responde la pregunta**: la trata como selección no reconocida y cae a clarify.

**Causa (código):** `handleConfirmingAppointment` rutea por detectsServiceCorrection
→ pendingDigitDisambig → nearestOfferSlot → P1 afirmación → routeSlotSelection →
barberSel → switch. **No hay rama de side-question.** El `containsSideQuestion` /
`answerSideQuestion` del router existe SOLO en el branch `CONFIRMED`
([`router.ts`](packages/engine/src/bot/lifestyle/router.ts) caso CONFIRMED), no
en CONFIRMING. Una pregunta legítima muere en el clarify de selección. (El único
rastro de side-question en CONFIRMING es `last_side_question: null`, un reset de
contexto — no un handler.)

**Destino en R4: R4.5** (NO R4.1). El Hallazgo A se cura en el sub-sprint de
side-question unificada, no al migrar CONFIRMING. R4.5 expone
`interpretation.hasSideQuestion` + un handler compartido para que TODOS los estados
(incl. CONFIRMING) deriven la pregunta fuera-de-flujo antes de tratar el mensaje
como selección. Cura estructural en un solo lugar, no un parche por estado.

### Hallazgo B — modificación post-CONFIRMED reinicia la conversación

**Síntoma (smoke):** tras una cita CONFIRMED, si el cliente pide cambiarla
("mejor a las 6", "cambiar la hora"), el bot **cancela la cita y arranca un
agendamiento desde cero** ("Listo, cancelé tu cita… ¿Qué servicio necesitas?") —
pierde servicio/barbero/fecha ya conocidos.

**Mecanismo (código, [`router.ts`](packages/engine/src/bot/lifestyle/router.ts)):**
en CONFIRMED, `isModificationIntent` → `handleModificationOrCancellation('modification', …)`
hace `UPDATE status=cancelled` y retorna `{ newState: 'GREETING', newContext:
{ customerId } }` con copy "vamos a agendar una nueva". Por diseño, modificación =
cancelar + reiniciar. No existe un camino que conserve el contexto y solo cambie
el eje pedido (hora/día).

**Destino en R4: R4.6** (el más delicado — toca CONFIRMED). Una modificación
debería **reagendar conservando lo que no cambia** (mismo servicio/barbero, nueva
hora), reabriendo con la hora nueva, no borrar todo. Misma clase de "corrección
preservando ejes" que ya existe en CONFIRMING (S5-BOT-08).

## R4.1 — Migrar confirmingAppointment al intérprete

**Qué:** CONFIRMING deja de leer el mensaje con sus listas propias de afirmación y
su parser de hora (`extractRawTime` / `resolveTargetMinutes` / `routeSlotSelection`,
el "parser 3" que R2 promovió como base del intérprete) y **consume
`interpretation.affirmation` e `interpretation.time`**. La política de desambiguación
AM/PM contra slots reales se queda en el estado. Es el estado más caliente (el del
bug de confianza).

**SOLO afirmación/hora — NO side-question.** El Hallazgo A (side-question en
CONFIRMING) NO se toca aquí: se cura de raíz en **R4.5** (side-question unificada).
R4.1 no debe hacer dos cosas distintas.

**Frontera:** NO se borran los parsers viejos hasta que el estado migrado pase
smoke (estrangulamiento, como R2). NO se toca scheduling.ts ni el ensamblado del
router (R6). Malla 349 verde + smoke dirigido como gate.

**Riesgo:** medio-alto (el estado más caliente). Mitigación: malla + smoke +
migrar SOLO este estado en R4.1.

## R4.2 — qualifyingStaff

Consume `interpretation.affirmation` y la no-preferencia ("cualquiera", "el que
sea") desde el intérprete, en vez de su detección propia.

## R4.3 — awaitingConfirmation + awaitingBookingName

Afirmación/negación + corrección de resumen (hora/día/barbero/cancelar) desde el
intérprete. Es el cierre del flujo legacy. (Aquí cabe el residual S5-BOT-08b:
"con &lt;barbero&gt;" contra la lista de staff del negocio, no solo `pendingSlots`.)

## R4.4 — waitlist + qualifyingService

Completar afirmación/negación desde el intérprete en los dos estados que faltan.

## R4.5 — Side-question unificada en todos los estados (cura el Hallazgo A)

Una sola vía de side-question en **TODOS** los estados (incl. CONFIRMING) vía
`interpretation.hasSideQuestion` + un handler compartido. Hoy la side-question solo
se atiende en CONFIRMED; CONFIRMING (y otros) la ignoran y la pregunta muere en
clarify. R4.5 la cura **de raíz**, en un solo lugar, no por estado. (Por eso R4.1
NO la toca.)

## R4.6 — Modificación post-CONFIRMED que preserva contexto (cura el Hallazgo B)

Tras CONFIRMED, "cambiar mi cita a las 6" debe **MODIFICAR** (reabrir la cita con
la hora nueva, conservando servicio/barbero/fecha), no cancelar + GREETING. **El
más delicado: toca CONFIRMED.** Reusa el patrón de corrección por ejes de S5-BOT-08.

(QUALIFYING_DATETIME y el `parseTime` de greeting **ya** se migraron en R2 — no
entran a R4.)

## Bitácora — reconciliación del plan (R4 + hallazgos del smoke)

- **2026-06-23** — `docs/reconcile-plan`. El plan en main quedó atrás respecto a
  lo diagnosticado en los smokes. Reconciliado: (a) bitácora del fix de confianza
  actualizada (smoke PASÓ, #33 mergeado); (b) sección R4 incremental con su
  fundamento + regla de oro (rama/malla/smoke/merge por sub-sprint; divergencia
  intérprete↔parser = parar y decidir); (c) los 2 hallazgos del smoke (A
  side-question en CONFIRMING → cura en R4.5; B modificación post-CONFIRMED reinicia
  → cura en R4.6) documentados como materia prima, con síntoma + causa de código
  verificada; (d) los 6 sub-sprints **R4.1–R4.6 anclados** con el desglose de
  Gabriel. **Corrección aplicada:** R4.1 NO toca side-question (solo afirmación/hora);
  el Hallazgo A se cura SOLO en R4.5 — la nota previa que lo ponía en R4.1 y R4.5 a
  la vez era imprecisa. Commit de SOLO documentación (SPRINT.md + REMEDIATION-PLAN.md);
  sin tocar código. R4.1 arranca como sprint de código aparte, tras mergear esta
  reconciliación.

---

## HALLAZGO de producto — representación parcial de disponibilidad

Síntoma (smoke R4.1): cliente pide día, "¿qué horarios tiene Andrés?" → bot ofrece
solo los 3 más tempranos ("10 o 12"). Pregunta "¿no hay a las 8?" → "no, lo más
cercano es 10" — FALSO, sí había 8pm. El cliente insiste y aparece. Sin insistir,
cita perdida.

Causa raíz (scheduling.ts:616): slice(0, MAX_SLOTS_TO_RETURN=3). Sin requestedTime
ordena cronológico y toma los 3 más tempranos; con requestedTime reordena por
cercanía. El bot está ciego a su agenda completa: se queda con 3 antes de razonar.
"Lo más cercano es 10" = de los 3 cargados, no de toda la agenda → afirmación falsa.
Primo del bug de confianza (habla con certeza de lo que no verificó).

Hallazgo acoplado: "a las 8" sin period → 8am cuando el cliente quería 8pm (negocio
abre hasta 23:00). Desambiguación AM/PM necesita criterio contextual, no default AM.

## DISEÑO — Disponibilidad honesta (decisiones de producto de Gabriel)

Plantillas deterministas (NO LLM). Comportamiento por FORMA de la disponibilidad.
Dos franjas: mañana / tarde-noche (corte ~14:00).

Árbol de decisión (ante "¿qué horarios hay?", barbero+día definidos):
1. ¿Cliente dio pista (franja/hora)? → filtrar a eso, ir a paso 3. No re-preguntar.
2. ¿Slots en AMBAS franjas? No → listar directo esa franja. Sí → preguntar binario
   "¿mañana o más tarde?", filtrar, paso 3.
3. Mostrar subconjunto de UNA franja: pocos (≤3-4) → listar todos; muchos → muestra
   representativa (3 espaciados + "o preferís otra hora").

Regla maestra: nunca mostrar >~3-4 horas de golpe; nunca afirmar una franja sin
slots; preguntar franja solo cuando reparte lista larga.

Cambio técnico raíz: separar "qué hay disponible" (forma completa: cuántos, qué
franjas) de "qué muestro" (acotado). scheduling devuelve la forma; presentingSlots
decide. Arregla también el "lo más cercano" falso. Riesgo medio-alto (toca
scheduling.ts núcleo + presentingSlots).

> ⚠️ **SUPERADO PARCIALMENTE** (2026-06-25): el paso 2 "preguntar ¿mañana o más
> tarde?" (ask-franja) fue ELIMINADO por la Versión C. Ahora, ante slots en ambas
> franjas, NO se pregunta — se muestra una muestra representativa de todo el día
> con señal de amplitud honesta ("desde temprano hasta la noche" si ambas franjas;
> "varios huecos en la {franja}" si una sola) + "¿te late alguna o buscas otra?".
> `buildFranjaQuestion`/`FRANJA_QUESTIONS` eliminados. El "último recurso"
> mañana/noche (`buildLastResortPeriodQuestion`) es OTRO camino y SIGUE vivo. Ver
> la bitácora de SPRINT.md (entrada 2026-06-25, "fix doble-lista v2 / Versión C")
> para el diseño de la Versión C.

---
