# Dueño v3 — notas de diseño (Fase 2, ejercicio 100% visual)

Acompañan a `dueno-v3.html`. Diagnóstico previo: con datos densos la vista no
mejora — se alarga. Los defectos son de forma, no de dato: todo es texto o tile,
todo pesa igual, las listas no tienen tope, y conviven dos sistemas de color.

---

## 0. Paleta de datos (paso 1 del plan — hoy NO existe)

`globals.css` tiene un acento (teal) y neutros; no alcanza para series ni
intensidades. Se agregan tokens `--viz-*` al `@theme` (los valores exactos están
en el `<style>` de la maqueta):

**Categórica** (identidad: barberos, canales, tipos) — orden FIJO, nunca ciclada:

| slot | hex | origen |
|---|---|---|
| 1 | `#008F76` | teal de marca (el extremo del `--grad-teal`) |
| 2 | `#3E6FB8` | azul acero (nuevo) |
| 3 | `#B45309` | ámbar (ya existía: `--color-amber`) |
| 4 | `#5B4CC4` | violeta (ya existía: `--color-walk`) |
| 5 | `#B4508A` | berry (nuevo) |
| otros | `#9CA0A4` | pliegue "otros" — jamás una 6ª serie |

Validada con `validate_palette.js` (skill dataviz) sobre `#FFFFFF` **y**
`#F4F7F7`: banda de luminosidad PASS, croma PASS, separación CVD adyacente
PASS (peor par ΔE 11.9), piso de visión normal PASS (peor par ΔE 16.2),
contraste ≥3:1 PASS. **El orden es el mecanismo de seguridad CVD, no
cosmética**: no reordenar sin re-validar. Nota del método: con las 5 en
pantalla a la vez en formas de "todos contra todos" (scatter, mapas) el tope
son 3 series; en barras/apilados/leyendas (nuestro caso) las 5 son legales,
siempre con etiqueta directa (que a 375px es obligatoria de todos modos).

**Secuencial teal** (magnitud: heatmaps, intensidad) — un matiz, claro→oscuro:
`#EBFAF8 → #C7F2EC → #8FE3D3 → #4CC9AF → #17A98C → #018271 → #025F53`
(los dos primeros son `--tint-1/2`; el 6º y 7º son `--teal-border` y
`--teal-ink`: la escala nace de la marca). Mata el verde ad hoc `#1D9E75`
del heatmap actual (`NegocioView.tsx cellBg()`).

**Hueco/faltante** (semántico, separado de "atención"):
`#F6EDE0 → #EFDCC0 → #E7C99D → #E0A868` — ramp de ámbar tenue que termina en
`--amber-border`. El hueco es espacio, no alarma: nunca rojo. El neutro
`--color-gap #E7ECEC` (ya existía, lo usa el barbero) es la pista/track
universal de toda barra.

**Positivo/negativo** en texto: `--teal-ink` / `--red-ink` (ya existen). El
ámbar queda SOLO para atención/hueco; el teal deja de competir con un "verde
genérico" porque ya no hay ninguno numérico de Tailwind en la vista.

---

## 1. Inventario de visualización

Cómo se renderiza hoy: **sin librería**. Gauge = SVG a mano (`PulsoHoy.tsx`,
2 `<circle>` con dasharray); heatmap = `<table>` con rgba inline
(`NegocioView.tsx`); todo lo demás divs con `width/height %` (MonthlyBars,
SemanaProxima, barras de barberos/recompra, HourlyPeaksChart legacy).

**Decisión: seguir sin librería — SVG/divs a mano.** Razones: (a) todas las
formas necesarias (barra, apilado, heatmap de celda, mini-columnas, arco) son
triviales en divs/SVG; (b) los componentes son Server Components — una librería
de charts arrastra JS de cliente e hidratación que hoy no existe; (c) el
control fino de tokens/espaciadores/radios es el punto del ejercicio. Lo que sí
se estandariza: un mini-kit de componentes de gráfica propios (Barra, Apilada,
Heatmap, MiniColumnas, StatFila) para que las ~12 gráficas no re-inventen
estilos — eso es un paso del plan.

Dato por dato (se gana su forma o vuelve a ser número):

| Dato | Hoy | Propuesta | Por qué |
|---|---|---|---|
| Ocupación de hoy | Gauge donut 140px, pieza más grande de la página | **Degradar a número** (15%, mini-stat en el héroe) | Un solo % no necesita 140px; el gauge es el dato menos accionable a las 8pm. La forma se la queda el dinero |
| Ingreso del día (3 capas) | Línea de texto "$X ya hecho +$Y · +$Z" | **Barra apilada horizontal** (hecho teal / agendado tint / hueco gap) | Las 3 capas son partes de un todo: la proporción ES el mensaje |
| Citas / no-shows / walk-ins | 3 tiles con caja y comparación verbosa | **Fila de mini-stats** sin caja (número 15px + label 11px) | Tiles de un dígito son mueble; el dato cabe en una línea |
| Barberos hoy | Barras gruesas + colapso a 3 | **Barras finas monocromas (teal), los 5 visibles** | Una métrica → un matiz (magnitud, no identidad). 5 filas caben; el colapso era para el muro, no para 5 |
| Próximos 7 días | Cajas grises con strip ámbar abajo (se lee invertido) | **Columnas: pista gap + relleno teal desde la base**; anillo ámbar SOLO en los 2 días con más hueco; Dom = hatch | El lleno debe leerse como lleno; el hueco señalado, no gritado en los 7 |
| Para recuperar | 42–57 cards idénticas, sin tope | **Top 3 (el ranking por valor ya existe en `cadence.ts`) + resumen por urgencia + "Ver todos"** | El muro destruye la página; el dueño actúa sobre 3, no sobre 57 |
| La fuga (160 h) | Número + frase | **Número grande (28px w300) + mini-heatmap 7×2 día×franja (ramp hueco)** | `fugaData` YA bucketea día×franja; la forma muestra DÓNDE, la frase solo lo decía |
| Faltas repetidas | Filas de texto | **Filas + puntos rojos por falta (●●●) + fecha tabular** | El conteo pequeño se lee más rápido como forma; sigue siendo dato, no juicio |
| Ingresos 6 meses | Barras divs correctas pero bold/pesadas | **Mantener barras**; finas, etiqueta solo en meses con dato, parcial punteada | La forma era correcta; era ejecución |
| Comparación de tramo | Frase con ▲ | **Mantener como texto** (▲ $9,120 vs junio) | Es UNA delta con contexto: el texto gana |
| Heatmap semana típica | `<table>` con verde ad hoc `#1D9E75`, celdas 24px | **Mantener heatmap**; ramp secuencial teal de marca, celdas 20px, leyenda menos→más | La forma es la correcta para día×hora; el color era ilegal |
| Recompra por barbero | Barras + línea de promedio | **Mantener**; fina, ámbar bajo el promedio, "aún juntando datos" sin barra | Forma correcta; se afina peso y color |
| Métricas (Hoy/Sem/Mes) 8 tiles | 8 tiles, mitad en cero | **Eliminar como grid**: el día ya vive en el héroe de Administrar; semana/mes → equipo y servicios | Tiles en cero son ruido estructural |
| Rendimiento del equipo | 7 cards × 6 tiles c/u | **Tabla compacta: punto de color + nombre + barra de participación + $** ; staff sin citas NO se lista | 42 tiles → 5 filas. La participación relativa es la pregunta real |
| Por canal | 4 tiles con % | **Una barra 100% apilada** (bot teal / manual azul / walk-in violeta `--color-walk`) | Partes de un todo; walk-in hereda el violeta que YA significa walk-in en la vista del asistente |
| Servicios (mezcla $) | No tiene superficie (la query existe) | **Barras horizontales por servicio + pliegue "Otros 4"** | Magnitud → un matiz; a 375px la barra horizontal es la reina |
| Picos por hora | Mini-columnas legacy | **Se pliega** dentro del detalle del día (no compite en el nivel 1) | Dato de consulta, no de decisión diaria |
| Top clientes del periodo | Lista "1 visita" c/u | **Eliminar** (con datos densos sigue sin decidir nada) | No pasa la prueba de "¿cambia una conducta?" |
| Agenda del día | 21 cards con 2 botones c/u | **Riel de tiempo**: hora tabular en gutter + barra 3px color-barbero + estado chip; huecos como fila punteada; línea "ahora" roja; pasado atenuado | La agenda es tiempo: la forma es un riel, no una pila de cajas iguales |
| Actividad | Cards por evento, actor+verbo+targets iguales | **Log agrupado por día**: riel de puntos (cita teal / gestión azul), actor en semibold, hora tabular derecha | Un archivo se diseña como archivo: denso, monocromo, rítmico |
| Clientela: 5 segmentos | 5 cards apiladas | **Barra 100% apilada (héroe) + leyenda con conteos** | La composición del todo ES el dato; 5 cards lo esconden |
| Clientela: retención (2 tasas) | 2 cards | **Par de stats**: % 28px w300 + barra fina de progreso + cohorte en fine | Dos números con contexto, sin cajas dentro de cajas |
| Clientela: transiciones | 2 cards + "Otras: 75" | **2 filas con flecha ↗/↘ y número en color semántico**; "otras 75" a nota al pie | El signo es el mensaje |

## 2. Composición por pestaña

Reglas transversales: **una pieza heroica por pestaña** y el gesto de marca
(border-left teal 2px) SOLO en ella; escala tipográfica 11/13/15/20/28/44 con
números grandes en peso 300 y `tabular-nums`; un radio (16px), una sombra;
20px de aire entre cards, hairlines dentro; nada de caja dentro de caja.

**Panorama — "¿cómo voy?"** Héroe: el dinero de hoy ($2,960 a 44px w300) con
la barra de 3 capas y la fila de mini-stats debajo — un vistazo responde hoy.
Orden: héroe → barberos hoy → próximos 7 días → para recuperar (top 3) → fuga
→ faltas → la historia (plegada, como hoy). Respira: las listas tienen tope, el
muro no existe; la sección más alta es el héroe, no una lista. Vacía: el héroe
degrada a "$0 · sin citas aún hoy" con la barra en pista pura; "para recuperar"
y "fuga" conservan sus estados vacíos dignos actuales (borde punteado, sin
ceros de seis dígitos).

**Clientela — "¿de qué está hecha mi base?"** Héroe: 125 (44px) + la barra de
composición 100% y su leyenda con conteos — la pestaña entera en una forma.
Luego: quién vuelve (par de stats) → cómo se mueven (2 flujos). Es la pestaña
más corta: tres cards, mucho aire. Vacía: barra en gris pista + leyenda en
cero + el copy actual de "aún no hay historia suficiente".

**Administrar — "operar el día".** Única pestaña donde el héroe es
INTERACTIVO: la fecha + $ del día + agenda como riel de tiempo (color por
barbero = paleta categórica, leyenda arriba; pasado atenuado; línea "ahora";
huecos dibujados). Debajo, lectura de gestión: equipo esta semana (tabla
compacta), servicios del mes (barras), canal (apilada). Todo lo de
configuración (8 paneles legacy) colapsa a filas de disclosure — deja de
competir con el día. Vacía: riel con solo la línea "ahora" y "sin citas hoy";
las filas de configuración no cambian.

**Actividad — "el archivo".** Sin héroe: es la pestaña relegada y su diseño lo
dice — una sola card, días como kickers, filas densas con riel de puntos por
tipo y hora tabular a la derecha, filtros como pills arriba. Monocroma salvo
los puntos. Vacía: "Sin actividad todavía" en una línea.

## 3. Decisiones de composición sobre CTAs muertos (sin plomería)

- "Enviar mensaje" (para recuperar): **se queda**, como botón fantasma por
  fila — la composición asume la acción; su cableado es otro trabajo.
- "Crear promo" (ocupación): **se va** de la maqueta — no hay sistema detrás
  ni forma honesta de degradarlo.
- "contactados / volvieron": fuera del nivel 1; vuelven cuando el loop exista.

## 4. Qué habría que empezar a capturar / exponer (lista aparte, tan valiosa como la maqueta)

1. **Valor en juego por cliente del feed** — se CALCULA en `lib/cadence.ts`
   (frecuencia × monetario × severidad) pero no se expone en `CadenceResult`;
   exponerlo permite mostrar "$ en riesgo" por fila y en el resumen.
2. **Mezcla por servicio** — los datos existen (`price_charged` por cita);
   falta la superficie/query dedicada (la maqueta la asume).
3. **"Volvieron" tras reactivación** — derivable de `scheduled_notifications
   (type=reactivation).sent_at` + `appointments.created_at` ≤14d; hoy nadie lo
   computa (el pulso muestra "—").
4. **Actor legible en Actividad** — el feed depende de `appointment_audit.actor_*`;
   los eventos del bot ya salen; "Dueño cambió el precio" requiere que
   `management_audit` se muestre con el mismo tratamiento (ya existe la tabla).
5. NO se captura nada nuevo para: pulso, 7 días, fuga, faltas, clientela,
   equipo, canal — todo sale de tablas/libs existentes (ver comentarios de
   origen en la maqueta).

## 5. Verificación de la paleta (reproducir)

```bash
node <skill dataviz>/scripts/validate_palette.js "#008F76,#3E6FB8,#B45309,#5B4CC4,#B4508A" --mode light --surface "#FFFFFF"
node <skill dataviz>/scripts/validate_palette.js "#008F76,#3E6FB8,#B45309,#5B4CC4,#B4508A" --mode light --surface "#F4F7F7"
```
Ambas corridas: ALL CHECKS PASS (2026-07-30).

---

# Iteración 2 — movimiento, sistema de detalle, estados y la quinta pestaña

La maqueta (`dueno-v3.html`) ahora es VIVA: pestañas con skeleton→entrada,
disclosure animada, "ver todos" que expande en su lugar, tap-states en todo lo
tocable, y una sección **Sistema** al final del archivo con la especificación
completa. Lo que sigue es el resumen; la referencia es la maqueta misma.

## "Lujoso", operativamente (8 propiedades verificables)

1. Escala tipográfica cerrada: 6 estilos (40/26/20/15/13/11), 4 pesos, nunca 700.
2. Rejilla de 4px: todo espacio vertical ∈ {4,8,12,16,20,24,32}.
3. Un héroe por pantalla (un solo 40px); Actividad no tiene, a propósito.
4. Elevación única: hairline es la norma; la única sombra es para lo que flota.
5. Una familia de iconos (Heroicons outline, 24/1.5); regla de admisión estricta.
6. Movimiento solo con tokens (2 duraciones, 2 curvas) y solo si explica una
   relación; `prefers-reduced-motion` lo apaga entero.
7. Táctil ≥44px con hit extendido; lo no tocable no tiene affordance.
8. Ningún estado indefinido: lleno/denso/escaso/vacío/cargando/error, diseñados.

## Movimiento (tokens)

`--dur-1: 140ms` (micro) · `--dur-2: 260ms` (estructura) ·
`--ease-out: cubic-bezier(.2,.8,.2,1)` (entra/crece) ·
`--ease-inout: cubic-bezier(.4,0,.2,1)` (se transforma) · stagger 30ms×índice.
Mapa: pestaña sube 8px desde la barra; disclosure crece de su fila (grid 0fr→1fr);
la barra de magnitud crece desde su eje; el heatmap aparece por columnas en orden
del tiempo; las barras de composición (100%) NO crecen (una proporción no se
acumula); el display nunca corre (sin count-up). Skeletons con la FORMA del
contenido (pulso 1.2s); nunca spinner.

## Tipografía / rejilla / elevación / iconos

- Kicker: 11px w600 tracking +0.10em MAYÚS — el tracking es lo que faltaba.
- Números: tabular-nums en todo; display 40px w300 −0.02em.
- Elevación DECIDIDA: cards = hairline SIN sombra (antes: sombra en 15 cards =
  niebla); `--shadow-float` reservada a sheets/toasts/el marco. La tab bar flota
  por blur + hairline + safe-area (`env(safe-area-inset-bottom)`).
- Iconos: Heroicons outline (la familia que ya usa la app), 22 nav / 18 inline /
  28 sello de estado. Entra solo si navega, es affordance repetida (›) o sella
  un estado. Los emoji del legacy (⚠️🔴🚨) se van.

## La quinta pestaña — SÍ: "Análisis"

Decisión: se agrega. El BI del `<details>` de Panorama (mes, semana típica,
recompra) + dos huecos del diagnóstico (mezcla por servicio, canal) + **la
ventana al bot** (conversaciones/citas-bot/takeovers de la semana — todo sale de
`bot_conversations` y `appointments.source`; el bot es el diferenciador y hoy es
invisible para el dueño). Ganancia: Panorama queda glanceable de verdad (héroe
LA SEMANA + hoy + recuperar + fuga). Costo asumido: 5 pestañas es el límite de
la barra a 375px — labels a 10px, verificado que caben. Actividad sigue
relegada (gris, separador).

## Héroe de Panorama = LA SEMANA (corrección)

`$9,690 lun–jue` display + delta mismo-tramo semanal + strip lun–dom de ingreso
REALIZADO por día (hoy con anillo; futuro = pista vacía; dom hatch). El futuro
NO se pinta en el héroe: la proyección vive en "Los próximos 7 días" (ocupación).
Pasado=dinero, futuro=ocupación — una métrica por strip, sin eje doble.

## Paleta categórica: A vs B (en Sistema, lado a lado)

- A (primera): `#008F76 #3E6FB8 #B45309 #5B4CC4 #B4508A` — PASS, peor tritán 5.5.
- **B (contenida, recomendada)**: `#008F76 #35619F #9C500F #4F42B5 #9C3F73` —
  PASS, peor CVD adyacente ΔE 12.0, peor tritán 10.2 (MEJOR que A). Mismo teal
  de marca; los otros 4 bajan luminosidad (más tinta, menos juguete).
- La desaturación pura queda DESCARTADA por el validador (croma <0.1 = gris).

---

# Iteración 2b — las tres resoluciones previas a la Fase 3

## 1. El CTA "Mensaje" ya no miente

Decisión: la maqueta demuestra la **máquina de estados honesta** (es el spec de
cuando el envío exista) y especifica la regla de producción para HOY.

Estados del control (en Sistema · Estados):
`reposo → enviando (pulso, no afirma nada) → ✓ Enviado SOLO con confirmación del
proveedor · ó "Reintentar" + razón legible en la fila` ("No llegó · fuera de la
ventana de WhatsApp" — error Meta 131047). La fila solo baja de urgencia en éxito
confirmado. En la maqueta, el 2º botón demuestra el fallo.

**Regla de producción (mientras la WABA sea de prueba / verificación de Meta
rechazada):** el botón se rinde en la variante `gated` — gris, sin tap-state, sin
cursor — con UNA línea bajo la lista: "El envío se activa cuando WhatsApp esté
conectado". Prohibido por diseño: afirmar "✓ Enviado" cuando el endpoint devolvió
`{sent:false}` (hoy lo hace en silencio).

## 2. Frontera server/cliente del movimiento (resuelta — va al plan)

Estado actual verificado: client = `OwnerTabs` (estado de pestaña) y
`ActividadView` (filtros + cargar más) — ya pagados. Server = NegocioView,
PulsoHoy, SemanaProxima, Fuga, HoyFeed, ClientelaView, AdministrarView.

| Movimiento | Mecanismo | Frontera |
|---|---|---|
| Entrada de barras/heatmap con stagger | CSS `animation` + `animation-delay: calc(var(--i)*30ms)` — se dispara al montar/mostrar; el toggle `display` de OwnerTabs las re-dispara | **server** (cero JS nuevo) |
| Transición de pestaña (rise 8px + fade) | `@keyframes` sobre `section.on` | **server** (OwnerTabs ya existe) |
| Tap-states | `:active` | **server** |
| Disclosure (config, "ver todos") | `<details>` nativo estilizado; animación con `::details-content` donde el browser lo soporte, fallback instantáneo | **server** |
| Skeletons | **`<Suspense fallback={<Skeleton/>}>` streaming** — no es JS de cliente, es la arquitectura correcta: aparece en primera carga por navegación, con la forma del contenido | **server** |
| CTA "Mensaje" (enviando/enviado/fallo) | estado + mutación | **cliente** — justificado: es una ACCIÓN, no movimiento; componente hoja mínimo |
| Filtros de Actividad | ya client hoy | sin cambio |

Conclusión: **el movimiento del rediseño cuesta cero hidratación nueva.** El
único componente que cruza la frontera es el botón de envío, y cruza por ser
mutación, no por animar. La maqueta usa JS para orquestar la demo; el plan
implementa con los mecanismos de esta tabla, no copiando el JS de la maqueta.

## 3. Costo medido de las lecturas nuevas de "Análisis" (BD densa, EXPLAIN ANALYZE)

| Lectura | Plan | Tiempo (frío/caliente) | Nota |
|---|---|---|---|
| Mezcla por servicio (mes) | Index Scan `idx_appointments_business_starts`, 388 filas + join a 8 services | 43 ms / **0.85 ms** | escala con citas del MES, no con el histórico |
| Conversaciones del bot (semana) | Bitmap sobre `idx_bot_conversations_business_phone` | **<0.1 ms** | la tabla tiene 1 fila por cliente — minúscula |
| Takeovers (semana) | ídem (`taken_at`) | **<0.1 ms** | ídem |
| Citas por bot (semana) | ⚠️ con `created_at`: **Seq Scan** del histórico (12.7 ms hoy, crece linealmente — no hay índice). Con `starts_at`: Index Scan | 12.7 ms → **0.23 ms** | **decisión: la métrica se define por `starts_at`** ("citas del bot de esta semana"); `created_at` queda prohibido en esta superficie salvo índice nuevo (fuera del scope visual) |
| Canal (mes) | misma forma que mezcla; hoy ya se calcula en MetricsSummary | ~0.5 ms | se reusa la fuente |
| Mes/6 meses, semana típica, recompra | **ya se calculan hoy** (se MUEVEN de Panorama, no se agregan) | 0 nuevo | |

Nada se parece a "clientes que no vuelven" (diferido por pesado): aquel requería
el historial completo por cliente; todo lo de Análisis es ventana mes/semana
sobre índice existente. Presupuesto total nuevo de la pestaña: **~2 ms calientes,
4 queries** — se sirven con `Promise.all` + un solo Suspense boundary (skeleton
de Análisis), sin bloquear el resto del dashboard.
