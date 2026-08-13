# Plan dueño-v3 — implementación VISUAL (Fase 3)

**Qué es esto.** El rediseño visual de la vista de dueño de `apps/lifestyle`,
aprobado sobre la maqueta `docs/maquetas/dueno-v3.html` (ábrela en un navegador:
es navegable y al final tiene la sección **Sistema** con la especificación de
tokens, escala, movimiento y estados; `docs/maquetas/dueno-v3-notas.md` es la
referencia escrita). **No hay features nuevos**: es composición, tokens,
gráficas y consistencia. Los datos y las server actions existentes no cambian
de semántica.

**Contexto mínimo que necesitas** (el diagnóstico completo no está en tu
contexto): la vista actual funciona pero es plana — todo texto/tile del mismo
peso, listas sin tope, dos sistemas de color conviviendo (los componentes
nuevos usan tokens de marca de `globals.css @theme`; los ~20 paneles legacy de
Administrar usan paleta numérica de Tailwind). La maqueta resuelve jerarquía,
densidad, movimiento y estados. Tu trabajo es implementarla SIN reescribir el
primer corte: los módulos de datos (`lib/pulso*.ts`, `lib/fuga*.ts`,
`lib/cadence.ts`, `lib/negocioMetrics.ts`, `lib/occupancy.ts`,
`lib/staffRecompra.ts`) se REUSAN tal cual; cambia la capa de presentación.

## Reglas globales (aplican a TODOS los pasos)

- **Un paso = un PR = un problema.** Mergeable solo si la vista queda funcional.
- **Gates por paso**: `cd apps/lifestyle && npx tsc --noEmit` → 0 errores ·
  `npx eslint .` → 0 errores nuevos (baseline: 0 errores / 13 warnings) ·
  `npm test` (raíz del repo) completo en verde.
- **Cálculo nuevo = módulo puro** (sin DB/red/React) en `apps/lifestyle/src/lib/`
  con tests `node:test` — el patrón de `lib/pulso.ts`.
- **Verificación con `TZ=UTC`**: el dev server se corre `TZ=UTC` (los bugs de
  timezone se esconden si la máquina está en hora de México). Config
  `lifestyle-utc` de `.claude/launch.json`, puerto 3210.
- **Prohibido**: tocar `appointment_tips` en cualquier forma (hay lint y
  repo-check que rompen el build); crear una segunda definición de ocupación
  (la única es `lib/pulso.ts`: `min(1, citas ÷ capacidad agendable)`); comparar
  ocupación-% histórica (staff_availability no versiona el pasado); construir
  sobre `DashboardRealtimeProvider` (código muerto en retirada); juicios en el
  copy ("vas bien", "mal día") — dato + comparación siempre; voseo (español
  mexicano neutro).
- **La maqueta manda en lo visual, esta tabla manda en lo técnico**: la maqueta
  usa JS para orquestar su demo; en producción el movimiento se implementa así
  (frontera server/cliente RESUELTA — no la re-decidas):

| Movimiento | Implementación en producción | Frontera |
|---|---|---|
| Entrada de barras/heatmap (stagger 30ms) | CSS `animation` + `animation-delay: calc(var(--i)*30ms)`; el toggle `display` de OwnerTabs las re-dispara | server |
| Transición de pestaña | `@keyframes` sobre la sección visible | server (OwnerTabs ya es client, no crece) |
| Tap-states | `:active` | server |
| Disclosures ("ver todos", configuración) | `<details>` nativo estilizado; animar con `::details-content` si el browser lo soporta, fallback instantáneo | server |
| Skeletons | `<Suspense fallback={…}>` con esqueletos CON LA FORMA del contenido | server (streaming) |
| CTA "Mensaje" | NO se cablea en este plan; se rinde en variante `gated` (ver Paso 3) | — |

## Red de seguridad visual (obligatoria en cada paso)

**Prerrequisito de TODA verificación visual: corre primero
`scripts/seed-demo-densa.sql` contra la BD demo** (ver scripts/README.md; es
idempotente y relativo a hoy). Las capturas solo prueban algo contra datos
DENSOS — sobre la demo pobre comparas dos vistas vacías y firmas que "nada se
rompió" sin haber probado nada. Corre el seed una vez al inicio del paso (antes
de la captura "antes") y NO lo vuelvas a correr entre el antes y el después del
mismo paso, para que la comparación sea sobre los mismos datos.

Después, captura las 5 pestañas (4 antes del Paso 6) a 375px, página completa,
y compáralas contra el criterio del paso ("qué debe cambiar / qué no").
Procedimiento (Playwright NO está en el repo — móntalo en un directorio
temporal, nunca lo agregues a package.json):

```bash
mkdir -p /tmp/capturas-dueno && cd /tmp/capturas-dueno
npm init -y && npm i playwright && npx playwright install chromium
```

```js
// /tmp/capturas-dueno/cap.mjs — node cap.mjs <etiqueta>
import { chromium } from 'playwright';
const TABS = ['Panorama', 'Análisis', 'Clientela', 'Administrar', 'Actividad']; // sin Análisis antes del Paso 6
const tag = process.argv[2] ?? 'x';
const b = await chromium.launch();
const page = await (await b.newContext({ viewport:{width:375,height:812}, deviceScaleFactor:2 })).newPage();
await page.goto('http://localhost:3210/login', { waitUntil:'networkidle' });
await page.fill('input[type="email"]', 'contacto@zentriq.mx');
await page.fill('input[type="password"]', 'ZentriqPrueba1');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard**'); await page.waitForTimeout(4000);
for (const t of TABS) {
  try { await page.getByRole('button', { name: t, exact: true }).click({ force: true }); } catch { continue; }
  await page.waitForTimeout(2500);
  // NUNCA disparar con una espera fija sola: ver "La espera es por contenido" abajo.
  try {
    await page.waitForFunction(
      () => !/Cargando…|Cargando\.\.\./.test(document.body.innerText),
      { timeout: 20000 },
    );
  } catch { console.log(`   (aviso: ${t} sigue con "Cargando…" tras 20s)`); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${tag}-${t}.png`, fullPage: true });
}
await b.close();
```

**La espera es por CONTENIDO, nunca por tiempo fijo (endurecido 2026-08-12, D1).**
Varios paneles de Administrar son client-side y tardan más que cualquier timeout
razonable: `/api/reports/staff-metrics` mide **1–3.3 s** en dev con el seed denso,
contra los 2.5 s fijos que esperaba la versión original del script. Resultado: el
panel "Rendimiento del equipo" salía en "Cargando…" en unas corridas y cargado en
otras, cambiando el alto de la página en ~6,900 px — un diff enorme que no
corresponde a ningún cambio de código. Es el peor modo de falla posible de esta
red: **puede inventar un cambio que no existe y, al revés, tapar uno real** dentro
de una zona que en una corrida no llegó a renderizar. Por eso la espera es "que no
quede ningún 'Cargando…' visible", con un aviso explícito si a los 20 s sigue ahí.

**Cuando una captura acuse diff, el estándar es descartar primero el artefacto:**
localizar la banda con un diff de píxeles, recortarla y MIRARLA, y correr dos
capturas consecutivas del mismo estado — si esas dos dan 0 píxeles, el estado es
estable y la diferencia estaba en la captura, no en el código. Nunca se firma "es
artefacto" sin esas dos corridas.

**Excepción de Actividad (verificada 2026-08-12, D1b): ahí "0 píxeles" es
inalcanzable por construcción.** El log rinde tiempos RELATIVOS ("hace 3 min"),
así que dos capturas separadas por minutos siempre difieren, y la regla de las
dos corridas no puede cerrar. El criterio en esa pestaña es distinto: que las
bandas del diff sean **únicamente etiquetas de tiempo**, verificado con recorte —
una banda por fila del log, de la altura de una línea de texto, y al mirarla lo
único que cambia es el número de minutos. Cualquier banda que no sea eso es un
cambio real y hay que explicarlo.

La BD demo es densa y reproducible: si hace falta resetearla,
`scripts/seed-demo-densa.sql` (destructivo, solo demo — ver scripts/README.md).

---

## Paso 1 · [SEGURO] Tokens del sistema en `globals.css`

**Objetivo:** dar de alta, en un solo lugar, todos los tokens que la maqueta
consume — sin cambiar ningún componente todavía.

**Archivos:** `apps/lifestyle/src/app/globals.css` (solo agregar al `@theme` y
`:root`; no modificar tokens existentes).

**Qué agregar (valores exactos, decididos y validados — no los cambies):**

```css
/* Datos — categórica B "contenida" (elegida por Gabriel). El ORDEN es el
   mecanismo de seguridad para daltonismo (validado): no reordenar. */
--color-viz-cat-1: #008F76;  /* teal marca */
--color-viz-cat-2: #35619F;  /* azul */
--color-viz-cat-3: #9C500F;  /* ámbar profundo */
--color-viz-cat-4: #4F42B5;  /* violeta */
--color-viz-cat-5: #9C3F73;  /* berry */
--color-viz-otros: #9CA0A4;  /* pliegue "otros" — jamás una 6ª serie */
/* Secuencial teal (magnitud) */
--color-viz-seq-1: #EBFAF8; --color-viz-seq-2: #C7F2EC; --color-viz-seq-3: #8FE3D3;
--color-viz-seq-4: #4CC9AF; --color-viz-seq-5: #17A98C; --color-viz-seq-6: #018271;
--color-viz-seq-7: #025F53;
/* Hueco (semántico, separado de "atención"): ámbar tenue, nunca rojo */
--color-viz-hueco-1: #F6EDE0; --color-viz-hueco-2: #EFDCC0;
--color-viz-hueco-3: #E7C99D; --color-viz-hueco-4: #E0A868;
```

Y en `:root` (no son colores planos): `--dur-1: 140ms; --dur-2: 260ms;
--ease-out: cubic-bezier(.2,.8,.2,1); --ease-inout: cubic-bezier(.4,0,.2,1);`.
Documenta en un comentario la escala tipográfica (40/26/20/15/13/11, pesos
300/400/500/600, kicker tracking `.10em`) y la regla de elevación (hairline
norma; sombra solo para lo que flota) — se consumen en pasos siguientes.

**Qué NO tocar:** ningún componente; ningún token existente (los `--color-*`
actuales quedan idénticos).
**Aceptación:** el build pasa; los tokens existen (visibles en el CSS servido).
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: capturas idénticas antes/después — **nada debe cambiar**.

---

## Paso 2 · [SEGURO] Kit de gráficas + esqueletos (sin montar)

**Objetivo:** las 5 formas de gráfica y los esqueletos como componentes
presentacionales reutilizables, con la matemática en un módulo puro testeado.

**Archivos nuevos:**
- `apps/lifestyle/src/lib/viz.ts` — puro: `pctWidth(valor, max)` (clamp 0–100,
  mínimo visual 2% si valor>0), `seqStep(intensidad)` → 1..7,
  `huecoStep(horas, maxHoras)` → 1..4, `foldOtros(filas, tope)` (top-N + fila
  "Otros k" agregada).
- `tests/viz.test.ts` (mismo runner `node:test` del repo) *(raíz del repo — lo
  que `npm test` corre por lista explícita; `apps/lifestyle/tests/` no existe)*.
- `apps/lifestyle/src/app/globals.css` — **solo agregar** (keyframes,
  `--stagger`, `--animate-*`, reduced-motion); ningún token existente cambia.
- `apps/lifestyle/src/components/admin/viz/`: `BarraFila.tsx` (label + pista
  `--color-gap` + relleno + valor tabular derecha), `Apilada.tsx` (100%,
  segmentos con gap 2px, SIN animación de crecimiento — una proporción no se
  acumula), `Columnas.tsx` (pista + relleno desde la base), `HeatmapGrid.tsx`
  (celdas 20–22px, hatch para "cerrado"), `Esqueletos.tsx` (formas: statHero,
  filaBarra, heatmap, filaLista — pulso de opacidad 1.2s).
  Todos Server Components; entrada por CSS animation con
  `animation-delay: calc(var(--i)*30ms)` (índice por prop).

**Movimiento del kit (hueco cerrado 2026-08-12).** dv3-1 declaró duraciones y
curvas pero ningún `@keyframes`; el kit los necesita. Entran aquí:

```css
/* :root — junto a --dur-1/--dur-2 (dv3-1) */
--stagger: 30ms;

/* Nivel superior del archivo — CSS plano. El nombre lo resuelve el navegador
   en runtime; la poda de @theme (hallazgo dv3-1) no los puede tocar. */
@keyframes viz-grow-x  { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes viz-grow-y  { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes viz-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes viz-sk-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }

/* Dentro del bloque @theme static de dv3-1 (emisión garantizada, mismo motivo) */
--animate-viz-grow-x:  viz-grow-x  var(--dur-2) var(--ease-out) backwards;
--animate-viz-grow-y:  viz-grow-y  var(--dur-2) var(--ease-out) backwards;
--animate-viz-fade-in: viz-fade-in var(--dur-2) var(--ease-out) backwards;
--animate-viz-sk-pulse: viz-sk-pulse 1.2s var(--ease-inout) infinite;

/* Al final del archivo — se apaga por tokens (cubre también las transiciones
   de los pasos 3'–6, regla 6 del Sistema de la maqueta) */
@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 0ms; --dur-2: 0ms; --stagger: 0ms; }
  .animate-viz-sk-pulse { animation: none; }
}
```

**Asignación:** `BarraFila` relleno = `animate-viz-grow-x` + `origin-left` ·
`Columnas` = `animate-viz-grow-y` + `origin-bottom` · `HeatmapGrid` celdas =
`animate-viz-fade-in` con `--i` = índice de **columna** (orden temporal) ·
`StatFila` = `animate-viz-fade-in` · `Apilada` = **sin animación** (regla
existente) · `Esqueletos` = `animate-viz-sk-pulse`. `backwards` porque un
elemento con delay debe nacer oculto. El delay del paso cambia de `30ms`
literal a `calc(var(--i) * var(--stagger))` (mecanismo de la maqueta, línea 134).

**Regla escrita:** magnitud = un matiz (cat-1); identidad = categórica en orden
fijo; composición 100% no crece; heatmap aparece por columnas (orden del
tiempo); números `tabular-nums` siempre; el número héroe nunca hace count-up.

**Caso numérico (en los tests):** `pctWidth(388, 388) → 100`;
`pctWidth(1, 388) → 2` (mínimo visual); `pctWidth(0, 388) → 0`;
`seqStep(0) → 1`, `seqStep(0.99) → 7`; `foldOtros(8 servicios, tope 4)` → 5
filas y la 5ª suma los otros 4.

**Aceptación:**
(a) pre-flight: ninguno de los nombres a agregar (`viz-grow-x`, `viz-grow-y`,
`viz-fade-in`, `viz-sk-pulse`, `--stagger`, `--animate-viz-*`) aparece ya en
`git grep "@keyframes\|--stagger\|--animate" apps/lifestyle/src/app/globals.css`.
(b) el CSS servido contiene los 4 `@keyframes viz-*` y las clases
`animate-viz-*` que el kit usa (mismo criterio "visible en el CSS servido" del
Paso 1).
(c) con `prefers-reduced-motion: reduce` emulado en DevTools, el kit renderiza
en estado final (barras a ancho completo, sin pulso).
(d) red visual igual: capturas idénticas — el kit sigue sin montarse.

**Qué NO tocar:** ninguna vista los monta todavía.
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: capturas idénticas — **nada debe cambiar**.

---

## Paso 3 · [SEGURO] Panorama: héroe LA SEMANA + composición nueva

**Objetivo:** Panorama pasa a: héroe semana → hoy compacto → barberos hoy →
próximos 7 días → para recuperar (top 3) → fuga con heatmap → faltas — y el
gauge desaparece.

**Archivos:** `components/admin/NegocioView.tsx` (recomposición; el bloque
`<details>` "La historia" SE QUEDA hasta el Paso 6), `PulsoHoy.tsx` (de gauge a
card compacta), `SemanaProxima.tsx` (columnas pista+relleno, anillo ámbar solo
en los 2 días con más lugar), `HoyFeed.tsx` (top 3 + `<details>` "Ver todos" +
resumen por urgencia), `Fuga.tsx` (número 26px w300 + `HeatmapGrid` 7×2 con la
ramp hueco — `lib/fugaData.ts` ya bucketea día×franja), **nuevo**
`lib/semanaHero.ts` (datos) + la matemática en `lib/pulso.ts` o módulo puro
nuevo `lib/semanaCalc.ts` + tests.

**Cálculo del héroe (explícito):** semana = lunes a domingo en la TZ del
negocio. Ingreso por día = `SUM(COALESCE(price_charged, services.price))` de
citas `completed` de ese día local. Titular = suma lun→hoy. Delta = ese total
menos el MISMO TRAMO (lun→mismo día-hora) de la semana anterior. El strip pinta
realizado sólido, hoy con anillo, días futuros como pista vacía, día sin
horario (dom) en hatch. **El futuro NO se pinta en el héroe** — la proyección
es de "Los próximos 7 días" (ocupación, `lib/pulsoSemana.ts`). Una métrica por
strip; nunca eje doble.

**Caso numérico (test puro, TZ=UTC):** negocio en `America/Mexico_City`; citas
completadas: lun 2 (precios 200 y 320), mar 1 (450, con `price_charged=400`),
hoy=miércoles 1 (200). Salida: días `[520, 400, 200, 0, 0, 0, 0]`, titular
`1120`. Semana pasada mismo tramo = `900` → delta `+220`. Una cita del lunes a
las `05:30 UTC` (= domingo 23:30 local) NO cuenta para el lunes.

**CTA "Mensaje" (regla de producción, no negociable):** la cuenta de WhatsApp
del negocio NO está verificada (WABA de prueba), así que el botón se rinde en
variante **`gated`**: gris (`--color-past-*`), sin tap-state, sin cursor,
`disabled`, y UNA línea bajo la lista: "El envío se activa cuando WhatsApp esté
conectado". **Prohibido** rendir "✓ Enviado" o cualquier afirmación de envío:
el endpoint existente devuelve `{sent:false}` en silencio y cablearlo es OTRO
trabajo (la máquina de estados honesta está especificada en la maqueta,
sección Sistema, para cuando exista).

**Qué NO tocar:** `lib/cadence.ts`, `lib/retentionFeed.ts`, `lib/fuga.ts`,
`lib/fugaData.ts`, `lib/pulsoData.ts` (solo se consumen); el `<details>`
historia; nada de Administrar/Clientela/Actividad.
**Aceptación observable:** el alto de Panorama denso baja de ~9,000px lógicos a
<2,500 (con historia plegada); no existe ningún muro >5 tarjetas iguales; hay
exactamente UN número a 40px.
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: cambia SOLO Panorama; Clientela/Administrar/Actividad
idénticas píxel a píxel.

---

## Paso 4 · [SEGURO] Administrar: el día como riel + equipo compacto

**Objetivo:** Administrar pasa a: encabezado fecha → héroe del día (riel de
tiempo) → equipo esta semana (tabla compacta) → configuración como disclosures.

**Archivos:** `components/admin/AdministrarView.tsx`, `AdminInlinePanel.tsx`
(se integra a los disclosures), `DashboardLayout.tsx` (deja de montar en nivel
1: `MetricsSummary`, `TopClientsCard`, `HourlyPeaksChart`, `SourceBreakdown` —
canal se va a Análisis en el Paso 6; picos/top clientes se ELIMINAN del nivel 1),
**nuevo** `components/admin/DiaRail.tsx` (riel: hora tabular en gutter 38px,
barra 3px con el color categórico del barbero + leyenda, pasado atenuado por
COLOR `--color-past-*` no por opacity, línea "ahora" en `--color-red-border`,
huecos como fila punteada "N min libres · X y Y", tope ~8 filas +
`<details>` "Ver las N citas"), **nuevo** `components/admin/EquipoSemana.tsx`
(fila = punto color + nombre + barra participación + $ tabular; staff sin citas
NO se lista; misma fuente de datos que `StaffMetricsPanel`).

**Regla:** los paneles legacy NO se borran — quedan detrás de filas de
disclosure (`<details>`): Servicios y precios / Barberos, PIN y horarios /
Horario del negocio / Clientes inactivos y lista de espera (con badge de
conteo) / Reportes y reseñas. El CRUD, sus endpoints, audit y doble
invalidación de cache quedan intactos.

**Caso numérico (TZ=UTC):** con la BD demo, la suma de los `$` de las filas de
EquipoSemana = el "total" del encabezado, y coincide con lo que hoy suma
StaffMetricsPanel para "Semana". El riel pinta la línea "ahora" entre la última
cita pasada y la primera futura en hora LOCAL del negocio.

**Qué NO tocar:** las server actions (`assistant-actions.ts`); los endpoints de
CRUD; los paneles legacy por dentro (eso es Paso 5).
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: cambia SOLO Administrar (alto denso: de ~7,000px a <2,000);
las otras pestañas idénticas.

---

## Paso 5 · [SEGURO] Clientela + Actividad + barrido de consistencia

**Objetivo:** las dos pestañas restantes al nivel del sistema, y una sola voz
en toda la vista: cero paleta numérica, cero voseo, cero emoji.

**Archivos:**
- `components/admin/ClientelaView.tsx`: héroe 125 + barra de composición 100%
  (`Apilada`) + leyenda con conteos; "quién vuelve" como par de stats; "cómo se
  mueven" como 2 filas con flecha (iconos Heroicons outline 18px) y "otras N"
  como nota al pie.
- `components/admin/ActividadView.tsx`: log agrupado por día (kickers), riel de
  puntos por tipo (cita = cat-1, gestión = cat-2), hora tabular a la derecha,
  filtros como pills con tap-state. Ya es Client Component — no crece.
- **Barrido** en los paneles que sobreviven bajo disclosures (lista exacta:
  `StaffManagementPanel, ServicesManagementPanel, ServiceForm, StaffCreateForm,
  StaffScheduleEditor, ScheduleExceptionsPanel, StaffServicesEditor,
  StaffAvailability, StaffPhotoManager, QuickDayOff, BusinessHoursPanel,
  ReportsConfigPanel, ReviewConfigPanel, WaitlistPanel, InactiveClientsPanel,
  BlockRequestsInbox` en `components/admin/`): reemplazo mecánico de clases
  numéricas de Tailwind (`gray-*`, `green-*`, `red-*`, `blue-*`…) por tokens de
  marca; emojis (⚠️ 🔴 🚨 ✓ …) por chips/puntos del sistema.
- **Movimiento legacy (candidato del barrido, NO antes):** los tres `--animate-*`
  previos a dv3 llevan duración y curva hardcodeadas y casi coinciden con los
  tokens de dv3-1 — `card-in` y `rise-in` usan `cubic-bezier(0.2, 0.8, 0.25, 1)`
  contra `--ease-out: cubic-bezier(.2,.8,.2,1)`, y los 0.22s de `card-in` contra
  `--dur-2: 260ms`; las duraciones de `rise-in` (0.5s) y `data-beat` (1.8s) son
  propias. Tokenizarlos es del barrido, con su red visual: tocan la vista del
  barbero y el Home, no solo al dueño.
- **Voseo** (una línea cada uno, TODOS): `BusinessHoursPanel.tsx` "ajustá";
  `NegocioView.tsx` "pagás", "Definí", "trabajás" (si sobreviven al Paso 3/6);
  `AdminInlinePanel.tsx` "Elegí"; `StaffCreateForm.tsx` "Seleccioná", "Creá";
  `ActividadView.tsx` "Probá"; `app/api/staff/route.ts` "Seleccioná uno o
  creá"; y en staff/: `AssistantVerticalCalendar.tsx` "tocá",
  `AssistantControlDesk.tsx` "elegí" (×2) y "tocás", `AppointmentThread.tsx` +
  `AssistantDayTimeline.tsx` "lo tenés arriba", `DayBar.tsx` "no trabajás",
  `TipsSummary.tsx` "Solo vos" → "Solo tú".

**Qué NO tocar:** la lógica/props de los paneles legacy (solo clases y
strings); `lib/clientelaStats.ts` y `lib/activityFeed.ts` (solo se consumen).
**Aceptación observable:**
`grep -rE "(text|bg|border|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|blue|indigo|violet|purple)-[0-9]{2,3}" apps/lifestyle/src/components/admin/` → **0 resultados**; el grep de voseo del plan → 0.
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: Clientela y Actividad cambian de composición; Administrar
cambia SOLO dentro de los disclosures abiertos; Panorama idéntico.

---

## Paso 6 · [APUESTA] La quinta pestaña: "Análisis"

*Apuesta: asume que el dueño quiere el análisis separado del pulso. Las
entrevistas de validación pueden invalidarla — si se cae, Panorama conserva su
`<details>` "La historia" y nada más se pierde. Prescindible sin tocar los
pasos 1–5.*

> **Trade-off anotado (decisión de Gabriel, NO reordenar por tu cuenta):**
> Análisis tiene un argumento para ADELANTARSE en el orden: es la única
> superficie donde el dueño VE que el bot trabaja (conversaciones, citas
> agendadas por el bot, takeovers), y Gabriel la va a usar para vender el
> producto en demos a barberías reales. Si las demos se agendan antes de llegar
> aquí, este paso puede ejecutarse después del Paso 2 (solo depende del kit;
> lo único que se coordina con el Paso 3 es quitar el `<details>` "La historia"
> de `NegocioView.tsx`, que puede hacerse en el que llegue segundo). El costo
> de adelantarlo: la apuesta se construye antes de que las entrevistas la
> validen. La decisión queda para Gabriel en el momento; el orden por defecto
> del plan no cambia.

**Objetivo:** el BI sale de Panorama a su propia pestaña, más mezcla por
servicio, canal y la ventana al bot.

**Archivos:** **nuevo** `components/admin/AnalisisView.tsx`; **nuevo**
`lib/analisisData.ts`; `OwnerTabs.tsx` (5ª pestaña "Análisis", 2ª posición,
icono Heroicons `chart-bar` outline; Actividad sigue relegada gris con
separador; labels a 10px — verificado que caben a 375px);
`app/dashboard/page.tsx` (cablear datos con `Promise.all` + UN `Suspense`
boundary con esqueleto de Análisis); `NegocioView.tsx` (QUITAR el `<details>`
"La historia"; sus tres bloques — ingresos/6 meses, semana típica, recompra —
se MUEVEN a AnalisisView, reusando `lib/negocioMetrics.ts`, `lib/occupancy.ts`,
`lib/staffRecompra.ts` sin cambios).

**Lecturas nuevas (costo MEDIDO en la BD densa — EXPLAIN ANALYZE, no lo
re-discutas):** mezcla por servicio del mes: 0.85 ms caliente (Index Scan
`idx_appointments_business_starts`, 388 filas); conversaciones y takeovers de
la semana: <0.1 ms c/u (bot_conversations ≈ 1 fila por cliente); citas por bot:
0.23 ms **definida por `starts_at`**. ⚠️ **Regla dura:** la métrica "citas del
bot esta semana" filtra por `starts_at` (indexada), NUNCA por `created_at`
(sin índice → Seq Scan del histórico completo, 12.7 ms hoy y creciendo).
Presupuesto total nuevo: ~2 ms / 4 queries.

**Cálculos explícitos:** mezcla = `SUM(COALESCE(price_charged, services.price))`
sobre `completed` del mes local, `GROUP BY` servicio, top 4 + `foldOtros`;
canal = conteo por `source` del mes (misma fuente que hoy usa MetricsSummary);
ventana bot = 3 conteos de la semana local (lunes 00:00 TZ negocio):
`bot_conversations.last_message ≥ lunes`, `appointments.source='bot' AND
starts_at ≥ lunes`, `bot_conversations.taken_at ≥ lunes`.

**Caso numérico (TZ=UTC):** invariante — la suma de las barras de servicios
(incluido "Otros") = el titular del mes en el héroe de Análisis, centavo a
centavo. Cita con `starts_at` domingo 23:30 local NO entra a la semana que
empieza ese lunes. `foldOtros`: con los 8 servicios del seed, la vista rinde
5 filas.

**Qué NO tocar:** los tres módulos de BI movidos (cero cambios de lógica); el
resto de Panorama.
**Red visual** *(prerrequisito: `scripts/seed-demo-densa.sql` corrido — sin datos densos la comparación no prueba nada)*: aparece la pestaña Análisis (nueva); en Panorama desaparece el
`<details>` "La historia" y NADA más cambia; las otras tres idénticas.

---

## Dependencias y orden

`1 → 2 → {3, 4} → 5 → 6`. Los pasos 3 y 4 son independientes entre sí (ambos
dependen del 2). El 5 asume 3 y 4 (barre lo que sobrevive). El 6 es la única
APUESTA y es prescindible. Cada paso deja `main` deployable.
